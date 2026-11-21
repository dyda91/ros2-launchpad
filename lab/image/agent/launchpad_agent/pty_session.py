import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios


class PtySession:
    def __init__(self, env):
        self.env = env
        self.loop = None
        self.fd = None
        self.pid = None
        self.clients = set()
        self.buffer = bytearray()

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
                        "source /opt/ros/jazzy/setup.bash; "
                        "source /ros_ws/install/setup.bash; exec bash -i",
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
        if len(self.buffer) > 131072:
            del self.buffer[:-131072]
        text = data.decode("utf-8", "replace")
        for client in list(self.clients):
            if client.closed:
                self.clients.discard(client)
                continue
            self.loop.create_task(
                client.send_str(json.dumps({"type": "output", "data": text}))
            )

    async def add_client(self, client, cols=80, rows=24):
        self.ensure(self.loop or asyncio.get_running_loop(), cols, rows)
        self.clients.add(client)
        if self.buffer:
            await client.send_str(
                json.dumps(
                    {
                        "type": "output",
                        "data": self.buffer.decode("utf-8", "replace"),
                    }
                )
            )

    def remove_client(self, client):
        self.clients.discard(client)

    def write(self, data):
        if self.fd is not None:
            os.write(self.fd, data.encode("utf-8"))

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
