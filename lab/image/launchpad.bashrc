source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
if [ -f /usr/share/bash-completion/bash_completion ]; then
  . /usr/share/bash-completion/bash_completion
fi
unset HISTFILE
HISTCONTROL=
HISTSIZE=2000
__launchpad_ready=0
__launchpad_last=""
__launchpad_report() {
  local code=$?
  local entry number command
  entry="$(HISTTIMEFORMAT= builtin history 1)"
  number=""
  command=""
  if [[ $entry =~ ^[[:space:]]*([0-9]+)[[:space:]]+(.*)$ ]]; then
    number="${BASH_REMATCH[1]}"
    command="${BASH_REMATCH[2]}"
  fi
  if [[ $__launchpad_ready == 0 ]]; then
    __launchpad_ready=1
    __launchpad_last="$number"
    return
  fi
  if [[ -n $number && $number != "$__launchpad_last" ]]; then
    __launchpad_last="$number"
    printf '\e]1337;LaunchpadCommand=%s;%s\a' \
      "$(printf '%s' "${command:0:512}" | base64 -w0)" "$code"
  fi
}
PROMPT_COMMAND=__launchpad_report
PS1='\[\e]1337;LaunchpadPrompt\a\]\u@\h:\w\$ '
export PS1
bind 'set show-all-if-ambiguous on' 2>/dev/null || true
bind 'set show-all-if-unmodified on' 2>/dev/null || true
