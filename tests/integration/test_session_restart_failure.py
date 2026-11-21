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
        self.fail_create = False

    async def delete(self, session_id):
        self.deleted.append(session_id)

    async def create(self, session_id, agent_token):
        if self.fail_create:
            raise RuntimeUnavailable("new container failed to start")
        return {
            "uds_path": f"/run/sessions/{session_id}/agent.sock",
            "state": "created",
        }


class FakeAgent:
    async def state(self, uds_path, token):
        return {"state": "ready"}


class SessionRestartFailureTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = FakeRuntime()
        self.settings = SimpleNamespace(ready_timeout_seconds=0.1)
        self.manager = SessionManager(self.settings, self.runtime, FakeAgent())
        self.manager._session = Session(
            session_id="old-session",
            agent_token="old-token",
            uds_path="/run/sessions/old-session/agent.sock",
            state="ready",
            stage="ready",
        )

    async def asyncTearDown(self):
        if self.manager._session is not None:
            if self.manager._session.wait_task is not None:
                self.manager._session.wait_task.cancel()
        await asyncio.sleep(0)

    async def test_restart_reports_failure_after_cleanup(self):
        self.runtime.fail_create = True
        payload, created = await self.manager.restart("old-session")
        self.assertFalse(created)
        self.assertEqual(payload["state"], "error")
        self.assertIn("failed", payload["error"])
        self.assertEqual(self.runtime.deleted, ["old-session"])
        self.assertIsNone(self.manager._session)

    async def test_retry_after_failure_creates_a_new_session(self):
        self.runtime.fail_create = True
        await self.manager.restart("old-session")
        self.runtime.fail_create = False
        payload, created = await self.manager.create("old-session")
        self.assertTrue(created)
        self.assertEqual(payload["state"], "preparing")
        self.assertIsNotNone(self.manager._session)
        self.assertNotEqual(self.manager._session.session_id, "old-session")


if __name__ == "__main__":
    unittest.main()
