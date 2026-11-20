# syntax=docker/dockerfile:1
FROM ros:jazzy-ros-base@sha256:3f3a309d342b0f8a9212d195a416d5c50deb1716edc8bdfe5e134bcaa38d708c

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive
ENV ROS_DISTRO=jazzy
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
ENV ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
ENV ROS_DOMAIN_ID=42
ENV GZ_PARTITION=launchpad_dev
ENV HOME=/home/ubuntu
ENV GZ_IP=127.0.0.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ros-jazzy-ros-gz-sim=1.0.25-1noble.20261105.125630 \
        ros-jazzy-ros-gz-bridge=1.0.25-1noble.20261105.093704 \
        ros-jazzy-robot-state-publisher=3.3.4-1noble.20261105.103958 \
        ros-jazzy-rmw-cyclonedds-cpp=2.2.4-1noble.20261105.063358 \
        ros-jazzy-teleop-twist-keyboard=2.4.1-1noble.20261105.090256 \
        ros-jazzy-xacro=2.1.1-1noble.20261025.230251 \
        python3-colcon-common-extensions \
        python3-yaml \
        ca-certificates \
        curl \
        iproute2 \
        procps \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/ubuntu/.ros \
    && chown -R 1000:1000 /home/ubuntu

WORKDIR /ros_ws
COPY lab/ros_ws/src /ros_ws/src
COPY content/world/armazem.yaml /ros_ws/src/launchpad_sim/config/armazem.yaml

RUN source /opt/ros/jazzy/setup.bash \
    && python3 /ros_ws/src/launchpad_sim/launchpad_sim/generate_world.py \
        --config /ros_ws/src/launchpad_sim/config/armazem.yaml \
        --world-out /ros_ws/src/launchpad_sim/worlds/armazem.sdf \
        --map-out /ros_ws/src/launchpad_sim/config/map.json \
    && colcon build --base-paths /ros_ws/src --event-handlers console_direct+ \
    && chown -R 1000:1000 /ros_ws

RUN printf '%s\n' \
    'export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp' \
    'export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST' \
    'export ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-42}' \
    'export GZ_PARTITION=${GZ_PARTITION:-launchpad_dev}' \
    'export GZ_IP=127.0.0.1' \
    'source /opt/ros/jazzy/setup.bash' \
    'source /ros_ws/install/setup.bash' \
    > /etc/profile.d/launchpad.sh \
    && chmod 0644 /etc/profile.d/launchpad.sh

USER 1000:1000
CMD ["sleep", "infinity"]
