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

LP_DATA=/usr/share/launchpad/ros2_complete_data.bash
LP_GRAPH=${LAUNCHPAD_GRAPH_FILE:-/tmp/launchpad_graph}

__lp_graph_names() {
  local tag=$1 kind name type
  REPLY_WORDS=""
  while read -r kind name type; do
    [[ $kind == "$tag" ]] && REPLY_WORDS+=" $name"
  done < "$LP_GRAPH"
}

__lp_actions() {
  local kind name type
  REPLY_WORDS=""
  while read -r kind name type; do
    [[ $kind == S && $name == */_action/send_goal ]] && REPLY_WORDS+=" ${name%/_action/send_goal}"
  done < "$LP_GRAPH"
}

__lp_prefix_words() {
  local prefix file
  REPLY_WORDS=""
  for prefix in ${AMENT_PREFIX_PATH//:/ }; do
    for file in "$prefix"/share/ament_index/resource_index/packages/*; do
      [[ -e $file ]] && REPLY_WORDS+=" ${file##*/}"
    done
  done
}

__lp_executables() {
  local prefix file
  REPLY_WORDS=""
  for prefix in ${AMENT_PREFIX_PATH//:/ }; do
    for file in "$prefix/lib/$1"/*; do
      [[ -f $file && -x $file ]] && REPLY_WORDS+=" ${file##*/}"
    done
  done
}

__lp_words_for() {
  local kind=$1
  REPLY_WORDS=""
  case $kind in
    topic) __lp_graph_names T ;;
    node) __lp_graph_names N ;;
    service) __lp_graph_names S ;;
    action) __lp_actions ;;
    msgtype) REPLY_WORDS=$LP_MSGTYPES ;;
    srvtype) REPLY_WORDS=$LP_SRVTYPES ;;
    acttype) REPLY_WORDS=$LP_ACTTYPES ;;
    anytype) REPLY_WORDS="$LP_MSGTYPES $LP_SRVTYPES $LP_ACTTYPES" ;;
    package) __lp_prefix_words ;;
    executable) __lp_executables "$2" ;;
    choices:*) REPLY_WORDS=${kind#choices:}; REPLY_WORDS=${REPLY_WORDS//,/ } ;;
    *) REPLY_WORDS="" ;;
  esac
}

_launchpad_ros2() {
  COMPREPLY=()
  if [[ -z ${LP_LOADED:-} ]]; then
    if [[ -r $LP_DATA ]] && source "$LP_DATA"; then
      LP_LOADED=1
    else
      _python_argcomplete "$@"
      return
    fi
  fi
  local cur=${COMP_WORDS[COMP_CWORD]} path="" key npos=0 pending=0 i w v kind idx
  local -a posw=()
  for ((i = 1; i < COMP_CWORD; i++)); do
    w=${COMP_WORDS[i]}
    key=${path:-/}
    if ((pending)); then
      pending=0
      continue
    fi
    if [[ $w == -* && $w != - ]]; then
      if [[ $w != *=* ]]; then
        v=${LP_OPTV["$key|$w"]-}
        [[ -n $v && $v != flag ]] && pending=1
      fi
      continue
    fi
    if ((npos == 0)) && [[ -n ${LP_SUB["$key"]-} && " ${LP_SUB["$key"]} " == *" $w "* ]]; then
      path=${path:+$path }$w
      continue
    fi
    posw+=("$w")
    npos=$((npos + 1))
  done
  key=${path:-/}
  if [[ -n ${LP_SLOW["$key"]-} ]]; then
    _python_argcomplete "$@"
    return
  fi
  if ((pending)); then
    kind=${LP_OPTV["$key|${COMP_WORDS[COMP_CWORD - 1]}"]-none}
  elif [[ $cur == -* ]]; then
    REPLY_WORDS=${LP_OPT["$key"]-}
    COMPREPLY=($(compgen -W "$REPLY_WORDS" -- "$cur"))
    return
  elif ((npos == 0)) && [[ -n ${LP_SUB["$key"]-} ]]; then
    REPLY_WORDS=${LP_SUB["$key"]}
    COMPREPLY=($(compgen -W "$REPLY_WORDS" -- "$cur"))
    return
  else
    kind=${LP_POS["$key|$npos"]-}
    if [[ -z $kind ]]; then
      idx=${LP_POS["$key|*"]-}
      if [[ -n $idx ]] && ((npos > idx)); then
        kind=${LP_POS["$key|$idx"]}
      else
        kind=none
      fi
    fi
  fi
  case $kind in
    slow)
      _python_argcomplete "$@"
      return
      ;;
    topic | node | service | action)
      if [[ ! -r $LP_GRAPH ]]; then
        _python_argcomplete "$@"
        return
      fi
      ;;
  esac
  __lp_words_for "$kind" "${posw[0]-}"
  COMPREPLY=($(compgen -W "$REPLY_WORDS" -- "$cur"))
}
complete -o bashdefault -o default -F _launchpad_ros2 ros2 2>/dev/null || true
