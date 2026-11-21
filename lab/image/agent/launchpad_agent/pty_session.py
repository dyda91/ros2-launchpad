import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios

PROMPT_MARKER = b"\x1b]1337;LaunchpadPrompt\x07"


class PtySession:
    def __init__(self, env):
        self.env = env
        self.loop = None
        self.fd = None
        self.pid = None
        self.clients = set()
        self.buffer = bytearray()
        self.offset = 0
        self.buffer_start = 0
        self._scan_buffer = bytearray()
        self.at_prompt = False
        self.line_empty = True
        self.running = False
        self._last_state = None

    def ensure(self, loop, cols=80, rows=24):
        if self.fd is not None:
            return
        self.loop = loop
        pid, fd = pty.fork()
        if pid == 0:
            try:
                os.execvpe(
                    "/bin/bash",
                    [
                        "bash",
                        "-lc",
                        "exec bash --noprofile "
                        "--rcfile /etc/launchpad.bashrc -i",
                    ],
                    self.env,
                )
            finally:
                os._exit(127)
        self.pid = pid
        self.fd = fd
        os.set_blocking(fd, False)
        self.resize(cols, rows)
        loop.add_reader(fd, self._on_readable)

    def _on_readable(self):
        try:
            data = os.read(self.fd, 65536)
        except BlockingIOError:
            return
        except OSError:
            self.close()
            return
        if not data:
            self.close()
            return
        self.buffer.extend(data)
        self.offset += len(data)
        if len(self.buffer) > 131072:
            del self.buffer[:-131072]
        self.buffer_start = self.offset - len(self.buffer)
        self._scan_for_prompt(data)
        text = data.decode("utf-8", "replace")
        for client in list(self.clients):
            if client.closed:
                self.clients.discard(client)
                continue
            self.loop.create_task(
                client.send_str(json.dumps({"type": "output", "data": text}))
            )

    def _scan_for_prompt(self, data):
        self._scan_buffer.extend(data)
        if len(self._scan_buffer) > 4096:
            del self._scan_buffer[:-4096]
        index = self._scan_buffer.find(PROMPT_MARKER)
        if index < 0:
            return
        del self._scan_buffer[: index + len(PROMPT_MARKER)]
        self._set_state(True, True, False)

    def terminal_state(self):
        return {
            "type": "terminal_state",
            "prompt": self.at_prompt,
            "lineEmpty": self.line_empty,
            "running": self.running,
        }

    def _set_state(self, prompt, line_empty, running):
        state = (prompt, line_empty, running)
        if state == self._last_state:
            return
        self.at_prompt = prompt
        self.line_empty = line_empty
        self.running = running
        self._last_state = state
        if self.loop is None:
            return
        payload = json.dumps(self.terminal_state())
        for client in list(self.clients):
            if client.closed:
                self.clients.discard(client)
                continue
            self.loop.create_task(client.send_str(payload))

    async def add_client(self, client, cols=80, rows=24, since=None):
        self.ensure(self.loop or asyncio.get_running_loop(), cols, rows)
        self.clients.add(client)
        reset = True
        start = self.buffer_start
        if isinstance(since, int) and self.buffer_start <= since <= self.offset:
            reset = False
            start = since
        if reset:
            await client.send_str(json.dumps({"type": "reset"}))
        await client.send_str(
            json.dumps({"type": "stream_start", "offset": start})
        )
        data = bytes(self.buffer[start - self.buffer_start :])
        if data:
            await client.send_str(
                json.dumps(
                    {
                        "type": "output",
                        "data": data.decode("utf-8", "replace"),
                    }
                )
            )
        await client.send_str(json.dumps(self.terminal_state()))

    def remove_client(self, client):
        self.clients.discard(client)

    def send_input(self, data):
        if self.fd is None or not data:
            return
        if "\r" in data or "\n" in data:
            self._set_state(False, False, True)
        elif self.at_prompt:
            self._set_state(True, False, False)
        os.write(self.fd, data.encode("utf-8"))

    def can_insert(self):
        return self.at_prompt and self.line_empty and not self.running

    def insert(self, text):
        if not self.can_insert():
            return False, "o shell não está no prompt com a linha vazia"
        os.write(self.fd, text.encode("utf-8"))
        self._set_state(True, False, False)
        return True, ""

    def resize(self, cols, rows):
        if self.fd is None:
            return
        cols = max(20, min(300, int(cols)))
        rows = max(5, min(120, int(rows)))
        fcntl.ioctl(
            self.fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", rows, cols, 0, 0),
        )

    def close(self):
        if self.fd is not None:
            if self.loop is not None:
                self.loop.remove_reader(self.fd)
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None
        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(self.pid, 0)
            except ChildProcessError:
                pass
            self.pid = None
        self.clients.clear()
