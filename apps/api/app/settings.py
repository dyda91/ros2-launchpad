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
    session_ttl_seconds: int
    session_idle_seconds: int
    session_warning_seconds: int
    monitor_interval_seconds: float
    pilot_enabled: bool
    pilot_state_dir: str
    pilot_invite_ttl_seconds: int
    pilot_access_ttl_seconds: int
    pilot_trust_forwarded: bool
    pilot_rate_limit: int
    pilot_rate_window_seconds: int

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
            max_sessions=int(os.environ.get("MAX_SESSIONS", "2")),
            run_dir=os.environ.get("RUN_DIR", "/run/sessions"),
            static_dir=os.environ.get("STATIC_DIR", "/app/static"),
            mission_file=os.environ.get(
                "MISSION_FILE",
                "/app/content/missions/primeiro-turno.yaml",
            ),
            ready_timeout_seconds=float(
                os.environ.get("READY_TIMEOUT_SECONDS", "45")
            ),
            session_ttl_seconds=int(
                os.environ.get("SESSION_TTL_SECONDS", "1800")
            ),
            session_idle_seconds=int(
                os.environ.get("SESSION_IDLE_SECONDS", "600")
            ),
            session_warning_seconds=int(
                os.environ.get("SESSION_WARNING_SECONDS", "120")
            ),
            monitor_interval_seconds=float(
                os.environ.get("SESSION_MONITOR_SECONDS", "2")
            ),
            pilot_enabled=os.environ.get("PILOT_ENABLED", "false").lower()
            in {"1", "true", "yes"},
            pilot_state_dir=os.environ.get(
                "PILOT_STATE_DIR", "/var/lib/launchpad/pilot"
            ),
            pilot_invite_ttl_seconds=int(
                os.environ.get("PILOT_INVITE_TTL_SECONDS", "7200")
            ),
            pilot_access_ttl_seconds=int(
                os.environ.get("PILOT_ACCESS_TTL_SECONDS", "7200")
            ),
            pilot_trust_forwarded=os.environ.get(
                "PILOT_TRUST_FORWARDED", "false"
            ).lower()
            in {"1", "true", "yes"},
            pilot_rate_limit=int(
                os.environ.get("PILOT_RATE_LIMIT", "6")
            ),
            pilot_rate_window_seconds=int(
                os.environ.get("PILOT_RATE_WINDOW_SECONDS", "900")
            ),
        )
