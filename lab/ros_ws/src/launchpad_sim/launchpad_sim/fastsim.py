import math
import time

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.time import Time
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import LaserScan

from launchpad_sim.fastsim_core import (
    LIDAR_RANGE_MAX,
    LIDAR_RANGE_MIN,
    FastRobot,
    FastWorld,
    load_map,
)


class FastSim(Node):
    def __init__(self):
        super().__init__("fastsim")
        self.declare_parameter("map_file", "")
        self.declare_parameter("input_topic", "/launchpad/_cmd_vel_safe")
        self.declare_parameter("update_rate_hz", 25.0)
        self.declare_parameter("scan_rate_hz", 10.0)
        self.declare_parameter("clock_rate_hz", 5.0)
        self.declare_parameter("spawn_x", 0.0)
        self.declare_parameter("spawn_y", 0.0)
        self.declare_parameter("spawn_yaw", 0.0)

        map_file = str(self.get_parameter("map_file").value)
        if not map_file:
            raise ValueError("map_file parameter is required")
        self.world = FastWorld(load_map(map_file))
        self.robot = FastRobot(
            self.world,
            float(self.get_parameter("spawn_x").value),
            float(self.get_parameter("spawn_y").value),
            float(self.get_parameter("spawn_yaw").value),
        )
        rate = float(self.get_parameter("update_rate_hz").value)
        scan_rate = float(self.get_parameter("scan_rate_hz").value)
        clock_rate = float(self.get_parameter("clock_rate_hz").value)
        self.sim_time = 0.0
        self.last_wall = time.monotonic()
        self.command_linear = 0.0
        self.command_angular = 0.0

        self.odom_publisher = self.create_publisher(Odometry, "/odom", 10)
        self.scan_publisher = self.create_publisher(LaserScan, "/scan", 10)
        self.clock_publisher = self.create_publisher(Clock, "/clock", 10)
        self.create_subscription(
            Twist,
            str(self.get_parameter("input_topic").value),
            self.on_command,
            10,
        )
        self.create_timer(1.0 / rate, self.on_tick)
        self.create_timer(1.0 / scan_rate, self.on_scan_tick)
        self.create_timer(1.0 / clock_rate, self.on_clock_tick)
        self.get_logger().info(
            f"fastsim at {rate:.0f} Hz with {len(self.world.boxes)} boxes "
            f"and {len(self.world.circles)} cylinders"
        )

    def on_command(self, message):
        linear = message.linear.x
        angular = message.angular.z
        self.command_linear = linear if math.isfinite(linear) else 0.0
        self.command_angular = angular if math.isfinite(angular) else 0.0

    def stamp(self):
        return Time(seconds=self.sim_time).to_msg()

    def on_tick(self):
        now = time.monotonic()
        dt = min(now - self.last_wall, 0.1)
        self.last_wall = now
        if dt <= 0.0:
            return
        self.sim_time += dt
        robot = self.robot
        robot.step(dt, self.command_linear, self.command_angular)
        odom = Odometry()
        odom.header.stamp = self.stamp()
        odom.header.frame_id = "odom"
        odom.child_frame_id = "base_link"
        odom.pose.pose.position.x = robot.x
        odom.pose.pose.position.y = robot.y
        odom.pose.pose.orientation.z = math.sin(robot.yaw / 2.0)
        odom.pose.pose.orientation.w = math.cos(robot.yaw / 2.0)
        odom.twist.twist.linear.x = robot.linear
        odom.twist.twist.angular.z = robot.angular
        self.odom_publisher.publish(odom)

    def on_clock_tick(self):
        clock = Clock()
        clock.clock = self.stamp()
        self.clock_publisher.publish(clock)

    def on_scan_tick(self):
        robot = self.robot
        scan = LaserScan()
        scan.header.stamp = self.stamp()
        scan.header.frame_id = "lidar_link"
        scan.angle_min = float(self.world.angles[0])
        scan.angle_max = float(self.world.angles[-1])
        scan.angle_increment = self.world.angle_increment
        scan.range_min = LIDAR_RANGE_MIN
        scan.range_max = LIDAR_RANGE_MAX
        scan.ranges = self.world.scan(robot.x, robot.y, robot.yaw).tolist()
        self.scan_publisher.publish(scan)


def main(args=None):
    rclpy.init(args=args)
    node = FastSim()
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
