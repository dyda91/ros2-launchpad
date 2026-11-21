import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.pilot import PilotStore


class PilotStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = PilotStore(self.temp.name, 7200, 7200)

    def tearDown(self):
        self.temp.cleanup()

    def test_invite_redeem_consume_and_second_use(self):
        code, invite = self.store.create_invite("guest-1")
        self.assertNotIn(code, str(self.store.list_invites()))
        redeemed = self.store.redeem(code)
        self.assertIsNotNone(redeemed)
        token, invite_id = redeemed
        self.assertEqual(invite_id, invite["id"])
        access = self.store.authorize(token)
        self.assertIsNotNone(access)
        self.assertFalse(access["consumed"])
        self.assertTrue(self.store.consume(token, "session-1"))
        self.assertFalse(self.store.consume(token, "session-2"))
        self.assertTrue(self.store.authorize(token)["consumed"])
        self.assertEqual(
            self.store.list_invites()[0]["uses"],
            1,
        )

    def test_invalid_and_revoked_invites(self):
        self.assertIsNone(self.store.redeem("INVALID-CODE-0000"))
        code, invite = self.store.create_invite("guest-2")
        self.assertTrue(self.store.revoke_invite(invite["id"]))
        self.assertIsNone(self.store.redeem(code))

    def test_control_state_blocks_new_redemptions(self):
        code, _ = self.store.create_invite("guest-3")
        self.store.set_control("paused")
        self.assertEqual(self.store.control_state(), "paused")
        self.assertIsNone(self.store.redeem(code))
        self.store.set_control("open")
        self.assertIsNotNone(self.store.redeem(code))
        self.store.set_control("closed")
        self.assertEqual(self.store.control_state(), "closed")
        self.assertEqual(self.store.revoke_all_invites(), 1)
        self.assertIsNone(self.store.redeem(code))

    def test_progress_events_do_not_include_terminal_content(self):
        code, _ = self.store.create_invite("guest-4")
        token, _ = self.store.redeem(code)
        self.store.consume(token, "session-4")
        self.store.progress_events(
            "tag-4",
            {"stepIndex": 0, "hintsShown": 0},
            {
                "stepIndex": 1,
                "hintsShown": 1,
                "quizDone": True,
                "solutionVisible": True,
            },
            ["topicos", "odometria"],
        )
        lines = Path(self.store.events_path).read_text(encoding="utf-8")
        self.assertIn("step_entered", lines)
        self.assertIn("hint_shown", lines)
        self.assertIn("solution_shown", lines)
        self.assertNotIn("terminal", lines.lower())
        self.assertNotIn(code, lines)

    def test_rate_limit(self):
        key = "ip:127.0.0.1"
        self.assertTrue(self.store.allow_attempt(key, 2, 60))
        self.assertTrue(self.store.allow_attempt(key, 2, 60))
        self.assertFalse(self.store.allow_attempt(key, 2, 60))


if __name__ == "__main__":
    unittest.main()
