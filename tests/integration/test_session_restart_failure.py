import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.runtime_client import RuntimeUnavailable
from app.sessions import Session, SessionManager


class FakeRuntime:
    def __init__(self):
        self.deleted = []
        self.created = []
        self.fail_create = False

    async def delete(self, session_id):
        self.deleted.append(session_id)

    async def create(self, session_id, agent_token):
        if self.fail_create:
            raise RuntimeUnavailable("new container failed to start")
        self.created.append(session_id)
        return {
            "uds_path": f"/run/sessions/{session_id}/agent.sock",
            "container_id": f"container-{session_id}",
            "state": "running",
        }


class FakeAgent:
    async def state(self, uds_path, token):
        return {"state": "ready"}


def settings(**overrides):
    values = {
        "ready_timeout_seconds": 0.1,
        "max_sessions": 2,
        "session_ttl_seconds": 100,
        "session_idle_seconds": 100,
        "session_warning_seconds": 10,
        "monitor_interval_seconds": 0.05,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class SessionRestartFailureTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = FakeRuntime()
        self.manager = SessionManager(
            settings(), self.runtime, FakeAgent()
        )
        self.session = Session(
            session_id="old-session",
            agent_token="old-token",
            uds_path="/run/sessions/old-session/agent.sock",
            state="ready",
            stage="ready",
        )
        self.manager._sessions["old-session"] = self.session

    async def asyncTearDown(self):
        for session in list(self.manager._sessions.values()):
            if session.wait_task is not None:
                session.wait_task.cancel()
        await asyncio.sleep(0)

    async def test_restart_reports_failure_after_cleanup(self):
        self.runtime.fail_create = True
        payload, created, session_id = await self.manager.restart("old-session")
        self.assertFalse(created)
        self.assertEqual(session_id, "old-session")
        self.assertEqual(payload["state"], "error")
        self.assertIn("failed", payload["error"])
        self.assertEqual(self.runtime.deleted, ["old-session"])
        self.assertEqual(
            self.manager._sessions["old-session"].state, "error"
        )

    async def test_retry_after_failure_creates_a_new_session(self):
        self.runtime.fail_create = True
        await self.manager.restart("old-session")
        self.runtime.fail_create = False
        payload, created, session_id = await self.manager.create("old-session")
        self.assertTrue(created)
        self.assertEqual(payload["state"], "preparing")
        self.assertNotEqual(session_id, "old-session")
        self.assertIn(session_id, self.manager._sessions)
        self.assertNotIn("old-session", self.manager._sessions)


if __name__ == "__main__":
    unittest.main()
