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
    session_project: str
    session_read_only: bool
    session_tmpfs_size: str
    session_apparmor: str
    session_ulimit_nofile: int
    session_ulimit_core_mb: int
    session_ulimit_fsize_mb: int

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
            max_sessions=int(os.environ.get("MAX_SESSIONS", "2")),
            ros_domain_id=os.environ.get("SESSION_ROS_DOMAIN_ID", "42"),
            session_project=os.environ.get("SESSION_PROJECT", "launchpad"),
            session_read_only=os.environ.get("SESSION_READ_ONLY", "false").lower()
            in {"1", "true", "yes"},
            session_tmpfs_size=os.environ.get("SESSION_TMPFS_SIZE", "256m"),
            session_apparmor=os.environ.get("SESSION_APPARMOR", ""),
            session_ulimit_nofile=int(
                os.environ.get("SESSION_ULIMIT_NOFILE", "4096")
            ),
            session_ulimit_core_mb=int(
                os.environ.get("SESSION_ULIMIT_CORE_MB", "0")
            ),
            session_ulimit_fsize_mb=int(
                os.environ.get("SESSION_ULIMIT_FSIZE_MB", "64")
            ),
        )
