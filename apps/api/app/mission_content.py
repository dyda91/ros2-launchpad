from pathlib import Path

import yaml

KINDS = {"quiz", "motion", "delivery"}


def _require(mapping, key, kind, path):
    value = mapping.get(key)
    if value is None:
        raise ValueError(f"{path}.{key} is required")
    if not isinstance(value, kind):
        raise ValueError(f"{path}.{key} has an invalid type")
    return value


def _validate_question(question, path):
    _require(question, "prompt", str, path)
    options = _require(question, "options", list, path)
    if len(options) < 2 or not all(isinstance(item, str) for item in options):
        raise ValueError(f"{path}.options must contain at least two strings")
    answer = question.get("answerIndex")
    if not isinstance(answer, int) or answer < 0 or answer >= len(options):
        raise ValueError(f"{path}.answerIndex is out of range")


def _validate_step(step, index):
    path = f"steps[{index}]"
    _require(step, "id", str, path)
    kind = _require(step, "kind", str, path)
    if kind not in KINDS:
        raise ValueError(f"{path}.kind is invalid")
    for key in ("title", "concept", "action"):
        _require(step, key, str, path)
    for key in ("why", "exercise"):
        value = step.get(key)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"{path}.{key} must be a string")
    example = step.get("example")
    if example is not None:
        if not isinstance(example, list) or not all(
            isinstance(item, str) for item in example
        ):
            raise ValueError(f"{path}.example must be a list of strings")
    hints = _require(step, "hints", list, path)
    if not all(isinstance(item, str) for item in hints):
        raise ValueError(f"{path}.hints must be strings")
    insert = step.get("insertCommand")
    if insert is not None:
        if not isinstance(insert, str) or "\n" in insert:
            raise ValueError(f"{path}.insertCommand must be a single line")

    if kind == "quiz":
        _validate_question(
            _require(step, "question", dict, path), f"{path}.question"
        )

    if kind == "motion":
        _validate_question(
            _require(step, "prediction", dict, path),
            f"{path}.prediction",
        )
        command = _require(step, "command", str, path)
        if "\n" in command:
            raise ValueError(f"{path}.command must be a single line")
        for key in ("minDisplacementM", "stopSpeedMps"):
            value = step.get(key)
            if not isinstance(value, (int, float)) or value <= 0:
                raise ValueError(f"{path}.{key} must be positive")

    if kind == "delivery":
        solution = _require(step, "solution", list, path)
        if not solution or not all(isinstance(item, str) for item in solution):
            raise ValueError(f"{path}.solution must be a non-empty list")
        if any("\n" in item for item in solution):
            raise ValueError(f"{path}.solution commands must be single lines")
        start = _require(step, "solutionStart", dict, path)
        for key in ("x", "y", "yaw", "tolerance"):
            if not isinstance(start.get(key), (int, float)):
                raise ValueError(f"{path}.solutionStart.{key} must be numeric")


def load_mission(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError("mission content must be a mapping")
    for key in ("id", "title", "intro"):
        _require(data, key, str, "mission")
    steps = _require(data, "steps", list, "mission")
    if len(steps) != 6:
        raise ValueError("mission must have exactly six steps")
    ids = set()
    for index, step in enumerate(steps):
        _validate_step(step, index)
        if step["id"] in ids:
            raise ValueError(f"duplicate step id: {step['id']}")
        ids.add(step["id"])
    success = _require(data, "success", dict, "mission")
    for key in ("title", "body", "hook"):
        _require(success, key, str, "mission.success")
    if success["hook"] != "Como o robô saberia que há uma caixa no caminho?":
        raise ValueError("success.hook does not match the approved mission")
    return data
