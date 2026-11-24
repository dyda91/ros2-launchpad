#!/usr/bin/env python3

import argparse
import asyncio
import json
import random
import statistics
import time

import aiohttp

PROMPT = b"\x1b]1337;LaunchpadPrompt\x07"
ACTIONS = [
    ("topic_list", "ros2 topic list\n", 0.0),
    ("echo_once", "ros2 topic echo --once /odom\n", 0.0),
    (
        "drive",
        "ros2 topic pub --rate 10 --times 30 /cmd_vel "
        'geometry_msgs/msg/Twist "{linear: {x: 0.2}}"\n',
        0.0,
    ),
    ("echo_scan", "ros2 topic echo /scan\n", 4.0),
]


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))
    return round(ordered[index], 3)


class SessionLoad:
    def __init__(self, index, base, origin, profile, think):
        self.index = index
        self.base = base
        self.origin = origin
        self.profile = profile
        self.think = think
        self.ready_seconds = None
        self.error = None
        self.pose_count = 0
        self.scan_count = 0
        self.first_pose = None
        self.last_pose = None
        self.telemetry_bytes = 0
        self.latencies = {}
        self.prompt_event = asyncio.Event()
        self.stop = False

    async def open(self, http):
        started = time.monotonic()
        async with http.post(f"{self.base}/api/session") as response:
            if response.status not in (200, 202):
                self.error = f"create status {response.status}"
                return False
        while time.monotonic() - started < 120:
            async with http.get(f"{self.base}/api/session") as response:
                payload = await response.json()
            if payload.get("state") == "ready":
                self.ready_seconds = round(time.monotonic() - started, 2)
                return True
            if payload.get("state") == "error":
                self.error = "session error"
                return False
            await asyncio.sleep(0.5)
        self.error = "ready timeout"
        return False

    async def read_telemetry(self, http):
        url = self.base.replace("http", "ws", 1) + "/ws/telemetry"
        async with http.ws_connect(url, headers={"Origin": self.origin}) as ws:
            async for message in ws:
                if message.type != aiohttp.WSMsgType.TEXT:
                    continue
                self.telemetry_bytes += len(message.data)
                if '"type": "pose"' in message.data[:30] or '"type":"pose"' in message.data[:30]:
                    self.pose_count += 1
                    payload = json.loads(message.data)
                    stamp = (payload["x"], payload["y"], payload["yaw"])
                    if self.first_pose is None:
                        self.first_pose = stamp
                    self.last_pose = stamp
                elif '"scan"' in message.data[:30]:
                    self.scan_count += 1
                if self.stop:
                    break

    async def read_terminal(self, ws):
        async for message in ws:
            data = message.data
            if isinstance(data, str):
                data = data.encode("utf-8", "ignore")
            if PROMPT in data:
                self.prompt_event.set()
            if self.stop:
                break

    async def run_command(self, ws, name, text, hold):
        self.prompt_event.clear()
        started = time.monotonic()
        await ws.send_json({"type": "input", "data": text})
        if hold:
            await asyncio.sleep(hold)
            await ws.send_json({"type": "input", "data": "\x03"})
        try:
            await asyncio.wait_for(self.prompt_event.wait(), timeout=60)
        except asyncio.TimeoutError:
            self.latencies.setdefault(name, []).append(60.0)
            return
        self.latencies.setdefault(name, []).append(time.monotonic() - started)

    async def keepalive(self, http):
        while not self.stop:
            await asyncio.sleep(30)
            try:
                async with http.post(f"{self.base}/api/session/touch"):
                    pass
            except aiohttp.ClientError:
                pass

    async def run(self, deadline):
        jar = aiohttp.CookieJar(unsafe=True)
        async with aiohttp.ClientSession(cookie_jar=jar) as http:
            if not await self.open(http):
                return
            telemetry = asyncio.create_task(self.read_telemetry(http))
            keep = asyncio.create_task(self.keepalive(http))
            url = self.base.replace("http", "ws", 1) + "/ws/terminal?cols=100&rows=30"
            try:
                async with http.ws_connect(url, headers={"Origin": self.origin}) as ws:
                    reader = asyncio.create_task(self.read_terminal(ws))
                    await asyncio.sleep(random.uniform(0.5, 3.0))
                    if self.profile == "active":
                        while time.monotonic() < deadline:
                            name, text, hold = random.choice(ACTIONS)
                            await self.run_command(ws, name, text, hold)
                            await asyncio.sleep(
                                random.uniform(0.5, 1.5) * self.think
                            )
                    else:
                        while time.monotonic() < deadline:
                            await asyncio.sleep(1.0)
                    self.stop = True
                    reader.cancel()
            except Exception as error:
                self.error = f"terminal: {error}"
            self.stop = True
            telemetry.cancel()
            keep.cancel()
            try:
                async with http.delete(f"{self.base}/api/session"):
                    pass
            except aiohttp.ClientError:
                pass


def read_cpu():
    with open("/proc/stat", "r", encoding="utf-8") as handle:
        fields = [int(value) for value in handle.readline().split()[1:]]
    idle = fields[3] + fields[4]
    return sum(fields), idle


def read_memory():
    values = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as handle:
        for line in handle:
            key, rest = line.split(":", 1)
            values[key] = int(rest.split()[0])
    return values["MemTotal"], values["MemAvailable"]


async def sample_host(deadline, samples):
    total, idle = read_cpu()
    while time.monotonic() < deadline:
        await asyncio.sleep(2.0)
        new_total, new_idle = read_cpu()
        delta_total = new_total - total
        delta_idle = new_idle - idle
        total, idle = new_total, new_idle
        mem_total, mem_available = read_memory()
        with open("/proc/loadavg", "r", encoding="utf-8") as handle:
            load = float(handle.read().split()[0])
        samples.append(
            {
                "t": round(time.monotonic(), 1),
                "cpu_percent": round(
                    100.0 * (1.0 - delta_idle / delta_total) if delta_total else 0.0,
                    1,
                ),
                "mem_used_mib": round((mem_total - mem_available) / 1024.0, 0),
                "load1": load,
            }
        )


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", type=int, default=2)
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--profile", choices=["idle", "active"], default="idle")
    parser.add_argument("--think", type=float, default=10.0)
    parser.add_argument("--stagger", type=float, default=1.0)
    parser.add_argument("--base", default="http://127.0.0.1:8080")
    parser.add_argument("--origin", default="http://localhost:8080")
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    random.seed(7)
    loads = [
        SessionLoad(i, args.base, args.origin, args.profile, args.think)
        for i in range(args.sessions)
    ]
    host = []
    started = time.monotonic()
    deadline = started + args.sessions * args.stagger + args.duration + 60

    async def launch(load, delay):
        await asyncio.sleep(delay)
        await load.run(started + args.sessions * args.stagger + 40 + args.duration)

    sampler = asyncio.create_task(sample_host(deadline, host))
    tasks = [
        asyncio.create_task(launch(load, i * args.stagger))
        for i, load in enumerate(loads)
    ]
    await asyncio.gather(*tasks)
    sampler.cancel()

    ready = [load.ready_seconds for load in loads if load.ready_seconds]
    steady_from = started + args.sessions * args.stagger + 40
    window = [item for item in host if item["t"] >= steady_from] or host
    summary = {
        "sessions": args.sessions,
        "profile": args.profile,
        "created": len(ready),
        "errors": [load.error for load in loads if load.error],
        "ready_seconds": {
            "p50": percentile(ready, 0.5),
            "p95": percentile(ready, 0.95),
            "max": max(ready) if ready else None,
        },
        "host_cpu_percent_mean": round(
            statistics.mean(item["cpu_percent"] for item in window), 1
        )
        if window
        else None,
        "host_cpu_percent_max": max((item["cpu_percent"] for item in window), default=None),
        "host_mem_used_mib_max": max((item["mem_used_mib"] for item in window), default=None),
        "host_load1_max": max((item["load1"] for item in window), default=None),
        "pose_messages_per_session": [load.pose_count for load in loads],
        "scan_messages_per_session": [load.scan_count for load in loads],
        "telemetry_kib_per_session": [round(load.telemetry_bytes / 1024) for load in loads],
        "latency_seconds": {},
    }
    merged = {}
    for load in loads:
        for name, values in load.latencies.items():
            merged.setdefault(name, []).extend(values)
    for name, values in merged.items():
        summary["latency_seconds"][name] = {
            "n": len(values),
            "p50": percentile(values, 0.5),
            "p95": percentile(values, 0.95),
            "max": round(max(values), 3),
        }
    text = json.dumps(summary, indent=2)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)


if __name__ == "__main__":
    asyncio.run(main())
