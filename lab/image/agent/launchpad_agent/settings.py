import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    session_id: str
    agent_token: str
    socket_path: str
    map_file: str
    launch_timeout_seconds: float

    @classmethod
    def from_env(cls):
        return cls(
            session_id=os.environ["SESSION_ID"],
            agent_token=os.environ["AGENT_TOKEN"],
            socket_path=os.environ.get("AGENT_SOCKET", "/run/agent/agent.sock"),
            map_file=os.environ.get(
                "MAP_FILE",
                "/ros_ws/install/launchpad_sim/share/launchpad_sim/config/map.json",
            ),
            launch_timeout_seconds=float(
                os.environ.get("LAUNCH_TIMEOUT_SECONDS", "45")
            ),
        )
