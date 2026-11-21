import asyncio
import os
from contextlib import asynccontextmanager

import aiohttp
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .agent_client import AgentClient
from .runtime_client import RuntimeClient
from .sessions import SessionManager
from .settings import Settings

settings = Settings.from_env()


@asynccontextmanager
async def lifespan(app):
    runtime = RuntimeClient(settings)
    manager = SessionManager(settings, runtime, AgentClient())
    app.state.manager = manager
    app.state.runtime = runtime
    yield
    await manager.shutdown()
    await runtime.close()


app = FastAPI(lifespan=lifespan)


def manager(request):
    return request.app.state.manager


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
    }


@app.get("/api/session")
async def session_state(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    return manager(request).state(cookie)


@app.post("/api/session", status_code=202)
async def create_session(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    payload, created = await manager(request).create(cookie)
    state = payload.get("state")
    if state == "full":
        return JSONResponse(payload, status_code=409)
    if state == "error":
        return JSONResponse(payload, status_code=503)
    response = JSONResponse(
        payload,
        status_code=200 if state == "ready" else 202,
    )
    if created and payload.get("state") != "error":
        session = manager(request)._session
        response.set_cookie(
            settings.cookie_name,
            session.session_id,
            httponly=True,
            samesite="lax",
            secure=settings.cookie_secure,
            max_age=7200,
            path="/",
        )
    return response


@app.delete("/api/session", status_code=204)
async def delete_session(request: Request):
    cookie = request.cookies.get(settings.cookie_name)
    if cookie:
        await manager(request).delete(cookie)
    response = Response(status_code=204)
    response.delete_cookie(settings.cookie_name, path="/")
    return response


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
        client, agent_ws = await websocket.app.state.manager.agent.connect(
            session.uds_path, session.agent_token, "/terminal"
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
