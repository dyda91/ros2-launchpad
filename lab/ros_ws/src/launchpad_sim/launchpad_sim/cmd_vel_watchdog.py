import math

import rclpy
from geometry_msgs.msg import Twist
from rclpy.node import Node


class CmdVelWatchdog(Node):
    def __init__(self, **kwargs):
        super().__init__("cmd_vel_watchdog", **kwargs)
        self.declare_parameter("input_topic", "/cmd_vel")
        self.declare_parameter("output_topic", "/launchpad/_cmd_vel_safe")
        self.declare_parameter("timeout_seconds", 0.5)
        self.declare_parameter("publish_rate_hz", 20.0)
        self.declare_parameter("max_linear_velocity", 0.35)
        self.declare_parameter("max_angular_velocity", 0.9)

        self.input_topic = self.get_parameter("input_topic").value
        self.output_topic = self.get_parameter("output_topic").value
        self.timeout = float(self.get_parameter("timeout_seconds").value)
        self.publish_rate = float(self.get_parameter("publish_rate_hz").value)
        self.max_linear = float(self.get_parameter("max_linear_velocity").value)
        self.max_angular = float(self.get_parameter("max_angular_velocity").value)

        if self.timeout <= 0.0:
            raise ValueError("timeout_seconds must be positive")
        if self.publish_rate <= 0.0:
            raise ValueError("publish_rate_hz must be positive")

        self.last_command = Twist()
        self.last_command_time = None
        self.publisher = self.create_publisher(Twist, self.output_topic, 10)
        self.subscription = self.create_subscription(
            Twist, self.input_topic, self.on_command, 10
        )
        self.timer = self.create_timer(1.0 / self.publish_rate, self.on_timer)
        self.get_logger().info(
            f"watching {self.input_topic} and publishing {self.output_topic} "
            f"with timeout {self.timeout:.2f}s"
        )

    def redirect(self, sink):
        self.destroy_publisher(self.publisher)
        self.publisher = sink

    def on_command(self, message):
        self.last_command = self.sanitize(message)
        self.last_command_time = self.get_clock().now()

    def sanitize(self, message):
        linear = message.linear.x
        angular = message.angular.z
        if not math.isfinite(linear):
            linear = 0.0
        if not math.isfinite(angular):
            angular = 0.0
        command = Twist()
        command.linear.x = max(-self.max_linear, min(self.max_linear, linear))
        command.angular.z = max(-self.max_angular, min(self.max_angular, angular))
        return command

    def on_timer(self):
        if self.last_command_time is None:
            return
        age = (
            self.get_clock().now() - self.last_command_time
        ).nanoseconds / 1_000_000_000.0
        if age > self.timeout:
            self.publisher.publish(Twist())
        else:
            self.publisher.publish(self.last_command)


def main(args=None):
    rclpy.init(args=args)
    node = CmdVelWatchdog()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
