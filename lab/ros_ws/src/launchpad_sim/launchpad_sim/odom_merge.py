import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node


class OdomMerge(Node):
    def __init__(self):
        super().__init__("odom_merge")
        self.world = None
        self.encoder = None
        self.publisher = self.create_publisher(Odometry, "/odom", 10)
        self.create_subscription(
            Odometry, "/launchpad/_odom_world", self.on_world, 10
        )
        self.create_subscription(
            Odometry, "/launchpad/_odom_encoder", self.on_encoder, 10
        )

    def on_world(self, message):
        self.world = message
        self.publish()

    def on_encoder(self, message):
        self.encoder = message

    def publish(self):
        if self.world is None:
            return
        merged = Odometry()
        merged.header = self.world.header
        merged.child_frame_id = self.world.child_frame_id or "base_link"
        merged.pose = self.world.pose
        if self.encoder is not None:
            merged.twist = self.encoder.twist
        self.publisher.publish(merged)


def main():
    rclpy.init()
    node = OdomMerge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
