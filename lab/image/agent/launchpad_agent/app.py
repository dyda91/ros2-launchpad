import asyncio
import hmac
import json
import os
import signal

from aiohttp import WSMsgType, web

from .launch_manager import LaunchManager
from .pty_session import PtySession
from .ros_bridge import RosBridge
from .settings import Settings


class AgentApp:
    def __init__(self, settings):
        self.settings = settings
        self.launch = LaunchManager()
        self.ros = RosBridge()
        self.pty = PtySession(self._shell_env())
        self._map = None
        self._timeout_error = None
        self._readiness_task = None

    def _shell_env(self):
        env = os.environ.copy()
        env.pop("AGENT_TOKEN", None)
        env.pop("RUNTIME_TOKEN", None)
        env["TERM"] = "xterm-256color"
        env["LANG"] = "C.UTF-8"
        env["LC_ALL"] = "C.UTF-8"
        env["HOME"] = env.get("HOME", "/home/ubuntu")
        env["PS1"] = "\\[\\e]1337;LaunchpadPrompt\\a\\]\\u@\\h:\\w\\$ "
        return env

    def _authorized(self, request):
        received = request.headers.get("X-Agent-Token", "")
        return hmac.compare_digest(received, self.settings.agent_token)

    def current_state(self):
        if self._timeout_error is not None:
            return "error"
        if self.launch.state == "error":
            return "error"
        if self.ros.ready():
            return "ready"
        return self.launch.state

    def current_error(self):
        if self._timeout_error is not None:
            return self._timeout_error
        return self.launch.error

    async def _readiness(self):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.settings.launch_timeout_seconds
        while loop.time() < deadline:
            if self.launch.state == "error":
                return
            if self.ros.ready():
                return
            await asyncio.sleep(0.2)
        if not self.ros.ready() and self.launch.state != "error":
            self._timeout_error = "timeout waiting for /odom"

    async def on_startup(self, app):
        await self.launch.start()
        self._readiness_task = asyncio.create_task(self._readiness())

    async def on_cleanup(self, app):
        if self._readiness_task is not None:
            self._readiness_task.cancel()
        self.pty.close()
        await self.launch.stop()
        self.ros.close()

    async def state(self, request):
        if not self._authorized(request):
            return web.json_response({"error": "unauthorized"}, status=403)
        return web.json_response(
            {
                "session_id": self.settings.session_id,
                "state": self.current_state(),
                "launch_pid": self.launch.pid,
                "odom": self.ros.latest(),
                "mission": self.ros.latest_mission(),
                "scan": self.ros.latest_scan(),
                "error": self.current_error(),
            }
        )

    async def map(self, request):
        if not self._authorized(request):
            return web.json_response({"error": "unauthorized"}, status=403)
        if self._map is None:
            try:
                with open(self.settings.map_file, "r", encoding="utf-8") as handle:
                    self._map = json.load(handle)
            except OSError as exc:
                return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(self._map)

    async def health(self, request):
        return web.json_response({"ok": True})

    async def terminal(self, request):
        if not self._authorized(request):
            return web.json_response({"error": "unauthorized"}, status=403)
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        cols = int(request.query.get("cols", "80"))
        rows = int(request.query.get("rows", "24"))
        try:
            since = int(request.query["since"])
        except (KeyError, ValueError):
            since = None
        await self.pty.add_client(ws, cols, rows, since)
        try:
            async for message in ws:
                if message.type == WSMsgType.TEXT:
                    try:
                        payload = json.loads(message.data)
                    except json.JSONDecodeError:
                        continue
                    if payload.get("type") == "input":
                        self.pty.send_input(str(payload.get("data", "")))
                    elif payload.get("type") == "insert":
                        ok, reason = self.pty.insert(
                            str(payload.get("data", ""))
                        )
                        await ws.send_str(
                            json.dumps(
                                {
                                    "type": "insert_result",
                                    "ok": ok,
                                    "reason": reason,
                                }
                            )
                        )
                    elif payload.get("type") == "resize":
                        self.pty.resize(
                            int(payload.get("cols", cols)),
                            int(payload.get("rows", rows)),
                        )
                elif message.type == WSMsgType.ERROR:
                    break
        finally:
            self.pty.remove_client(ws)
        return ws

    async def telemetry(self, request):
        if not self._authorized(request):
            return web.json_response({"error": "unauthorized"}, status=403)
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        last_scan_stamp = None
        last_mission = None
        try:
            while not ws.closed:
                state = self.current_state()
                await ws.send_str(
                    json.dumps({"type": "state", "state": state})
                )
                odom = self.ros.latest()
                if odom is not None:
                    await ws.send_str(
                        json.dumps({"type": "pose", **odom})
                    )
                mission = self.ros.latest_mission()
                if mission is not None and mission != last_mission:
                    last_mission = mission
                    await ws.send_str(
                        json.dumps({"type": "mission", **mission})
                    )
                scan = self.ros.latest_scan()
                if scan is not None and scan.get("stamp") != last_scan_stamp:
                    last_scan_stamp = scan.get("stamp")
                    await ws.send_str(
                        json.dumps({"type": "scan", **scan})
                    )
                await asyncio.sleep(0.05)
        finally:
            await ws.close()
        return ws


def create_app(settings):
    agent = AgentApp(settings)
    app = web.Application()
    app["agent"] = agent
    app.router.add_get("/health", agent.health)
    app.router.add_get("/state", agent.state)
    app.router.add_get("/map", agent.map)
    app.router.add_get("/terminal", agent.terminal)
    app.router.add_get("/telemetry", agent.telemetry)
    app.on_startup.append(agent.on_startup)
    app.on_cleanup.append(agent.on_cleanup)
    return app


async def run():
    settings = Settings.from_env()
    os.umask(0o077)
    socket_dir = os.path.dirname(settings.socket_path)
    os.makedirs(socket_dir, mode=0o700, exist_ok=True)
    try:
        os.chmod(socket_dir, 0o700)
    except OSError:
        pass
    if os.path.exists(settings.socket_path):
        os.unlink(settings.socket_path)

    app = create_app(settings)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.UnixSite(runner, settings.socket_path)
    await site.start()
    try:
        os.chmod(settings.socket_path, 0o600)
    except OSError:
        pass

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(signum, stop.set)
        except NotImplementedError:
            pass

    try:
        await stop.wait()
    finally:
        await runner.cleanup()
        try:
            os.unlink(settings.socket_path)
        except OSError:
            pass


def main():
    asyncio.run(run())
