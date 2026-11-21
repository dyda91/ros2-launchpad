import asyncio
import os
import signal


class LaunchManager:
    def __init__(self):
        self.state = "starting"
        self.error = None
        self.process = None
        self._stopping = False
        self._log = None
        self._watch_task = None

    async def start(self):
        self._log = open("/tmp/lab_launch.log", "wb")
        self.process = await asyncio.create_subprocess_exec(
            "ros2",
            "launch",
            "launchpad_bringup",
            "lab.launch.py",
            cwd="/ros_ws",
            env=os.environ.copy(),
            stdout=self._log,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        self.state = "waiting_odom"
        self._watch_task = asyncio.create_task(self._watch())

    async def _watch(self):
        code = await self.process.wait()
        if not self._stopping:
            self.state = "error"
            self.error = f"launch exited with code {code}"

    @property
    def pid(self):
        return self.process.pid if self.process is not None else None

    async def stop(self):
        self._stopping = True
        if self._watch_task is not None:
            self._watch_task.cancel()
        process = self.process
        if process is not None and process.returncode is None:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await process.wait()
        if self._log is not None:
            self._log.close()
            self._log = None
