import argparse
import importlib
import os
import shlex
import sys
from importlib.metadata import entry_points

KINDS = {
    "NodeNameCompleter": "node",
    "TopicNameCompleter": "topic",
    "ServiceNameCompleter": "service",
    "action_name_completer": "action",
    "package_name_completer": "package",
    "message_type_completer": "msgtype",
    "TopicTypeCompleter": "msgtype",
    "type_completer": "anytype",
    "ServiceTypeCompleter": "srvtype",
    "service_type_completer": "srvtype",
    "ActionTypeCompleter": "acttype",
    "ExecutableNameCompleter": "executable",
    "TopicMessagePrototypeCompleter": "slow",
    "ServicePrototypeCompleter": "slow",
    "ActionGoalPrototypeCompleter": "slow",
    "SuppressCompleter": "none",
    "SuppressCompleterWorkaround": "none",
}

SKIP_COMMANDS = {"extension_points", "extensions", "plugin"}


def completer_kind(action):
    completer = getattr(action, "completer", None)
    if completer is None:
        return None
    name = getattr(completer, "__name__", None) or type(completer).__name__
    return KINDS.get(name, "slow")


def describe(parser):
    options = {}
    positionals = []
    for action in parser._actions:
        if isinstance(action, (argparse._HelpAction, argparse._SubParsersAction)):
            continue
        kind = completer_kind(action)
        if action.option_strings:
            takes_value = action.nargs != 0
            if action.choices:
                value = "choices:" + ",".join(str(c) for c in action.choices)
            elif not takes_value:
                value = "flag"
            else:
                value = kind or "val"
            for option in action.option_strings:
                options[option] = value
        else:
            if action.choices:
                kind = "choices:" + ",".join(str(c) for c in action.choices)
            repeat = action.nargs in ("*", "+", argparse.REMAINDER)
            positionals.append((kind or "none", repeat))
    return options, positionals


def noop_subparsers(*args, **kwargs):
    return None


def load_commands():
    commands = {}
    for entry in entry_points(group="ros2cli.command"):
        if entry.name in SKIP_COMMANDS:
            continue
        try:
            cls = entry.load()
            commands[entry.name] = cls
        except Exception as exc:
            print(f"skip command {entry.name}: {exc}", file=sys.stderr)
    return commands


def verbs_for(name, cls):
    package = cls.__module__.split(".")[0]
    for group in (f"{package}.verb", f"ros2cli.{name}.verb"):
        found = {}
        for entry in entry_points(group=group):
            try:
                found[entry.name] = entry.load()
            except Exception as exc:
                print(f"skip verb {name} {entry.name}: {exc}", file=sys.stderr)
        if found:
            return found
    return {}


def build():
    subs = {}
    opts = {}
    optv = {}
    pos = {}
    slow = set()
    commands = load_commands()
    subs["/"] = sorted(commands)
    for name, cls in sorted(commands.items()):
        module = sys.modules.get(cls.__module__)
        if module is not None and hasattr(module, "add_subparsers_on_demand"):
            module.add_subparsers_on_demand = noop_subparsers
        parser = argparse.ArgumentParser(add_help=True)
        try:
            cls().add_arguments(parser, f"ros2 {name}")
            found, positionals = describe(parser)
        except Exception as exc:
            print(f"command {name} arguments failed: {exc}", file=sys.stderr)
            slow.add(name)
            found, positionals = {}, []
        record(name, found, positionals, opts, optv, pos)
        verbs = verbs_for(name, cls)
        if verbs:
            subs[name] = sorted(verbs)
        for verb, verb_cls in sorted(verbs.items()):
            path = f"{name} {verb}"
            verb_parser = argparse.ArgumentParser(add_help=True)
            try:
                verb_cls().add_arguments(verb_parser, f"ros2 {path}")
                found, positionals = describe(verb_parser)
            except Exception as exc:
                print(f"verb {path} arguments failed: {exc}", file=sys.stderr)
                slow.add(path)
                found, positionals = {}, []
            record(path, found, positionals, opts, optv, pos)
    return subs, opts, optv, pos, slow


def record(path, found, positionals, opts, optv, pos):
    opts[path] = sorted(set(found) - {"-h", "--help"})
    for option, value in found.items():
        optv[f"{path}|{option}"] = value
    for index, (kind, repeat) in enumerate(positionals):
        pos[f"{path}|{index}"] = kind
        if repeat:
            pos[f"{path}|*"] = str(index)


def interfaces():
    kinds = {"msg": set(), "srv": set(), "action": set()}
    prefixes = [p for p in os.environ.get("AMENT_PREFIX_PATH", "").split(":") if p]
    for prefix in prefixes:
        index = os.path.join(prefix, "share", "ament_index", "resource_index", "rosidl_interfaces")
        if not os.path.isdir(index):
            continue
        for package in os.listdir(index):
            with open(os.path.join(index, package), encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    base, dot, extension = line.rpartition(".")
                    if extension in kinds and "/" in base:
                        kinds[extension].add(f"{package}/{base}")
    return {key: sorted(value) for key, value in kinds.items()}


def main():
    arguments = argparse.ArgumentParser()
    arguments.add_argument("--out", required=True)
    parsed = arguments.parse_args()
    subs, opts, optv, pos, slow = build()
    found = interfaces()
    lines = [
        "declare -gA LP_SUB LP_OPT LP_OPTV LP_POS LP_SLOW",
    ]
    for table, name in ((subs, "LP_SUB"), (opts, "LP_OPT"), (optv, "LP_OPTV"), (pos, "LP_POS")):
        for key, value in sorted(table.items()):
            text = " ".join(value) if isinstance(value, list) else value
            lines.append(f"{name}[{shlex.quote(key)}]={shlex.quote(text)}")
    for path in sorted(slow):
        lines.append(f"LP_SLOW[{shlex.quote(path)}]=1")
    lines.append(f"LP_MSGTYPES={shlex.quote(' '.join(found['msg']))}")
    lines.append(f"LP_SRVTYPES={shlex.quote(' '.join(found['srv']))}")
    lines.append(f"LP_ACTTYPES={shlex.quote(' '.join(found['action']))}")
    with open(parsed.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
