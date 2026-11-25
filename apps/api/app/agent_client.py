import aiohttp


class AgentClient:
    def _session(self, uds_path):
        connector = aiohttp.UnixConnector(path=uds_path)
        return aiohttp.ClientSession(connector=connector)

    async def state(self, uds_path, token):
        async with self._session(uds_path) as client:
            async with client.get(
                "http://localhost/state",
                headers={"X-Agent-Token": token},
            ) as response:
                if response.status != 200:
                    raise RuntimeError(
                        f"agent state returned {response.status}"
                    )
                return await response.json()

    async def map(self, uds_path, token):
        async with self._session(uds_path) as client:
            async with client.get(
                "http://localhost/map",
                headers={"X-Agent-Token": token},
            ) as response:
                if response.status != 200:
                    raise RuntimeError(
                        f"agent map returned {response.status}"
                    )
                return await response.json()

    async def reset_pose(self, uds_path, token):
        async with self._session(uds_path) as client:
            async with client.post(
                "http://localhost/reset-pose",
                headers={"X-Agent-Token": token},
            ) as response:
                if response.status != 200:
                    raise RuntimeError(
                        f"agent reset returned {response.status}"
                    )

    async def connect(self, uds_path, token, path):
        client = self._session(uds_path)
        websocket = await client.ws_connect(
            f"http://localhost{path}",
            headers={"X-Agent-Token": token},
            heartbeat=30,
        )
        return client, websocket
