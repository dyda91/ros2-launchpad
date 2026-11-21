import hmac
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .docker_backend import DockerBackend
from .settings import Settings

settings = Settings.from_env()
backend = DockerBackend(settings)


class CreateSession(BaseModel):
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    agent_token: str = Field(min_length=16, max_length=256)


def require_token(authorization: Optional[str] = Header(default=None)):
    expected = f"Bearer {settings.runtime_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid runtime token")


@asynccontextmanager
async def lifespan(app):
    backend.reconcile()
    yield
    backend.shutdown()


app = FastAPI(lifespan=lifespan)


@app.get("/v1/health")
def health():
    try:
        return {"ok": backend.health()}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/v1/capacity", dependencies=[Depends(require_token)])
def capacity():
    return {"active": backend.active_count(), "max": settings.max_sessions}


@app.post("/v1/sessions", dependencies=[Depends(require_token)])
def create_session(payload: CreateSession):
    if backend.active_count() >= settings.max_sessions:
        current = backend.status(payload.session_id)
        if current is None:
            raise HTTPException(status_code=409, detail="session capacity reached")
        return current
    try:
        return backend.start(payload.session_id, payload.agent_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get(
    "/v1/sessions/{session_id}",
    dependencies=[Depends(require_token)],
)
def session_status(session_id: str):
    status = backend.status(session_id)
    if status is None:
        raise HTTPException(status_code=404, detail="session not found")
    return status


@app.delete(
    "/v1/sessions/{session_id}",
    status_code=204,
    dependencies=[Depends(require_token)],
)
def delete_session(session_id: str):
    backend.stop(session_id)
    return None
