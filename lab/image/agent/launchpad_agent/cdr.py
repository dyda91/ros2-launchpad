import struct


def _align(position, size):
    return position + (-(position - 4)) % size


def _skip_string(data, position):
    position = _align(position, 4)
    (length,) = struct.unpack_from("<I", data, position)
    return position + 4 + length


def parse_stamp(data):
    sec, nanosec = struct.unpack_from("<iI", data, 4)
    return sec + nanosec / 1_000_000_000.0


def parse_odometry(data):
    if len(data) < 8 or data[1] != 1:
        return None
    position = 12
    position = _skip_string(data, position)
    position = _skip_string(data, position)
    position = _align(position, 8)
    values = struct.unpack_from("<7d", data, position)
    position += 7 * 8 + 36 * 8
    twist = struct.unpack_from("<6d", data, position)
    return {
        "stamp": parse_stamp(data),
        "x": values[0],
        "y": values[1],
        "qx": values[3],
        "qy": values[4],
        "qz": values[5],
        "qw": values[6],
        "vx": twist[0],
        "vy": twist[1],
        "wz": twist[5],
    }
