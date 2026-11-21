import asyncio
from pathlib import Path
import sys
import time
from types import SimpleNamespace
import unittest

sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.runtime_client import RuntimeFull
from app.sessions import Session, SessionManager


class FakeRuntime:
    def __init__(self, max_sessions=2):
        self.max_sessions = max_sessions
        self.created = []
        self.deleted = []
        self.reconciled = 0
        self.delay = 0.0

    async def reconcile(self):
        self.reconciled += 1

    async def create(self, session_id, agent_token):
        if self.delay:
            await asyncio.sleep(self.delay)
        if len(self.created) - len(self.deleted) >= self.max_sessions:
            raise RuntimeFull("full")
        self.created.append(session_id)
        return {
            "uds_path": f"/run/sessions/{session_id}/agent.sock",
            "container_id": f"container-{session_id}",
            "state": "running",
        }

    async def delete(self, session_id):
        self.deleted.append(session_id)


class FakeAgent:
    async def state(self, uds_path, token):
        return {"state": "ready"}


def make_settings(**overrides):
    values = {
        "ready_timeout_seconds": 0.2,
        "max_sessions": 2,
        "session_ttl_seconds": 100,
        "session_idle_seconds": 100,
        "session_warning_seconds": 10,
        "monitor_interval_seconds": 0.05,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class SessionCapacityTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = FakeRuntime()
        self.manager = SessionManager(
            make_settings(), self.runtime, FakeAgent()
        )

    async def asyncTearDown(self):
        for session in list(self.manager._sessions.values()):
            if session.wait_task is not None:
                session.wait_task.cancel()
        await asyncio.sleep(0)

    async def create(self, cookie=None):
        payload, created, session_id = await self.manager.create(cookie)
        if created and session_id:
            task = self.manager._sessions[session_id].wait_task
            if task is not None:
                await task
        return payload, created, session_id

    async def test_two_sessions_and_third_is_full(self):
        first, created, first_id = await self.create()
        second, created_second, second_id = await self.create()
        self.assertTrue(created)
        self.assertTrue(created_second)
        self.assertIsNotNone(first_id)
        self.assertIsNotNone(second_id)
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(self.manager.active_count(), 2)
        payload, created_third, third_id = await self.create()
        self.assertFalse(created_third)
        self.assertIsNone(third_id)
        self.assertEqual(payload["state"], "full")

    async def test_slot_is_released_after_end(self):
        _, _, first_id = await self.create()
        _, _, second_id = await self.create()
        await self.manager.delete(first_id)
        self.assertEqual(self.manager.active_count(), 1)
        payload, created, third_id = await self.create()
        self.assertTrue(created)
        self.assertIsNotNone(third_id)
        self.assertEqual(payload["state"], "preparing")
        self.assertNotEqual(third_id, second_id)

    async def test_reservation_is_atomic(self):
        self.manager.settings = make_settings(max_sessions=1)
        self.runtime.delay = 0.05
        results = await asyncio.gather(
            self.manager.create(None), self.manager.create(None)
        )
        created = [result for result in results if result[1]]
        full = [result for result in results if result[0]["state"] == "full"]
        self.assertEqual(len(created), 1)
        self.assertEqual(len(full), 1)

    async def test_progress_is_isolated_and_validated(self):
        _, _, first_id = await self.create()
        _, _, second_id = await self.create()
        progress = {
            "stepIndex": 2,
            "selected": None,
            "quizDone": True,
            "quizWrong": False,
            "predictionSelected": 1,
            "predictionDone": True,
            "predictionWrong": False,
            "hintsShown": 1,
            "solutionVisible": False,
            "motionStart": {"x": 0.0, "y": 0.0, "yaw": 0.0},
            "motionDone": False,
        }
        self.assertTrue(await self.manager.save_progress(first_id, progress))
        self.assertEqual(
            self.manager.state(first_id)["progress"]["stepIndex"], 2
        )
        self.assertFalse(
            self.manager.state(second_id).get("progress", {}).get("stepIndex")
        )
        self.assertFalse(
            await self.manager.save_progress(first_id, {"stepIndex": 99})
        )
        self.assertFalse(
            await self.manager.save_progress(second_id, {"stepIndex": -1})
        )

    async def test_idle_expiration_releases_slot(self):
        _, _, first_id = await self.create()
        _, _, second_id = await self.create()
        session = self.manager._sessions[first_id]
        session.last_activity = time.monotonic() - 101
        await self.manager._expire_due()
        self.assertNotIn(first_id, self.manager._sessions)
        self.assertIn(first_id, self.manager._expired)
        self.assertIn(first_id, self.runtime.deleted)
        self.assertEqual(self.manager.state(first_id)["state"], "expired")
        self.assertEqual(self.manager.active_count(), 1)
        payload, created, third_id = await self.create()
        self.assertTrue(created)
        self.assertEqual(payload["state"], "preparing")
        self.assertNotEqual(third_id, second_id)

    async def test_hard_ttl_expiration(self):
        _, _, session_id = await self.create()
        session = self.manager._sessions[session_id]
        session.created_at = time.monotonic() - 101
        await self.manager._expire_due()
        self.assertNotIn(session_id, self.manager._sessions)
        self.assertEqual(self.manager.state(session_id)["state"], "expired")

    async def test_lifecycle_warns_near_deadline(self):
        _, _, session_id = await self.create()
        session = self.manager._sessions[session_id]
        session.last_activity = time.monotonic() - 95
        lifecycle = self.manager.lifecycle(session)
        self.assertTrue(lifecycle["warning"])
        self.assertLessEqual(lifecycle["idle_expires_in"], 10)

    async def test_start_reconciles_orphans(self):
        await self.manager.start()
        self.assertEqual(self.runtime.reconciled, 1)
        await self.manager.shutdown()


if __name__ == "__main__":
    unittest.main()
