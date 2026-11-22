import os
from glob import glob

from setuptools import find_packages, setup

package_name = "launchpad_sim"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        (
            "share/ament_index/resource_index/packages",
            ["resource/" + package_name],
        ),
        ("share/" + package_name, ["package.xml"]),
        (os.path.join("share", package_name, "config"), glob("config/*")),
        (os.path.join("share", package_name, "worlds"), glob("worlds/*.sdf")),
        (os.path.join("share", package_name, "urdf"), glob("urdf/*.xacro")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="ROS 2 Launchpad",
    maintainer_email="launchpad@example.invalid",
    description="Robot, warehouse and mission nodes for ROS 2 Launchpad.",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "cmd_vel_watchdog = launchpad_sim.cmd_vel_watchdog:main",
            "mission_monitor = launchpad_sim.mission_monitor:main",
            "odom_merge = launchpad_sim.odom_merge:main",
            "generate_world = launchpad_sim.generate_world:main",
        ]
    },
)
