import json
import math

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String


class MissionMonitor(Node):
    def __init__(self, **kwargs):
        super().__init__("mission_monitor", **kwargs)
        self.declare_parameter("map_file", "")
        self.declare_parameter("hold_seconds", 2.0)
        self.declare_parameter("linear_speed_threshold", 0.02)
        self.declare_parameter("angular_speed_threshold", 0.05)
        self.declare_parameter("zone_margin", 0.05)
        self.declare_parameter("publish_rate_hz", 10.0)

        map_file = str(self.get_parameter("map_file").value)
        if not map_file:
            raise ValueError("map_file parameter is required")
        with open(map_file, "r", encoding="utf-8") as handle:
            self.map_data = json.load(handle)

        self.hold_seconds = float(self.get_parameter("hold_seconds").value)
        self.linear_threshold = float(
            self.get_parameter("linear_speed_threshold").value
        )
        self.angular_threshold = float(
            self.get_parameter("angular_speed_threshold").value
        )
        self.zone_margin = float(self.get_parameter("zone_margin").value)
        self.publish_rate = float(self.get_parameter("publish_rate_hz").value)

        zone = self.map_data["zone"]
        self.zone_id = zone["id"]
        self.zone_min = [
            zone["center"][0] - zone["size"][0] / 2.0 + self.zone_margin,
            zone["center"][1] - zone["size"][1] / 2.0 + self.zone_margin,
        ]
        self.zone_max = [
            zone["center"][0] + zone["size"][0] / 2.0 - self.zone_margin,
            zone["center"][1] + zone["size"][1] / 2.0 - self.zone_margin,
        ]

        self.pose = None
        self.speed = None
        self.angular_speed = None
        self.stopped_since = None
        self.delivered = False

        self.status_publisher = self.create_publisher(
            String, "/launchpad/mission_status", 10
        )
        self.subscription = self.create_subscription(
            Odometry, "/odom", self.on_odometry, 10
        )
        self.timer = self.create_timer(1.0 / self.publish_rate, self.on_timer)
        self.get_logger().info(
            f"monitoring zone {self.zone_id} with hold {self.hold_seconds:.2f}s"
        )

    def on_odometry(self, message):
        position = message.pose.pose.position
        twist = message.twist.twist
        self.update(position.x, position.y, twist.linear.x, twist.angular.z)

    def update(self, x, y, linear, angular):
        self.pose = (x, y)
        self.speed = abs(linear)
        self.angular_speed = abs(angular)

    def detach_odometry(self):
        self.destroy_subscription(self.subscription)
        self.subscription = None

    def in_zone(self):
        if self.pose is None:
            return False
        return (
            self.zone_min[0] <= self.pose[0] <= self.zone_max[0]
            and self.zone_min[1] <= self.pose[1] <= self.zone_max[1]
        )

    def on_timer(self):
        inside = self.in_zone()
        stopped = (
            self.speed is not None
            and self.speed <= self.linear_threshold
            and self.angular_speed is not None
            and self.angular_speed <= self.angular_threshold
        )
        now = self.get_clock().now()
        if inside and stopped:
            if self.stopped_since is None:
                self.stopped_since = now
            stopped_for = (now - self.stopped_since).nanoseconds / 1_000_000_000.0
        else:
            self.stopped_since = None
            stopped_for = 0.0

        if not self.delivered and stopped_for >= self.hold_seconds:
            self.delivered = True
            self.get_logger().info("mission delivered")

        status = {
            "zone_id": self.zone_id,
            "in_zone": inside,
            "speed_mps": round(self.speed, 4) if self.speed is not None else None,
            "angular_speed_rps": (
                round(self.angular_speed, 4)
                if self.angular_speed is not None
                else None
            ),
            "stopped_for_s": round(stopped_for, 3),
            "delivered": self.delivered,
            "pose": (
                {"x": round(self.pose[0], 4), "y": round(self.pose[1], 4)}
                if self.pose is not None
                else None
            ),
        }
        self.status_publisher.publish(
            String(data=json.dumps(status, ensure_ascii=False))
        )


def main(args=None):
    rclpy.init(args=args)
    node = MissionMonitor()
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
