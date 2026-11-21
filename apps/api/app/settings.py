import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    runtime_url: str
    runtime_token: str
    cookie_name: str
    cookie_secure: bool
    public_origins: tuple
    max_sessions: int
    run_dir: str
    static_dir: str
    mission_file: str
    ready_timeout_seconds: float

    @classmethod
    def from_env(cls):
        origins = tuple(
            item.strip()
            for item in os.environ.get(
                "PUBLIC_ORIGINS",
                "http://localhost:8080,http://127.0.0.1:8080",
            ).split(",")
            if item.strip()
        )
        return cls(
            runtime_url=os.environ.get("RUNTIME_URL", "http://runtime:8100"),
            runtime_token=os.environ["RUNTIME_TOKEN"],
            cookie_name=os.environ.get("COOKIE_NAME", "launchpad_session"),
            cookie_secure=os.environ.get("COOKIE_SECURE", "false").lower()
            in {"1", "true", "yes"},
            public_origins=origins,
            max_sessions=int(os.environ.get("MAX_SESSIONS", "1")),
            run_dir=os.environ.get("RUN_DIR", "/run/sessions"),
            static_dir=os.environ.get("STATIC_DIR", "/app/static"),
            mission_file=os.environ.get(
                "MISSION_FILE",
                "/app/content/missions/primeiro-turno.yaml",
            ),
            ready_timeout_seconds=float(
                os.environ.get("READY_TIMEOUT_SECONDS", "45")
            ),
        )
