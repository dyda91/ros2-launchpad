import asyncio
import json
import os
from contextlib import asynccontextmanager

import aiohttp
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .agent_client import AgentClient
from .mission_content import load_mission
from .pilot import PilotStore
from .runtime_client import RuntimeClient
from .sessions import SessionManager
from .settings import Settings

settings = Settings.from_env()
PILOT_COOKIE_NAME = "launchpad_pilot"


@asynccontextmanager
async def lifespan(app):
    runtime = RuntimeClient(settings)
    manager = SessionManager(settings, runtime, AgentClient())
    app.state.manager = manager
    app.state.runtime = runtime
    app.state.mission = load_mission(settings.mission_file)
    app.state.pilot = (
        PilotStore(
            settings.pilot_state_dir,
            settings.pilot_invite_ttl_seconds,
            settings.pilot_access_ttl_seconds,
        )
        if settings.pilot_enabled
        else None
    )
    await manager.start()
    yield
    await manager.shutdown()
    await runtime.close()


app = FastAPI(lifespan=lifespan)


def manager(request):
    return request.app.state.manager


def pilot(request):
    return request.app.state.pilot


def pilot_state(request):
    store = pilot(request)
    return store.control_state() if store is not None else "disabled"


def client_ip(request):
    if settings.pilot_trust_forwarded:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client is not None else "unknown"


def session_for_cookie(request):
    cookie = request.cookies.get(settings.cookie_name)
    if not cookie:
        return None
    return manager(request).session(cookie)


def pilot_access(request):
    store = pilot(request)
    if store is None:
        return None
    return store.authorize(request.cookies.get(PILOT_COOKIE_NAME))


def ws_session(websocket):
    origin = websocket.headers.get("origin")
    if origin not in settings.public_origins:
        return None, 4403
    cookie = websocket.cookies.get(settings.cookie_name)
    session = websocket.app.state.manager.ws_session(cookie)
    if session is None:
        return None, 4401
    if session.state != "ready":
        return session, 4409
    return session, None


@app.get("/api/health")
async def health(request: Request):
    current = manager(request)
    session = current.state(request.cookies.get(settings.cookie_name))
    return {
        "api": "ok",
        "runtime": await current.runtime.health(),
        "session": session.get("state"),
        "active": current.active_count(),
        "max": settings.max_sessions,
    }


@app.get("/api/pilot/status")
async def pilot_status(request: Request):
    store = pilot(request)
    if store is None:
        return {"state": "disabled", "invite_required": False, "invited": True}
    existing = session_for_cookie(request)
    access = pilot_access(request)
    return {
        "state": store.control_state(),
        "invite_required": existing is None and access is None,
        "invited": access is not None,
        "active": manager(request).active_count(),
        "max": settings.max_sessions,
    }


@app.post("/api/pilot/redeem", status_code=204)
async def redeem_pilot_invite(request: Request):
    store = pilot(request)
    if store is None:
        raise HTTPException(status_code=404, detail="pilot disabled")
    if store.control_state() != "open":
        raise HTTPException(status_code=403, detail="pilot not accepting")
    if not store.allow_attempt(
        f"ip:{client_ip(request)}",
        settings.pilot_rate_limit,
        settings.pilot_rate_window_seconds,
    ):
        raise HTTPException(status_code=429, detail="too many attempts")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid invite payload")
    code = payload.get("code") if isinstance(payload, dict) else None
    if not isinstance(code, str):
        raise HTTPException(status_code=400, detail="invalid invite payload")
    redeemed = store.redeem(code)
    if redeemed is None:
        raise HTTPException(status_code=403, detail="invite invalid")
    token, invite_id = redeemed
    store.emit("invite_redeemed", invite_id=invite_id)
    response = Response(status_code=204)
    response.set_cookie(
        PILOT_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.pilot_access_ttl_seconds,
        path="/",
    )
    return response


@app.get("/api/session")
async def session_state(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    existing = session_for_cookie(request)
    if pilot(request) is not None and existing is None:
        state = pilot_state(request)
        if state == "paused":
            return {"state": "pilot_paused", "pilot_state": "paused"}
        if state == "closed":
            return {"state": "pilot_closed", "pilot_state": "closed"}
        access = pilot_access(request)
        if access is None or access["consumed"]:
            return {"state": "invite_required", "pilot_state": state}
    payload = manager(request).state(cookie)
    if pilot(request) is not None:
        payload["pilot_state"] = pilot_state(request)
    return payload


def session_response(request, payload, created, session_id):
    state = payload.get("state")
    if state == "full":
        return JSONResponse(payload, status_code=409)
    if state == "invite_required":
        return JSONResponse(payload, status_code=403)
    if state == "pilot_paused":
        return JSONResponse(payload, status_code=503)
    if state == "pilot_closed":
        return JSONResponse(payload, status_code=410)
    if state == "error":
        return JSONResponse(payload, status_code=503)
    response = JSONResponse(
        payload,
        status_code=200 if state == "ready" else 202,
    )
    if created and session_id:
        response.set_cookie(
            settings.cookie_name,
            session_id,
            httponly=True,
            samesite="lax",
            secure=settings.cookie_secure,
            max_age=7200,
            path="/",
        )
    return response


@app.post("/api/session", status_code=202)
async def create_session(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    current = session_for_cookie(request)
    store = pilot(request)
    access = None
    access_token = None
    if store is not None and (current is None or current.state == "error"):
        state = store.control_state()
        if state != "open":
            return JSONResponse(
                {"state": f"pilot_{state}", "pilot_state": state},
                status_code=503 if state == "paused" else 410,
            )
        if current is None:
            access_token = request.cookies.get(PILOT_COOKIE_NAME)
            access = store.authorize(access_token)
            if access is None or access["consumed"]:
                return JSONResponse(
                    {"state": "invite_required", "pilot_state": state},
                    status_code=403,
                )
    payload, created, session_id = await manager(request).create(cookie)
    if created and store is not None and current is None:
        if not store.consume(access_token, session_id):
            await manager(request).delete(session_id)
            return JSONResponse(
                {"state": "invite_required", "pilot_state": "open"},
                status_code=403,
            )
    if created and store is not None:
        store.emit(
            "session_created" if current is None else "session_retried",
            payload.get("session_tag"),
            session_id=session_id,
        )
    return session_response(request, payload, created, session_id)


@app.post("/api/session/restart", status_code=202)
async def restart_session(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    tag = manager(request).state(cookie).get("session_tag")
    payload, created, session_id = await manager(request).restart(cookie)
    store = pilot(request)
    if store is not None and payload.get("state") != "error":
        store.emit("session_restarted", tag, session_id=session_id)
    return session_response(request, payload, created, session_id)


@app.post("/api/session/touch", status_code=204)
async def touch_session(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    if not cookie:
        raise HTTPException(status_code=409, detail="session not found")
    lifecycle = await manager(request).touch(cookie)
    if lifecycle is None:
        raise HTTPException(status_code=409, detail="session not found")
    return Response(status_code=204)


@app.put("/api/session/progress", status_code=204)
async def save_progress(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    if not cookie:
        raise HTTPException(status_code=409, detail="session not found")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid progress payload")
    before = manager(request).state(cookie)
    saved = await manager(request).save_progress(cookie, payload.get("progress"))
    if not saved:
        raise HTTPException(status_code=409, detail="session not writable")
    store = pilot(request)
    if store is not None:
        after = manager(request).state(cookie)
        steps = request.app.state.mission.get("steps", [])
        step_ids = [step.get("id", "") for step in steps]
        store.progress_events(
            before.get("session_tag"),
            before.get("progress"),
            after.get("progress"),
            step_ids,
        )
    return Response(status_code=204)


@app.delete("/api/session", status_code=204)
async def delete_session(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    if cookie:
        state = manager(request).state(cookie)
        await manager(request).delete(cookie)
        store = pilot(request)
        if store is not None:
            store.emit(
                "session_ended",
                state.get("session_tag"),
            )
    response = Response(status_code=204)
    response.delete_cookie(settings.cookie_name, path="/")
    if pilot(request) is not None:
        response.delete_cookie(PILOT_COOKIE_NAME, path="/")
    return response


@app.get("/api/mission")
async def mission_content(request: Request):
    return request.app.state.mission


@app.get("/api/map")
async def mission_map(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    data = await manager(request).map(cookie)
    if data is None:
        raise HTTPException(status_code=409, detail="session is not ready")
    return data


@app.websocket("/ws/terminal")
async def terminal(websocket: WebSocket):
    await websocket.accept()
    session, error_code = ws_session(websocket)
    if session is None or error_code is not None:
        await websocket.close(code=error_code or 4401)
        return
    client = None
    agent_ws = None
    try:
        await websocket.app.state.manager.touch(session.session_id)
        since = websocket.query_params.get("since")
        path = "/terminal"
        if since is not None:
            path = f"/terminal?since={since}"
        client, agent_ws = await websocket.app.state.manager.agent.connect(
            session.uds_path, session.agent_token, path
        )

        async def browser_to_agent():
            while True:
                try:
                    message = await websocket.receive()
                except Exception:
                    break
                if message["type"] == "websocket.disconnect":
                    break
                text = message.get("text")
                data = message.get("bytes")
                if text is not None:
                    await agent_ws.send_str(text)
                    try:
                        payload = json.loads(text)
                    except json.JSONDecodeError:
                        payload = {}
                    if payload.get("type") in {"input", "insert", "resize"}:
                        await websocket.app.state.manager.touch(
                            session.session_id
                        )
                elif data is not None:
                    await agent_ws.send_bytes(data)

        async def agent_to_browser():
            async for message in agent_ws:
                if message.type == aiohttp.WSMsgType.TEXT:
                    await websocket.send_text(message.data)
                elif message.type == aiohttp.WSMsgType.BINARY:
                    await websocket.send_bytes(message.data)
                else:
                    break

        tasks = [
            asyncio.create_task(browser_to_agent()),
            asyncio.create_task(agent_to_browser()),
        ]
        done, pending = await asyncio.wait(
            tasks, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        for task in done:
            try:
                task.result()
            except Exception:
                pass
    finally:
        if agent_ws is not None:
            await agent_ws.close()
        if client is not None:
            await client.close()
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/ws/telemetry")
async def telemetry(websocket: WebSocket):
    await websocket.accept()
    session, error_code = ws_session(websocket)
    if session is None or error_code is not None:
        await websocket.close(code=error_code or 4401)
        return
    client = None
    agent_ws = None
    try:
        client, agent_ws = await websocket.app.state.manager.agent.connect(
            session.uds_path, session.agent_token, "/telemetry"
        )

        async def lifecycle_reader():
            while True:
                current = websocket.app.state.manager.session(
                    session.session_id
                )
                if current is None:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "lifecycle",
                                "state": "expired",
                                "idle_expires_in": 0,
                                "hard_expires_in": 0,
                                "warning": True,
                            }
                        )
                    )
                    return
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "lifecycle",
                            "state": current.state,
                            "pilot_state": (
                                websocket.app.state.pilot.control_state()
                                if websocket.app.state.pilot is not None
                                else "disabled"
                            ),
                            **websocket.app.state.manager.lifecycle(current),
                        }
                    )
                )
                if current.state not in {"preparing", "ready"}:
                    return
                await asyncio.sleep(settings.monitor_interval_seconds)

        async def browser_reader():
            while True:
                try:
                    message = await websocket.receive()
                except Exception:
                    return
                if message["type"] == "websocket.disconnect":
                    return

        async def agent_reader():
            async for message in agent_ws:
                if message.type == aiohttp.WSMsgType.TEXT:
                    await websocket.send_text(message.data)
                elif message.type == aiohttp.WSMsgType.BINARY:
                    await websocket.send_bytes(message.data)
                else:
                    break

        tasks = [
            asyncio.create_task(browser_reader()),
            asyncio.create_task(agent_reader()),
            asyncio.create_task(lifecycle_reader()),
        ]
        done, pending = await asyncio.wait(
            tasks, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        for task in done:
            try:
                task.result()
            except Exception:
                pass
    finally:
        if agent_ws is not None:
            await agent_ws.close()
        if client is not None:
            await client.close()
        try:
            await websocket.close()
        except Exception:
            pass


if os.path.isdir(settings.static_dir):
    app.mount(
        "/",
        StaticFiles(directory=settings.static_dir, html=True),
        name="static",
    )
