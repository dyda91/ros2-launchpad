source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
if [ -f /usr/share/bash-completion/bash_completion ]; then
  . /usr/share/bash-completion/bash_completion
fi
PS1='\[\e]1337;LaunchpadPrompt\a\]\u@\h:\w\$ '
export PS1
bind 'set show-all-if-ambiguous on' 2>/dev/null || true
bind 'set show-all-if-unmodified on' 2>/dev/null || true
