import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    runtime_token: str
    lab_image: str
    host_run_dir: str
    run_dir: str
    max_sessions: int
    ros_domain_id: str

    @classmethod
    def from_env(cls):
        host_run_dir = os.environ.get("HOST_RUN_DIR")
        if not host_run_dir:
            raise RuntimeError("HOST_RUN_DIR must be set")
        return cls(
            runtime_token=os.environ["RUNTIME_TOKEN"],
            lab_image=os.environ.get("LAB_IMAGE", "ros2-launchpad-lab:dev"),
            host_run_dir=host_run_dir,
            run_dir=os.environ.get("RUN_DIR", "/run/sessions"),
            max_sessions=int(os.environ.get("MAX_SESSIONS", "1")),
            ros_domain_id=os.environ.get("SESSION_ROS_DOMAIN_ID", "42"),
        )
