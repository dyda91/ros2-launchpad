import os
from glob import glob

from setuptools import find_packages, setup

package_name = "launchpad_bringup"

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
        (os.path.join("share", package_name, "launch"), glob("launch/*.py")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="ROS 2 Launchpad",
    maintainer_email="launchpad@example.invalid",
    description="Launch files for the ROS 2 Launchpad laboratory.",
    license="Apache-2.0",
    entry_points={"console_scripts": []},
)
