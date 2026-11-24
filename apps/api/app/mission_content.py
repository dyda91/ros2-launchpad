from pathlib import Path
import re

import yaml

TASK_KINDS = {"command", "answer", "quiz", "pose", "scan", "delivery"}
MIN_STEPS = 4
MAX_STEPS = 16
APPROVED_HOOK = "Como o robô saberia que há uma caixa no caminho?"


def _require(mapping, key, kind, path):
    value = mapping.get(key)
    if value is None:
        raise ValueError(f"{path}.{key} is required")
    if not isinstance(value, kind) or isinstance(value, bool) and kind is not bool:
        raise ValueError(f"{path}.{key} has an invalid type")
    return value


def _optional(mapping, key, kind, path):
    value = mapping.get(key)
    if value is None:
        return None
    if not isinstance(value, kind) or isinstance(value, bool) and kind is not bool:
        raise ValueError(f"{path}.{key} has an invalid type")
    return value


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _string_list(mapping, key, path, required=False, allow_empty=True):
    value = mapping.get(key)
    if value is None:
        if required:
            raise ValueError(f"{path}.{key} is required")
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{path}.{key} must be a list of strings")
    if not allow_empty and not value:
        raise ValueError(f"{path}.{key} must not be empty")
    return value


def _single_lines(values, path):
    for item in values:
        if "\n" in item:
            raise ValueError(f"{path} entries must be single lines")


def _validate_question(question, path):
    _require(question, "prompt", str, path)
    options = _require(question, "options", list, path)
    if len(options) < 2 or not all(isinstance(item, str) for item in options):
        raise ValueError(f"{path}.options must contain at least two strings")
    answer = question.get("answerIndex")
    if not isinstance(answer, int) or isinstance(answer, bool):
        raise ValueError(f"{path}.answerIndex is out of range")
    if answer < 0 or answer >= len(options):
        raise ValueError(f"{path}.answerIndex is out of range")


def _validate_point(value, path):
    if (
        not isinstance(value, list)
        or len(value) != 2
        or not all(_number(item) for item in value)
    ):
        raise ValueError(f"{path} must be [x, y]")


def _validate_pose(task, path):
    criteria = 0
    direction = task.get("direction")
    if direction is not None:
        if direction not in {"forward", "backward"}:
            raise ValueError(f"{path}.direction is invalid")
        distance = task.get("minDistanceM")
        if not _number(distance) or distance <= 0:
            raise ValueError(f"{path}.minDistanceM must be positive")
        criteria += 1
    elif task.get("minDistanceM") is not None:
        raise ValueError(f"{path}.minDistanceM requires direction")
    region = task.get("region")
    if region is not None:
        if not isinstance(region, dict):
            raise ValueError(f"{path}.region must be a mapping")
        _require(region, "label", str, f"{path}.region")
        _validate_point(region.get("min"), f"{path}.region.min")
        _validate_point(region.get("max"), f"{path}.region.max")
        if not all(
            low < high for low, high in zip(region["min"], region["max"])
        ):
            raise ValueError(f"{path}.region min must be below max")
        criteria += 1
    yaw = task.get("yawDeg")
    if yaw is not None:
        if not _number(yaw) or not -180 <= yaw <= 180:
            raise ValueError(f"{path}.yawDeg must be within [-180, 180]")
        tolerance = task.get("yawToleranceDeg")
        if not _number(tolerance) or not 0 < tolerance <= 90:
            raise ValueError(f"{path}.yawToleranceDeg must be in (0, 90]")
        criteria += 1
    rotation = task.get("minRotationDeg")
    if rotation is not None:
        if not _number(rotation) or not 0 < rotation <= 180:
            raise ValueError(f"{path}.minRotationDeg must be in (0, 180]")
        criteria += 1
    if criteria == 0:
        raise ValueError(f"{path} needs at least one pose criterion")


def _validate_task(task, path):
    if not isinstance(task, dict):
        raise ValueError(f"{path} must be a mapping")
    _require(task, "id", str, path)
    kind = _require(task, "kind", str, path)
    if kind not in TASK_KINDS:
        raise ValueError(f"{path}.kind is invalid")
    for key in ("title", "prompt", "feedback"):
        _require(task, key, str, path)
    _optional(task, "observe", str, path)
    _string_list(task, "hints", path, required=True)
    insert = _optional(task, "insertCommand", str, path)
    if insert is not None and "\n" in insert:
        raise ValueError(f"{path}.insertCommand must be a single line")
    solution = _string_list(task, "solution", path)
    if solution is not None:
        _single_lines(solution, f"{path}.solution")

    if kind == "command":
        patterns = _string_list(
            task, "match", path, required=True, allow_empty=False
        )
        for pattern in patterns:
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"{path}.match has an invalid regex: {exc}")
        _optional(task, "requireSuccess", bool, path)
    elif kind == "answer":
        accept = _string_list(task, "accept", path)
        numeric = task.get("numeric")
        if (accept is None) == (numeric is None):
            raise ValueError(f"{path} needs exactly one of accept or numeric")
        if accept is not None and not accept:
            raise ValueError(f"{path}.accept must not be empty")
        if numeric is not None:
            if not isinstance(numeric, dict):
                raise ValueError(f"{path}.numeric must be a mapping")
            if not _number(numeric.get("value")):
                raise ValueError(f"{path}.numeric.value must be numeric")
            tolerance = numeric.get("tolerance")
            if not _number(tolerance) or tolerance <= 0:
                raise ValueError(f"{path}.numeric.tolerance must be positive")
        _optional(task, "placeholder", str, path)
    elif kind == "quiz":
        _validate_question(
            _require(task, "question", dict, path), f"{path}.question"
        )
    elif kind == "pose":
        _validate_pose(task, path)
    elif kind == "scan":
        sector = task.get("sectorDeg")
        if not _number(sector) or not 0 < sector <= 90:
            raise ValueError(f"{path}.sectorDeg must be in (0, 90]")
        low = task.get("minM")
        high = task.get("maxM")
        if not _number(low) or not _number(high) or not 0 <= low < high:
            raise ValueError(f"{path} needs 0 <= minM < maxM")
    elif kind == "delivery":
        _string_list(task, "strategy", path, required=True, allow_empty=False)
        if not solution:
            raise ValueError(f"{path}.solution must be a non-empty list")
        _optional(task, "solutionNote", str, path)


def _validate_step(step, index, task_ids):
    path = f"steps[{index}]"
    if not isinstance(step, dict):
        raise ValueError(f"{path} must be a mapping")
    _require(step, "id", str, path)
    for key in ("title", "goal", "concept", "why"):
        _require(step, key, str, path)
    _string_list(step, "example", path, required=True)
    learned = _require(step, "learned", list, path)
    for position, item in enumerate(learned):
        item_path = f"{path}.learned[{position}]"
        if not isinstance(item, dict):
            raise ValueError(f"{item_path} must be a mapping")
        _require(item, "command", str, item_path)
        _require(item, "meaning", str, item_path)
    tasks = _require(step, "tasks", list, path)
    if not tasks:
        raise ValueError(f"{path}.tasks must not be empty")
    for position, task in enumerate(tasks):
        task_path = f"{path}.tasks[{position}]"
        _validate_task(task, task_path)
        if task["id"] in task_ids:
            raise ValueError(f"duplicate task id: {task['id']}")
        task_ids.add(task["id"])


def load_mission(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    return validate_mission(data)


def validate_mission(data):
    if not isinstance(data, dict):
        raise ValueError("mission content must be a mapping")
    for key in ("id", "title", "intro"):
        _require(data, key, str, "mission")
    if data.get("version") != 3:
        raise ValueError("mission.version must be 3")
    steps = _require(data, "steps", list, "mission")
    if not MIN_STEPS <= len(steps) <= MAX_STEPS:
        raise ValueError(
            f"mission must have between {MIN_STEPS} and {MAX_STEPS} steps"
        )
    step_ids = set()
    task_ids = set()
    for index, step in enumerate(steps):
        _validate_step(step, index, task_ids)
        if step["id"] in step_ids:
            raise ValueError(f"duplicate step id: {step['id']}")
        step_ids.add(step["id"])
    deliveries = [
        (step_index, task_index)
        for step_index, step in enumerate(steps)
        for task_index, task in enumerate(step["tasks"])
        if task["kind"] == "delivery"
    ]
    last = (len(steps) - 1, len(steps[-1]["tasks"]) - 1)
    if deliveries != [last]:
        raise ValueError("mission needs exactly one delivery, as the last task")
    success = _require(data, "success", dict, "mission")
    for key in ("title", "body", "hook"):
        _require(success, key, str, "mission.success")
    if success["hook"] != APPROVED_HOOK:
        raise ValueError("success.hook does not match the approved mission")
    return data


def mission_shape(data):
    return [len(step["tasks"]) for step in data["steps"]]
