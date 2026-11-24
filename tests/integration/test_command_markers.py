import asyncio
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, "/opt/launchpad_agent")
sys.path.insert(0, str(ROOT / "lab" / "image" / "agent"))

from launchpad_agent.pty_session import PtySession, scan_markers

PROMPT = b"\x1b]1337;LaunchpadPrompt\x07"


def command_marker(text, code):
    encoded = base64.b64encode(text.encode("utf-8"))
    return b"\x1b]1337;LaunchpadCommand=" + encoded + b";" + str(code).encode() + b"\x07"


def bashrc_source():
    for candidate in (
        Path("/etc/launchpad.bashrc"),
        ROOT / "lab" / "image" / "launchpad.bashrc",
    ):
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")
    raise FileNotFoundError("launchpad.bashrc not found")


class MarkerParserTest(unittest.TestCase):
    def test_complete_markers_in_order(self):
        data = b"saida\r\n" + command_marker("ros2 node list", 0) + PROMPT + b"user$ "
        events, rest = scan_markers(data)
        self.assertEqual(
            events,
            [("command", "ros2 node list", 0), ("prompt", None, None)],
        )
        self.assertEqual(rest, b"")

    def test_partial_marker_is_kept_until_complete(self):
        marker = command_marker("pwd", 0) + PROMPT
        for cut in range(1, len(marker)):
            events, rest = scan_markers(b"abc" + marker[:cut])
            joined, final_rest = scan_markers(rest + marker[cut:])
            all_events = events + joined
            self.assertEqual(
                all_events,
                [("command", "pwd", 0), ("prompt", None, None)],
                msg=f"cut={cut}",
            )
            self.assertEqual(final_rest, b"")

    def test_unrelated_escape_is_not_kept(self):
        events, rest = scan_markers(b"\x1b[0mtexto\x1b[1")
        self.assertEqual(events, [])
        self.assertEqual(rest, b"")

    def test_invalid_base64_is_ignored(self):
        data = b"\x1b]1337;LaunchpadCommand=@@@;0\x07" + PROMPT
        events, _ = scan_markers(data)
        self.assertEqual(events, [("prompt", None, None)])

    def test_unicode_command(self):
        events, _ = scan_markers(command_marker("echo 'olá, robô'", 0))
        self.assertEqual(events, [("command", "echo 'olá, robô'", 0)])

    def test_interrupt_exit_code(self):
        events, _ = scan_markers(command_marker("ros2 topic echo /odom", 130))
        self.assertEqual(events, [("command", "ros2 topic echo /odom", 130)])

    def test_command_is_truncated(self):
        events, _ = scan_markers(command_marker("x" * 600, 0))
        self.assertEqual(len(events[0][1]), 512)


class FakeClient:
    def __init__(self):
        self.closed = False
        self.messages = []

    async def send_str(self, text):
        self.messages.append(json.loads(text))


class BashCommandEventsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        lines = [
            line
            for line in bashrc_source().splitlines()
            if not line.strip().startswith("source ")
        ]
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".bashrc", delete=False, encoding="utf-8"
        )
        handle.write("\n".join(lines) + "\n")
        handle.close()
        self.rcfile = handle.name
        env = {
            "HOME": tempfile.mkdtemp(),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "TERM": "xterm-256color",
            "LANG": "C.UTF-8",
        }
        self.session = PtySession(env, rcfile=self.rcfile)
        self.client = FakeClient()
        self.session.ensure(asyncio.get_running_loop())
        self.session.clients.add(self.client)
        await self.wait_for(lambda: self.session.at_prompt, 20)

    async def asyncTearDown(self):
        self.session.close()
        os.unlink(self.rcfile)

    async def wait_for(self, predicate, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            await asyncio.sleep(0.05)
        self.fail("condition not met in time")

    def commands(self):
        return [m for m in self.client.messages if m["type"] == "command"]

    async def run_line(self, text):
        self.session.send_input(text + "\r")
        await self.wait_for(
            lambda: self.session.at_prompt and not self.session.running
        )
        await asyncio.sleep(0.15)

    async def test_command_events(self):
        await self.run_line("")
        await self.run_line("")
        self.assertEqual(self.commands(), [])

        await self.run_line("true")
        await self.run_line("true")
        await self.run_line("false")
        await self.run_line("echo 'olá'")
        events = self.commands()
        self.assertEqual(
            [(m["command"], m["exit"]) for m in events],
            [("true", 0), ("true", 0), ("false", 1), ("echo 'olá'", 0)],
        )
        self.assertEqual([m["seq"] for m in events], [1, 2, 3, 4])

        await self.run_line("")
        self.assertEqual(len(self.commands()), 4)

        self.session.send_input("sleep 30\r")
        await asyncio.sleep(0.6)
        self.session.send_input("\x03")
        await self.wait_for(lambda: self.session.at_prompt)
        await asyncio.sleep(0.15)
        self.assertEqual(self.commands()[-1]["command"], "sleep 30")
        self.assertEqual(self.commands()[-1]["exit"], 130)

        self.session.send_input("texto sem enter")
        await asyncio.sleep(0.2)
        self.session.send_input("\x03")
        await asyncio.sleep(0.6)
        self.assertEqual(len(self.commands()), 5)


if __name__ == "__main__":
    unittest.main()
