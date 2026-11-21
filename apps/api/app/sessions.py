import asyncio
import secrets
from dataclasses import dataclass, field
from typing import Optional

from .agent_client import AgentClient
from .runtime_client import RuntimeClient, RuntimeFull, RuntimeUnavailable


@dataclass
class Session:
    session_id: str
    agent_token: str
    uds_path: str
    state: str = "preparing"
    stage: str = "creating"
    error: Optional[str] = None
    map_data: Optional[dict] = None
    wait_task: Optional[asyncio.Task] = field(default=None, repr=False)


class SessionManager:
    def __init__(self, settings, runtime, agent):
        self.settings = settings
        self.runtime = runtime
        self.agent = agent
        self._session = None
        self._lock = asyncio.Lock()

    def _payload(self, session):
        return {
            "state": session.state,
            "stage": session.stage,
            "error": session.error,
        }

    async def create(self, cookie_id):
        async with self._lock:
            return await self._create_locked(cookie_id)

    async def _create_locked(self, cookie_id):
        if self._session is not None:
            if (
                self._session.session_id == cookie_id
                and self._session.state != "error"
            ):
                return self._payload(self._session), False
            if self._session.state != "error":
                return {"state": "full"}, False
            await self.runtime.delete(self._session.session_id)
            self._session = None

        session_id = secrets.token_urlsafe(24)
        agent_token = secrets.token_urlsafe(32)
        session = Session(
            session_id=session_id,
            agent_token=agent_token,
            uds_path="",
        )
        self._session = session
        try:
            created = await self.runtime.create(session_id, agent_token)
        except RuntimeFull:
            self._session = None
            return {"state": "full"}, False
        except RuntimeUnavailable as exc:
            self._session = None
            return {"state": "error", "error": str(exc)}, False

        session.uds_path = created["uds_path"]
        session.stage = "waiting_odom"
        session.wait_task = asyncio.create_task(
            self._wait_ready(session_id)
        )
        return self._payload(session), True

    async def restart(self, cookie_id):
        async with self._lock:
            session = self._session
            if session is None or session.session_id != cookie_id:
                return {
                    "state": "error",
                    "error": "sessão não encontrada para reiniciar",
                }, False
            if session.wait_task is not None:
                session.wait_task.cancel()
            await self.runtime.delete(session.session_id)
            self._session = None
            return await self._create_locked(None)

    def state(self, cookie_id):
        if self._session is None:
            return {"state": "idle"}
        if self._session.session_id != cookie_id:
            return {"state": "full"}
        return self._payload(self._session)

    async def _wait_ready(self, session_id):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.settings.ready_timeout_seconds
        while loop.time() < deadline:
            session = self._session
            if session is None or session.session_id != session_id:
                return
            try:
                agent_state = await self.agent.state(
                    session.uds_path, session.agent_token
                )
            except Exception:
                await asyncio.sleep(0.5)
                continue
            agent_status = agent_state.get("state")
            if agent_status == "ready":
                session.state = "ready"
                session.stage = "ready"
                return
            if agent_status == "error":
                session.state = "error"
                session.stage = "error"
                session.error = agent_state.get("error") or "simulator error"
                await self.runtime.delete(session.session_id)
                return
            if agent_status:
                session.stage = agent_status
            await asyncio.sleep(0.5)

        session = self._session
        if session is not None and session.session_id == session_id:
            session.state = "error"
            session.stage = "error"
            session.error = "timeout waiting for /odom"
            await self.runtime.delete(session.session_id)

    async def delete(self, cookie_id):
        async with self._lock:
            session = self._session
            if session is None or session.session_id != cookie_id:
                return
            if session.wait_task is not None:
                session.wait_task.cancel()
            await self.runtime.delete(session.session_id)
            self._session = None

    async def map(self, cookie_id):
        session = self._session
        if session is None or session.session_id != cookie_id:
            return None
        if session.state != "ready":
            return None
        if session.map_data is None:
            session.map_data = await self.agent.map(
                session.uds_path, session.agent_token
            )
        return session.map_data

    def ws_session(self, cookie_id):
        session = self._session
        if session is None or session.session_id != cookie_id:
            return None
        return session

    async def shutdown(self):
        async with self._lock:
            if self._session is not None:
                if self._session.wait_task is not None:
                    self._session.wait_task.cancel()
                await self.runtime.delete(self._session.session_id)
                self._session = None
