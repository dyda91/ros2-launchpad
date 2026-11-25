import os
import subprocess
import tempfile
import time
import unittest

BASHRC = "/etc/launchpad.bashrc"

GRAPH = """T /odom nav_msgs/msg/Odometry
T /scan sensor_msgs/msg/LaserScan
T /cmd_vel geometry_msgs/msg/Twist
T /launchpad/mission_status std_msgs/msg/String
N /fastsim
N /mission_monitor
S /cmd_vel_watchdog/describe_parameters rcl_interfaces/srv/DescribeParameters
S /demo/_action/send_goal demo_interfaces/action/Demo_SendGoal
"""


class Ros2CompleteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handle = tempfile.NamedTemporaryFile("w", suffix=".graph", delete=False)
        handle.write(GRAPH)
        handle.close()
        cls.graph = handle.name

    @classmethod
    def tearDownClass(cls):
        os.unlink(cls.graph)

    def complete(self, line):
        words = line.split(" ")
        script = f"""
source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
. /usr/share/bash-completion/bash_completion
export LAUNCHPAD_GRAPH_FILE={self.graph}
source {BASHRC} >/dev/null 2>&1
COMP_WORDS=({" ".join(repr(w) if w else "''" for w in words)})
COMP_CWORD=$(( ${{#COMP_WORDS[@]}} - 1 ))
COMP_LINE={line!r}
COMP_POINT=${{#COMP_LINE}}
_launchpad_ros2 ros2
_launchpad_ros2 ros2
_started=$EPOCHREALTIME
_launchpad_ros2 ros2
_finished=$EPOCHREALTIME
printf 'ELAPSED %s\\n' "$(( (${{_finished/./}} - ${{_started/./}}) ))"
printf '%s\\n' "${{COMPREPLY[@]}}"
"""
        result = subprocess.run(
            ["bash", "-c", script], capture_output=True, text=True, timeout=30
        )
        lines = result.stdout.split("\n")
        marker = next(i for i, line in enumerate(lines) if line.startswith("ELAPSED"))
        elapsed = int(lines[marker].split()[1]) / 1_000_000
        return sorted(filter(None, lines[marker + 1 :])), elapsed

    def test_top_level_commands(self):
        words, _ = self.complete("ros2 ")
        for name in ("topic", "node", "param", "run", "launch", "interface"):
            self.assertIn(name, words)

    def test_prefix_filters_commands(self):
        words, _ = self.complete("ros2 to")
        self.assertEqual(words, ["topic"])

    def test_topic_verbs(self):
        words, _ = self.complete("ros2 topic ")
        self.assertEqual(
            words, ["bw", "delay", "echo", "find", "hz", "info", "list", "pub", "type"]
        )

    def test_topic_names_come_from_the_graph(self):
        words, _ = self.complete("ros2 topic echo /")
        self.assertEqual(
            words, ["/cmd_vel", "/launchpad/mission_status", "/odom", "/scan"]
        )

    def test_topic_name_prefix(self):
        words, _ = self.complete("ros2 topic echo /od")
        self.assertEqual(words, ["/odom"])

    def test_options_of_a_verb(self):
        words, _ = self.complete("ros2 topic pub --")
        for option in ("--rate", "--times", "--once", "--qos-profile"):
            self.assertIn(option, words)

    def test_flags_do_not_consume_the_topic(self):
        words, _ = self.complete("ros2 topic echo --once /s")
        self.assertEqual(words, ["/scan"])

    def test_option_values_are_skipped(self):
        words, _ = self.complete("ros2 topic pub --rate 10 --times 30 /c")
        self.assertEqual(words, ["/cmd_vel"])

    def test_message_type_after_topic(self):
        words, _ = self.complete("ros2 topic pub /cmd_vel geometry_msgs/msg/Tw")
        self.assertEqual(words, ["geometry_msgs/msg/Twist", "geometry_msgs/msg/TwistStamped", "geometry_msgs/msg/TwistWithCovariance", "geometry_msgs/msg/TwistWithCovarianceStamped"])

    def test_choices_for_option_value(self):
        words, _ = self.complete("ros2 topic echo --qos-reliability ")
        self.assertIn("best_effort", words)
        self.assertIn("reliable", words)

    def test_node_names(self):
        words, _ = self.complete("ros2 node info ")
        self.assertEqual(words, ["/fastsim", "/mission_monitor"])

    def test_actions_are_derived_from_services(self):
        words, _ = self.complete("ros2 action info ")
        self.assertEqual(words, ["/demo"])

    def test_interface_show_accepts_any_type(self):
        words, _ = self.complete("ros2 interface show std_msgs/msg/Str")
        self.assertIn("std_msgs/msg/String", words)

    def test_packages_and_executables(self):
        words, _ = self.complete("ros2 run launchpad_")
        self.assertIn("launchpad_sim", words)
        words, _ = self.complete("ros2 run launchpad_sim ")
        self.assertIn("fastsim", words)

    def test_completion_is_fast(self):
        _, elapsed = self.complete("ros2 topic echo /")
        self.assertLess(elapsed, 0.6)

    def test_every_command_has_verbs_or_options(self):
        words, _ = self.complete("ros2 ")
        for name in words:
            sub, _ = self.complete(f"ros2 {name} ")
            opts, _ = self.complete(f"ros2 {name} --")
            self.assertTrue(sub or opts, name)


if __name__ == "__main__":
    unittest.main()
