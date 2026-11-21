import httpx


class RuntimeUnavailable(RuntimeError):
    pass


class RuntimeFull(RuntimeError):
    pass


class RuntimeClient:
    def __init__(self, settings):
        self.settings = settings
        self.client = httpx.AsyncClient(
            base_url=settings.runtime_url,
            headers={"Authorization": f"Bearer {settings.runtime_token}"},
            timeout=20.0,
        )

    async def close(self):
        await self.client.aclose()

    async def health(self):
        try:
            response = await self.client.get("/v1/health")
            return response.status_code == 200
        except httpx.HTTPError:
            return False

    async def create(self, session_id, agent_token):
        try:
            response = await self.client.post(
                "/v1/sessions",
                json={"session_id": session_id, "agent_token": agent_token},
            )
        except httpx.HTTPError as exc:
            raise RuntimeUnavailable(str(exc)) from exc
        if response.status_code == 409:
            raise RuntimeFull(response.text)
        if response.status_code != 200:
            raise RuntimeUnavailable(response.text)
        return response.json()

    async def delete(self, session_id):
        try:
            await self.client.delete(f"/v1/sessions/{session_id}")
        except httpx.HTTPError:
            pass

    async def status(self, session_id):
        try:
            response = await self.client.get(f"/v1/sessions/{session_id}")
        except httpx.HTTPError:
            return None
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            return None
        return response.json()

    async def reconcile(self):
        try:
            response = await self.client.post("/v1/reconcile")
        except httpx.HTTPError as exc:
            raise RuntimeUnavailable(str(exc)) from exc
        if response.status_code != 204:
            raise RuntimeUnavailable(response.text)
