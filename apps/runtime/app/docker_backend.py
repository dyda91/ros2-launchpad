import os
import shutil
import threading

import docker
from docker.types import Ulimit


class CapacityError(RuntimeError):
    pass


class DockerBackend:
    def __init__(self, settings):
        self.settings = settings
        self.client = docker.from_env()
        self._lock = threading.Lock()
        self._domains = {}
        self._used_domains = set()

    def _session_dir(self, session_id):
        return os.path.join(self.settings.run_dir, session_id)

    def _host_session_dir(self, session_id):
        return os.path.join(self.settings.host_run_dir, session_id)

    def _labels(self, session_id=None):
        labels = [
            "launchpad.role=session",
            f"launchpad.project={self.settings.session_project}",
        ]
        if session_id is not None:
            labels.append(f"launchpad.session={session_id}")
        return labels

    def _containers(self):
        return self.client.containers.list(
            all=True,
            filters={"label": self._labels()},
        )

    def _running_containers(self):
        return self.client.containers.list(
            filters={"label": self._labels()}
        )

    def active_count(self):
        with self._lock:
            return len(self._running_containers())

    def _find(self, session_id):
        containers = self.client.containers.list(
            all=True,
            filters={"label": self._labels(session_id)},
        )
        return containers[0] if containers else None

    def _alloc_domain(self, session_id):
        if session_id in self._domains:
            return self._domains[session_id]
        base = int(self.settings.ros_domain_id)
        for domain in range(base, base + 60):
            if domain not in self._used_domains:
                self._domains[session_id] = domain
                self._used_domains.add(domain)
                return domain
        raise CapacityError("no ROS domain available")

    def _release_domain(self, session_id):
        domain = self._domains.pop(session_id, None)
        if domain is not None:
            self._used_domains.discard(domain)

    def health(self):
        self.client.ping()
        return True

    def _remove_container(self, container):
        try:
            container.stop(timeout=10)
        except Exception:
            pass
        try:
            container.remove(force=True)
        except Exception:
            pass

    def start(self, session_id, agent_token):
        with self._lock:
            existing = self._find(session_id)
            if existing is not None:
                if existing.status == "running":
                    return self._result(session_id, existing)
                existing.remove(force=True)
                self._release_domain(session_id)

            if len(self._running_containers()) >= self.settings.max_sessions:
                raise CapacityError("session capacity reached")

            session_dir = self._session_dir(session_id)
            host_session_dir = self._host_session_dir(session_id)
            os.makedirs(session_dir, mode=0o700, exist_ok=True)
            os.chmod(session_dir, 0o700)
            try:
                os.chown(session_dir, 1000, 1000)
            except PermissionError:
                pass
            socket_path = os.path.join(session_dir, "agent.sock")
            if os.path.exists(socket_path):
                os.unlink(socket_path)

            domain = self._alloc_domain(session_id)
            environment = {
                "HOME": "/home/ubuntu",
                "PYTHONUNBUFFERED": "1",
                "ROS_DOMAIN_ID": str(domain),
                "ROS_AUTOMATIC_DISCOVERY_RANGE": "LOCALHOST",
                "RMW_IMPLEMENTATION": "rmw_cyclonedds_cpp",
                "GZ_IP": "127.0.0.1",
                "GZ_PARTITION": f"launchpad_{session_id[:12]}",
                "SIM_BACKEND": self.settings.sim_backend,
                "SESSION_ID": session_id,
                "AGENT_TOKEN": agent_token,
                "AGENT_SOCKET": "/run/agent/agent.sock",
                "MAP_FILE": (
                    "/ros_ws/install/launchpad_sim/share/launchpad_sim/"
                    "config/map.json"
                ),
                "LAUNCH_TIMEOUT_SECONDS": "45",
            }
            labels = {
                "launchpad.role": "session",
                "launchpad.project": self.settings.session_project,
                "launchpad.session": session_id,
                "launchpad.managed": "true",
            }
            tmpfs = None
            if self.settings.session_read_only:
                size = self.settings.session_tmpfs_size
                tmpfs = {
                    "/tmp": (
                        f"rw,noexec,nosuid,nodev,size={size},mode=1777"
                    ),
                    "/home/ubuntu": (
                        f"rw,nosuid,nodev,size={size},"
                        "uid=1000,gid=1000,mode=0700"
                    ),
                    "/var/tmp": (
                        f"rw,noexec,nosuid,nodev,size={size},mode=1777"
                    ),
                }
            ulimits = [
                Ulimit(
                    name="nofile",
                    soft=self.settings.session_ulimit_nofile,
                    hard=self.settings.session_ulimit_nofile,
                ),
                Ulimit(
                    name="core",
                    soft=self.settings.session_ulimit_core_mb * 1024 * 1024,
                    hard=self.settings.session_ulimit_core_mb * 1024 * 1024,
                ),
                Ulimit(
                    name="fsize",
                    soft=self.settings.session_ulimit_fsize_mb * 1024 * 1024,
                    hard=self.settings.session_ulimit_fsize_mb * 1024 * 1024,
                ),
            ]
            security_opt = ["no-new-privileges:true"]
            if self.settings.session_apparmor:
                security_opt.append(
                    f"apparmor={self.settings.session_apparmor}"
                )
            command = [
                "bash",
                "-lc",
                "source /opt/ros/jazzy/setup.bash; "
                "source /ros_ws/install/setup.bash; "
                "exec python3 -m launchpad_agent",
            ]
            try:
                container = self.client.containers.run(
                    self.settings.lab_image,
                    command=command,
                    name=f"ros2-launchpad-session-{session_id}",
                    detach=True,
                    init=True,
                    user="1000:1000",
                    working_dir="/ros_ws",
                    environment=environment,
                    volumes={
                        host_session_dir: {"bind": "/run/agent", "mode": "rw"}
                    },
                    network_mode="none",
                    mem_limit=self.settings.session_memory,
                    nano_cpus=int(self.settings.session_cpus * 1_000_000_000),
                    pids_limit=256,
                    shm_size="512m",
                    read_only=self.settings.session_read_only,
                    tmpfs=tmpfs,
                    ulimits=ulimits,
                    cap_drop=["ALL"],
                    security_opt=security_opt,
                    labels=labels,
                    remove=False,
                )
            except Exception:
                shutil.rmtree(session_dir, ignore_errors=True)
                self._release_domain(session_id)
                raise
            return self._result(session_id, container)

    def _result(self, session_id, container):
        return {
            "session_id": session_id,
            "container_id": container.id,
            "uds_path": os.path.join(
                self.settings.run_dir, session_id, "agent.sock"
            ),
            "state": container.status,
        }

    def status(self, session_id):
        with self._lock:
            container = self._find(session_id)
            if container is None:
                return None
            return {
                "session_id": session_id,
                "container_id": container.id,
                "state": container.status,
                "uds_path": os.path.join(
                    self.settings.run_dir, session_id, "agent.sock"
                ),
            }

    def list_sessions(self):
        with self._lock:
            return [
                {
                    "session_id": container.labels.get("launchpad.session"),
                    "container_id": container.id,
                    "state": container.status,
                }
                for container in self._containers()
            ]

    def stop(self, session_id):
        with self._lock:
            container = self._find(session_id)
            if container is not None:
                self._remove_container(container)
            shutil.rmtree(self._session_dir(session_id), ignore_errors=True)
            self._release_domain(session_id)

    def reconcile(self):
        with self._lock:
            for container in self._containers():
                self._remove_container(container)
            if os.path.isdir(self.settings.run_dir):
                for entry in os.listdir(self.settings.run_dir):
                    shutil.rmtree(
                        os.path.join(self.settings.run_dir, entry),
                        ignore_errors=True,
                    )
            self._domains.clear()
            self._used_domains.clear()

    def shutdown(self):
        self.reconcile()
