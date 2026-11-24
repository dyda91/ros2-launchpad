import json
import math

import numpy as np

CHASSIS_LENGTH = 0.46
WHEEL_SEPARATION = 0.38
WHEEL_WIDTH = 0.035
ROBOT_HALF_LENGTH = CHASSIS_LENGTH / 2.0
ROBOT_HALF_WIDTH = WHEEL_SEPARATION / 2.0 + WHEEL_WIDTH / 2.0
LIDAR_SAMPLES = 360
LIDAR_MIN_ANGLE = -math.pi
LIDAR_MAX_ANGLE = math.pi
LIDAR_RANGE_MIN = 0.12
LIDAR_RANGE_MAX = 8.0
MAX_LINEAR = 0.5
MAX_ANGULAR = 1.2
LINEAR_ACCEL = 1.5
ANGULAR_ACCEL = 4.0


def wrap_angle(value):
    return math.atan2(math.sin(value), math.cos(value))


def load_map(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


class FastWorld:
    def __init__(self, map_data):
        floor = map_data["warehouse"]["floor"]
        self.min_x, self.min_y = floor["min"]
        self.max_x, self.max_y = floor["max"]
        self.boxes = []
        self.circles = []
        for item in map_data["obstacles"]:
            if item["type"] == "box":
                self.boxes.append(
                    (
                        item["center"][0],
                        item["center"][1],
                        item["size"][0] / 2.0,
                        item["size"][1] / 2.0,
                    )
                )
            else:
                self.circles.append(
                    (item["center"][0], item["center"][1], item["radius"])
                )
        self.box_array = np.array(self.boxes, dtype=np.float64).reshape(-1, 4)
        self.circle_array = np.array(self.circles, dtype=np.float64).reshape(-1, 3)
        count = LIDAR_SAMPLES
        self.angles = np.linspace(LIDAR_MIN_ANGLE, LIDAR_MAX_ANGLE, count)
        self.angle_increment = (LIDAR_MAX_ANGLE - LIDAR_MIN_ANGLE) / (count - 1)

    def robot_corners(self, x, y, yaw):
        cos_yaw = math.cos(yaw)
        sin_yaw = math.sin(yaw)
        corners = []
        for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
            lx = sx * ROBOT_HALF_LENGTH
            ly = sy * ROBOT_HALF_WIDTH
            corners.append(
                (x + lx * cos_yaw - ly * sin_yaw, y + lx * sin_yaw + ly * cos_yaw)
            )
        return corners

    def collides(self, x, y, yaw):
        corners = self.robot_corners(x, y, yaw)
        for cx, cy in corners:
            if cx < self.min_x or cx > self.max_x:
                return True
            if cy < self.min_y or cy > self.max_y:
                return True
        cos_yaw = math.cos(yaw)
        sin_yaw = math.sin(yaw)
        for bx, by, hx, hy in self.boxes:
            if self._obb_overlaps_box(x, y, cos_yaw, sin_yaw, corners, bx, by, hx, hy):
                return True
        for cx, cy, radius in self.circles:
            dx = cx - x
            dy = cy - y
            local_x = dx * cos_yaw + dy * sin_yaw
            local_y = -dx * sin_yaw + dy * cos_yaw
            nearest_x = max(-ROBOT_HALF_LENGTH, min(ROBOT_HALF_LENGTH, local_x))
            nearest_y = max(-ROBOT_HALF_WIDTH, min(ROBOT_HALF_WIDTH, local_y))
            if math.hypot(local_x - nearest_x, local_y - nearest_y) < radius:
                return True
        return False

    @staticmethod
    def _obb_overlaps_box(x, y, cos_yaw, sin_yaw, corners, bx, by, hx, hy):
        if (
            max(c[0] for c in corners) < bx - hx
            or min(c[0] for c in corners) > bx + hx
            or max(c[1] for c in corners) < by - hy
            or min(c[1] for c in corners) > by + hy
        ):
            return False
        for axis_x, axis_y, own in (
            (cos_yaw, sin_yaw, ROBOT_HALF_LENGTH),
            (-sin_yaw, cos_yaw, ROBOT_HALF_WIDTH),
        ):
            center = (bx - x) * axis_x + (by - y) * axis_y
            radius = hx * abs(axis_x) + hy * abs(axis_y)
            if abs(center) > own + radius:
                return False
        return True

    def scan(self, x, y, yaw):
        heading = self.angles + yaw
        dir_x = np.cos(heading)
        dir_y = np.sin(heading)
        best = np.full(heading.shape, np.inf)
        with np.errstate(divide="ignore", invalid="ignore"):
            inv_x = 1.0 / dir_x
            inv_y = 1.0 / dir_y
            tx1 = (self.min_x - x) * inv_x
            tx2 = (self.max_x - x) * inv_x
            ty1 = (self.min_y - y) * inv_y
            ty2 = (self.max_y - y) * inv_y
            wall = np.minimum(np.maximum(tx1, tx2), np.maximum(ty1, ty2))
            best = np.minimum(best, np.where(wall > 0.0, wall, np.inf))
            for bx, by, hx, hy in self.box_array:
                tx1 = (bx - hx - x) * inv_x
                tx2 = (bx + hx - x) * inv_x
                ty1 = (by - hy - y) * inv_y
                ty2 = (by + hy - y) * inv_y
                near = np.maximum(np.minimum(tx1, tx2), np.minimum(ty1, ty2))
                far = np.minimum(np.maximum(tx1, tx2), np.maximum(ty1, ty2))
                hit = (far >= near) & (far > 0.0)
                distance = np.where(near > 0.0, near, far)
                best = np.minimum(best, np.where(hit, distance, np.inf))
            for cx, cy, radius in self.circle_array:
                ox = x - cx
                oy = y - cy
                b = ox * dir_x + oy * dir_y
                c = ox * ox + oy * oy - radius * radius
                disc = b * b - c
                root = np.sqrt(np.where(disc >= 0.0, disc, np.nan))
                near = -b - root
                far = -b + root
                distance = np.where(near > 0.0, near, far)
                hit = (disc >= 0.0) & (distance > 0.0)
                best = np.minimum(best, np.where(hit, distance, np.inf))
        ranges = best
        ranges = np.where(ranges < LIDAR_RANGE_MIN, -np.inf, ranges)
        ranges = np.where(ranges > LIDAR_RANGE_MAX, np.inf, ranges)
        return ranges


class FastRobot:
    def __init__(self, world, x=0.0, y=0.0, yaw=0.0):
        self.world = world
        self.x = x
        self.y = y
        self.yaw = yaw
        self.linear = 0.0
        self.angular = 0.0
        self.blocked = False

    @staticmethod
    def _approach(current, target, limit):
        if limit <= 0.0:
            return target
        delta = target - current
        if delta > limit:
            return current + limit
        if delta < -limit:
            return current - limit
        return target

    def step(self, dt, command_linear, command_angular):
        command_linear = max(-MAX_LINEAR, min(MAX_LINEAR, command_linear))
        command_angular = max(-MAX_ANGULAR, min(MAX_ANGULAR, command_angular))
        self.linear = self._approach(self.linear, command_linear, LINEAR_ACCEL * dt)
        self.angular = self._approach(
            self.angular, command_angular, ANGULAR_ACCEL * dt
        )
        mid_yaw = self.yaw + self.angular * dt / 2.0
        next_x = self.x + self.linear * math.cos(mid_yaw) * dt
        next_y = self.y + self.linear * math.sin(mid_yaw) * dt
        next_yaw = wrap_angle(self.yaw + self.angular * dt)
        for candidate in (
            (next_x, next_y, next_yaw),
            (next_x, next_y, self.yaw),
            (self.x, self.y, next_yaw),
        ):
            if not self.world.collides(*candidate):
                self.blocked = candidate != (next_x, next_y, next_yaw)
                self.x, self.y, self.yaw = candidate
                return
        self.blocked = True
