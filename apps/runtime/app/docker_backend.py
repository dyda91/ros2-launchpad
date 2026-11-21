import os
import shutil

import docker


class DockerBackend:
    def __init__(self, settings):
        self.settings = settings
        self.client = docker.from_env()

    def _session_dir(self, session_id):
        return os.path.join(self.settings.run_dir, session_id)

    def _host_session_dir(self, session_id):
        return os.path.join(self.settings.host_run_dir, session_id)

    def _containers(self):
        return self.client.containers.list(
            all=True,
            filters={"label": "launchpad.role=session"},
        )

    def active_count(self):
        return len(
            self.client.containers.list(
                filters={"label": "launchpad.role=session"}
            )
        )

    def health(self):
        self.client.ping()
        return True

    def start(self, session_id, agent_token):
        existing = self.client.containers.list(
            all=True,
            filters={"label": f"launchpad.session={session_id}"},
        )
        if existing:
            container = existing[0]
            if container.status == "running":
                return self._result(session_id, container)
            container.remove(force=True)

        active = self.active_count()
        if active >= self.settings.max_sessions:
            raise RuntimeError("session capacity reached")

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

        environment = {
            "HOME": "/home/ubuntu",
            "PYTHONUNBUFFERED": "1",
            "ROS_DOMAIN_ID": self.settings.ros_domain_id,
            "ROS_AUTOMATIC_DISCOVERY_RANGE": "LOCALHOST",
            "RMW_IMPLEMENTATION": "rmw_cyclonedds_cpp",
            "GZ_IP": "127.0.0.1",
            "GZ_PARTITION": f"launchpad_{session_id[:12]}",
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
            "launchpad.session": session_id,
            "launchpad.managed": "true",
        }
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
                name="ros2-launchpad-session",
                detach=True,
                init=True,
                user="1000:1000",
                working_dir="/ros_ws",
                environment=environment,
                volumes={
                    host_session_dir: {"bind": "/run/agent", "mode": "rw"}
                },
                network_mode="none",
                mem_limit="2g",
                nano_cpus=2_000_000_000,
                pids_limit=256,
                shm_size="512m",
                cap_drop=["ALL"],
                security_opt=["no-new-privileges:true"],
                labels=labels,
                remove=False,
            )
        except Exception:
            shutil.rmtree(session_dir, ignore_errors=True)
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
        containers = self.client.containers.list(
            all=True,
            filters={"label": f"launchpad.session={session_id}"},
        )
        if not containers:
            return None
        container = containers[0]
        return {
            "session_id": session_id,
            "container_id": container.id,
            "state": container.status,
            "uds_path": os.path.join(
                self.settings.run_dir, session_id, "agent.sock"
            ),
        }

    def stop(self, session_id):
        containers = self.client.containers.list(
            all=True,
            filters={"label": f"launchpad.session={session_id}"},
        )
        for container in containers:
            try:
                container.stop(timeout=10)
            except docker.errors.NotFound:
                pass
            try:
                container.remove(force=True)
            except docker.errors.NotFound:
                pass
        shutil.rmtree(self._session_dir(session_id), ignore_errors=True)

    def reconcile(self):
        for container in self._containers():
            try:
                container.stop(timeout=10)
            except docker.errors.NotFound:
                pass
            try:
                container.remove(force=True)
            except docker.errors.NotFound:
                pass
        if os.path.isdir(self.settings.run_dir):
            for entry in os.listdir(self.settings.run_dir):
                shutil.rmtree(
                    os.path.join(self.settings.run_dir, entry),
                    ignore_errors=True,
                )

    def shutdown(self):
        self.reconcile()
