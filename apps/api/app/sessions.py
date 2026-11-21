import asyncio
import hashlib
import json
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional

from .agent_client import AgentClient
from .runtime_client import RuntimeClient, RuntimeFull, RuntimeUnavailable

ACTIVE_STATES = {"preparing", "ready"}
ERROR_GRACE_SECONDS = 300.0
EXPIRED_GRACE_SECONDS = 900.0


@dataclass
class Session:
    session_id: str
    agent_token: str
    uds_path: str = ""
    container_id: Optional[str] = None
    state: str = "preparing"
    stage: str = "creating"
    error: Optional[str] = None
    map_data: Optional[dict] = None
    progress: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.monotonic)
    last_activity: float = field(default_factory=time.monotonic)
    error_since: Optional[float] = None
    wait_task: Optional[asyncio.Task] = field(default=None, repr=False)
    generation: int = 0
    health_failures: int = 0


class SessionManager:
    def __init__(self, settings, runtime, agent):
        self.settings = settings
        self.runtime = runtime
        self.agent = agent
        self._sessions = {}
        self._expired = {}
        self._lock = asyncio.Lock()
        self._maintenance_task = None
        self._closed = False

    async def start(self):
        for attempt in range(60):
            try:
                await self.runtime.reconcile()
                break
            except RuntimeUnavailable:
                if attempt == 59:
                    raise
                await asyncio.sleep(1)
        self._maintenance_task = asyncio.create_task(self._maintenance())

    def _active_count(self):
        return sum(
            1
            for session in self._sessions.values()
            if session.state in ACTIVE_STATES
        )

    def _session_tag(self, session_id):
        return hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:6]

    def _lifecycle(self, session, now=None):
        now = time.monotonic() if now is None else now
        idle_remaining = max(
            0.0,
            session.last_activity + self.settings.session_idle_seconds - now,
        )
        hard_remaining = max(
            0.0,
            session.created_at + self.settings.session_ttl_seconds - now,
        )
        warning = min(idle_remaining, hard_remaining) <= (
            self.settings.session_warning_seconds
        )
        return {
            "idle_expires_in": round(idle_remaining, 1),
            "hard_expires_in": round(hard_remaining, 1),
            "warning": warning,
        }

    def _payload(self, session):
        return {
            "state": session.state,
            "stage": session.stage,
            "error": session.error,
            "session_tag": self._session_tag(session.session_id),
            "progress": dict(session.progress),
            "lifecycle": self._lifecycle(session),
        }

    def _touch_locked(self, session):
        session.last_activity = time.monotonic()

    def _remove_locked(self, session, expired=False, now=None):
        if self._sessions.get(session.session_id) is not session:
            return
        del self._sessions[session.session_id]
        if session.wait_task is not None:
            session.wait_task.cancel()
            session.wait_task = None
        if expired:
            self._expired[session.session_id] = (
                time.monotonic() if now is None else now
            )

    def _active_sessions(self):
        return [
            session
            for session in self._sessions.values()
            if session.state in ACTIVE_STATES
        ]

    def active_count(self):
        return self._active_count()

    def lifecycle(self, session):
        return self._lifecycle(session)

    async def create(self, cookie_id):
        async with self._lock:
            if cookie_id and cookie_id in self._sessions:
                session = self._sessions[cookie_id]
                if session.state != "error":
                    self._touch_locked(session)
                    return self._payload(session), False, None
                self._remove_locked(session)
            if cookie_id in self._expired:
                del self._expired[cookie_id]
            if self._active_count() >= self.settings.max_sessions:
                return {
                    "state": "full",
                    "active": self._active_count(),
                    "max": self.settings.max_sessions,
                }, False, None

            session_id = secrets.token_urlsafe(24)
            session = Session(
                session_id=session_id,
                agent_token=secrets.token_urlsafe(32),
            )
            self._touch_locked(session)
            self._sessions[session_id] = session

        try:
            created = await self.runtime.create(
                session.session_id, session.agent_token
            )
        except RuntimeFull:
            async with self._lock:
                self._remove_locked(session)
            return {"state": "full"}, False, None
        except RuntimeUnavailable as exc:
            async with self._lock:
                self._remove_locked(session)
            return {"state": "error", "error": str(exc)}, False, None

        cleanup = False
        async with self._lock:
            if self._sessions.get(session.session_id) is not session:
                cleanup = True
            else:
                session.uds_path = created["uds_path"]
                session.container_id = created.get("container_id")
                session.stage = "waiting_odom"
                session.state = "preparing"
                session.generation += 1
                session.wait_task = asyncio.create_task(
                    self._wait_ready(session.session_id, session.generation)
                )
                payload = self._payload(session)
        if cleanup:
            await self.runtime.delete(session.session_id)
            return {
                "state": "error",
                "error": "sessão foi encerrada durante a criação",
            }, False, None
        return payload, True, session.session_id

    async def _wait_ready(self, session_id, generation):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.settings.ready_timeout_seconds
        while loop.time() < deadline:
            session = self._sessions.get(session_id)
            if (
                session is None
                or session.generation != generation
                or session.state not in {"preparing", "ready"}
            ):
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
                async with self._lock:
                    current = self._sessions.get(session_id)
                    if current is session:
                        current.state = "ready"
                        current.stage = "ready"
                        current.health_failures = 0
                        current.wait_task = None
                return
            if agent_status == "error":
                async with self._lock:
                    current = self._sessions.get(session_id)
                    if current is session:
                        current.state = "error"
                        current.stage = "error"
                        current.error = (
                            agent_state.get("error") or "simulator error"
                        )
                        current.error_since = time.monotonic()
                        current.wait_task = None
                await self.runtime.delete(session_id)
                return
            if agent_status:
                async with self._lock:
                    current = self._sessions.get(session_id)
                    if current is session:
                        current.stage = agent_status
            await asyncio.sleep(0.5)

        async with self._lock:
            current = self._sessions.get(session_id)
            if (
                current is session
                and current.state in {"preparing", "ready"}
            ):
                current.state = "error"
                current.stage = "error"
                current.error = "timeout waiting for /odom"
                current.error_since = time.monotonic()
                current.wait_task = None
        await self.runtime.delete(session_id)

    def state(self, cookie_id):
        if cookie_id and cookie_id in self._sessions:
            return self._payload(self._sessions[cookie_id])
        if cookie_id and cookie_id in self._expired:
            return {
                "state": "expired",
                "lifecycle": {
                    "idle_expires_in": 0,
                    "hard_expires_in": 0,
                    "warning": True,
                },
            }
        if self._active_count() >= self.settings.max_sessions:
            return {
                "state": "full",
                "active": self._active_count(),
                "max": self.settings.max_sessions,
            }
        return {"state": "idle"}

    async def touch(self, cookie_id):
        async with self._lock:
            session = self._sessions.get(cookie_id)
            if session is None or session.state in {"error", "expired"}:
                return None
            self._touch_locked(session)
            return self._lifecycle(session)

    async def save_progress(self, cookie_id, progress):
        if not self._valid_progress(progress):
            return False
        async with self._lock:
            session = self._sessions.get(cookie_id)
            if session is None or session.state not in ACTIVE_STATES:
                return False
            session.progress = progress
            self._touch_locked(session)
            return True

    def _valid_progress(self, progress):
        if not isinstance(progress, dict):
            return False
        if len(json.dumps(progress)) > 16384:
            return False
        step = progress.get("stepIndex")
        if not isinstance(step, int) or step < 0 or step > 5:
            return False
        for key in (
            "selected",
            "predictionSelected",
        ):
            value = progress.get(key)
            if value is not None and not isinstance(value, int):
                return False
        for key in (
            "quizDone",
            "predictionDone",
            "motionDone",
            "solutionVisible",
        ):
            value = progress.get(key)
            if value is not None and not isinstance(value, bool):
                return False
        hints = progress.get("hintsShown")
        if hints is not None and (not isinstance(hints, int) or hints < 0):
            return False
        motion_start = progress.get("motionStart")
        if motion_start is not None:
            if not isinstance(motion_start, dict):
                return False
            for key in ("x", "y", "yaw"):
                if not isinstance(motion_start.get(key), (int, float)):
                    return False
        return True

    async def restart(self, cookie_id):
        async with self._lock:
            session = self._sessions.get(cookie_id)
            if session is None:
                return {
                    "state": "error",
                    "error": "sessão não encontrada",
                }, False, None
            if session.state not in ACTIVE_STATES:
                return {
                    "state": "error",
                    "error": "a sessão não está ativa; inicie novamente",
                }, False, None
            if session.wait_task is not None:
                session.wait_task.cancel()
                session.wait_task = None
            session.state = "preparing"
            session.stage = "restarting"
            session.error = None
            session.error_since = None
            session.progress = {}
            session.map_data = None
            session.health_failures = 0
            session.generation += 1
            session.agent_token = secrets.token_urlsafe(32)
            self._touch_locked(session)
            await self.runtime.delete(session.session_id)
            try:
                created = await self.runtime.create(
                    session.session_id, session.agent_token
                )
            except (RuntimeUnavailable, RuntimeFull) as exc:
                session.state = "error"
                session.stage = "error"
                session.error = str(exc)
                session.error_since = time.monotonic()
                session.uds_path = ""
                session.container_id = None
                return self._payload(session), False, session.session_id
            session.uds_path = created["uds_path"]
            session.container_id = created.get("container_id")
            session.stage = "waiting_odom"
            session.wait_task = asyncio.create_task(
                self._wait_ready(session.session_id, session.generation)
            )
            return self._payload(session), False, session.session_id

    async def delete(self, cookie_id):
        async with self._lock:
            session = self._sessions.get(cookie_id)
            if session is None:
                return
            self._remove_locked(session)
            await self.runtime.delete(session.session_id)

    async def map(self, cookie_id):
        session = self._sessions.get(cookie_id)
        if session is None or session.state != "ready":
            return None
        if session.map_data is None:
            session.map_data = await self.agent.map(
                session.uds_path, session.agent_token
            )
        return session.map_data

    def session(self, cookie_id):
        return self._sessions.get(cookie_id)

    def ws_session(self, cookie_id):
        session = self._sessions.get(cookie_id)
        if session is None or session.state != "ready":
            return None
        return session

    async def _maintenance(self):
        interval = self.settings.monitor_interval_seconds
        while not self._closed:
            await asyncio.sleep(interval)
            await self._expire_due()
            await self._check_health()
            async with self._lock:
                now = time.monotonic()
                for session in list(self._sessions.values()):
                    if (
                        session.state == "error"
                        and session.error_since is not None
                        and now - session.error_since > ERROR_GRACE_SECONDS
                    ):
                        self._remove_locked(session)
                for session_id, expired_at in list(self._expired.items()):
                    if now - expired_at > EXPIRED_GRACE_SECONDS:
                        del self._expired[session_id]

    async def _expire_due(self):
        expired = []
        async with self._lock:
            now = time.monotonic()
            for session in list(self._sessions.values()):
                if session.state not in ACTIVE_STATES:
                    continue
                idle_deadline = (
                    session.last_activity + self.settings.session_idle_seconds
                )
                hard_deadline = (
                    session.created_at + self.settings.session_ttl_seconds
                )
                if now >= idle_deadline or now >= hard_deadline:
                    self._remove_locked(session, expired=True, now=now)
                    expired.append(session.session_id)
        for session_id in expired:
            await self.runtime.delete(session_id)

    async def _check_health(self):
        async with self._lock:
            ready = [
                session
                for session in self._sessions.values()
                if session.state == "ready"
            ]
        for session in ready:
            try:
                await self.agent.state(session.uds_path, session.agent_token)
            except Exception:
                cleanup = False
                async with self._lock:
                    current = self._sessions.get(session.session_id)
                    if current is not session or current.state != "ready":
                        continue
                    current.health_failures += 1
                    if current.health_failures >= 2:
                        current.state = "error"
                        current.stage = "error"
                        current.error = "agente do laboratório indisponível"
                        current.error_since = time.monotonic()
                        cleanup = True
                if cleanup:
                    await self.runtime.delete(session.session_id)
            else:
                async with self._lock:
                    current = self._sessions.get(session.session_id)
                    if current is session:
                        current.health_failures = 0

    async def shutdown(self):
        self._closed = True
        if self._maintenance_task is not None:
            self._maintenance_task.cancel()
            self._maintenance_task = None
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
            self._expired.clear()
        for session in sessions:
            await self.runtime.delete(session.session_id)
