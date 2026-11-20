import json
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, TimerAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, FindExecutable, LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    sim_share = get_package_share_directory("launchpad_sim")
    ros_gz_share = get_package_share_directory("ros_gz_sim")

    world_file = os.path.join(sim_share, "worlds", "armazem.sdf")
    map_file = os.path.join(sim_share, "config", "map.json")
    bridge_file = os.path.join(sim_share, "config", "bridge.yaml")
    robot_file = os.path.join(sim_share, "urdf", "robot.urdf.xacro")

    with open(map_file, "r", encoding="utf-8") as handle:
        map_data = json.load(handle)
    spawn = map_data["spawn"]
    world_name = map_data["world"]

    robot_description = ParameterValue(
        Command([FindExecutable(name="xacro"), " ", robot_file]),
        value_type=str,
    )

    declare_spawn = [
        DeclareLaunchArgument("spawn_x", default_value=str(spawn["x"])),
        DeclareLaunchArgument("spawn_y", default_value=str(spawn["y"])),
        DeclareLaunchArgument("spawn_z", default_value=str(spawn["z"])),
        DeclareLaunchArgument("spawn_yaw", default_value=str(spawn["yaw"])),
        DeclareLaunchArgument("watchdog_timeout", default_value="0.5"),
        DeclareLaunchArgument("mission_hold", default_value="2.0"),
    ]

    gz_sim = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(ros_gz_share, "launch", "gz_sim.launch.py")
        ),
        launch_arguments={
            "gz_args": f"-r -s {world_file}",
            "on_exit_shutdown": "true",
        }.items(),
    )

    robot_state_publisher = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        output="screen",
        parameters=[
            {
                "robot_description": robot_description,
                "use_sim_time": True,
            }
        ],
    )

    spawn_robot = Node(
        package="ros_gz_sim",
        executable="create",
        output="screen",
        arguments=[
            "-world",
            world_name,
            "-topic",
            "robot_description",
            "-name",
            "launchpad_robot",
            "-x",
            LaunchConfiguration("spawn_x"),
            "-y",
            LaunchConfiguration("spawn_y"),
            "-z",
            LaunchConfiguration("spawn_z"),
            "-Y",
            LaunchConfiguration("spawn_yaw"),
        ],
    )

    bridge = Node(
        package="ros_gz_bridge",
        executable="parameter_bridge",
        output="screen",
        parameters=[{"config_file": bridge_file}],
    )

    watchdog = Node(
        package="launchpad_sim",
        executable="cmd_vel_watchdog",
        output="screen",
        parameters=[
            {
                "input_topic": "/cmd_vel",
                "output_topic": "/launchpad/_cmd_vel_safe",
                "timeout_seconds": LaunchConfiguration("watchdog_timeout"),
                "publish_rate_hz": 20.0,
            }
        ],
    )

    monitor = Node(
        package="launchpad_sim",
        executable="mission_monitor",
        output="screen",
        parameters=[
            {
                "map_file": map_file,
                "hold_seconds": LaunchConfiguration("mission_hold"),
                "publish_rate_hz": 10.0,
            }
        ],
    )

    return LaunchDescription(
        [
            *declare_spawn,
            gz_sim,
            robot_state_publisher,
            bridge,
            watchdog,
            monitor,
            TimerAction(period=2.0, actions=[spawn_robot]),
        ]
    )
