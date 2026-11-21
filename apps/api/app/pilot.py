import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone


class PilotStore:
    def __init__(self, state_dir, invite_ttl_seconds, access_ttl_seconds):
        self.state_dir = state_dir
        self.invite_ttl_seconds = invite_ttl_seconds
        self.access_ttl_seconds = access_ttl_seconds
        self.invites_path = os.path.join(state_dir, "invites.json")
        self.access_path = os.path.join(state_dir, "access.json")
        self.control_path = os.path.join(state_dir, "control.json")
        self.events_path = os.path.join(state_dir, "events.jsonl")
        self._lock = threading.RLock()
        self._attempts = defaultdict(deque)
        os.makedirs(state_dir, mode=0o700, exist_ok=True)
        try:
            os.chmod(state_dir, 0o700)
        except OSError:
            pass

    def _read(self, path, default):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return default

    def _write(self, path, payload):
        temporary = f"{path}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, path)

    @staticmethod
    def _now():
        return time.time()

    @staticmethod
    def _hash(value):
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _new_code():
        payload = base64.b32encode(secrets.token_bytes(16)).decode("ascii")
        return payload.rstrip("=")

    @staticmethod
    def _normalize_code(code):
        return "".join(code.split()).upper()

    def _invites(self):
        return self._read(self.invites_path, {})

    def _access(self):
        return self._read(self.access_path, {})

    def control_state(self):
        control = self._read(self.control_path, {"state": "open"})
        state = control.get("state", "open")
        return state if state in {"open", "paused", "closed"} else "open"

    def set_control(self, state):
        if state not in {"open", "paused", "closed"}:
            raise ValueError("invalid pilot state")
        with self._lock:
            self._write(
                self.control_path,
                {"state": state, "updated_at": self._now()},
            )

    def create_invite(self, label, ttl_seconds=None, max_uses=1):
        ttl = self.invite_ttl_seconds if ttl_seconds is None else ttl_seconds
        code = self._new_code()
        invite_id = secrets.token_hex(8)
        now = self._now()
        invite = {
            "id": invite_id,
            "label": label[:80],
            "code_hash": self._hash(self._normalize_code(code)),
            "created_at": now,
            "expires_at": now + max(60, int(ttl)),
            "max_uses": max(1, int(max_uses)),
            "uses": 0,
            "revoked": False,
            "sessions": [],
        }
        with self._lock:
            invites = self._invites()
            invites[invite_id] = invite
            self._write(self.invites_path, invites)
        return code, invite

    def list_invites(self):
        invites = self._invites()
        now = self._now()
        return [
            {
                "id": invite["id"],
                "label": invite.get("label", ""),
                "created_at": invite.get("created_at"),
                "expires_at": invite.get("expires_at"),
                "max_uses": invite.get("max_uses", 1),
                "uses": invite.get("uses", 0),
                "revoked": bool(invite.get("revoked")),
                "expired": now >= invite.get("expires_at", 0),
                "sessions": list(invite.get("sessions", [])),
            }
            for invite in sorted(
                invites.values(),
                key=lambda item: item.get("created_at", 0),
            )
        ]

    def revoke_invite(self, invite_id):
        with self._lock:
            invites = self._invites()
            invite = invites.get(invite_id)
            if invite is None:
                return False
            invite["revoked"] = True
            self._write(self.invites_path, invites)
            return True

    def revoke_all_invites(self):
        with self._lock:
            invites = self._invites()
            for invite in invites.values():
                invite["revoked"] = True
            self._write(self.invites_path, invites)
            return len(invites)

    def _valid_invite(self, invite, now, require_available=True):
        if invite is None or invite.get("revoked"):
            return False
        if now >= invite.get("expires_at", 0):
            return False
        if require_available and invite.get("uses", 0) >= invite.get("max_uses", 1):
            return False
        return True

    def redeem(self, code):
        if self.control_state() != "open":
            return None
        normalized = self._normalize_code(code)
        if len(normalized) < 16:
            return None
        digest = self._hash(normalized)
        now = self._now()
        with self._lock:
            invites = self._invites()
            matched = None
            for invite in invites.values():
                if hmac.compare_digest(invite.get("code_hash", ""), digest):
                    matched = invite
                    break
            if not self._valid_invite(matched, now):
                return None
            access_token = secrets.token_urlsafe(32)
            expires_at = min(
                matched["expires_at"],
                now + self.access_ttl_seconds,
            )
            access = self._access()
            access[self._hash(access_token)] = {
                "invite_id": matched["id"],
                "created_at": now,
                "expires_at": expires_at,
                "consumed": False,
                "session_id": None,
            }
            self._write(self.access_path, access)
            return access_token, matched["id"]

    def authorize(self, access_token):
        if not access_token:
            return None
        now = self._now()
        with self._lock:
            access = self._access()
            record = access.get(self._hash(access_token))
            if record is None or now >= record.get("expires_at", 0):
                return None
            invites = self._invites()
            invite = invites.get(record.get("invite_id"))
            if not self._valid_invite(invite, now, require_available=False):
                return None
            return {
                "invite_id": record["invite_id"],
                "consumed": bool(record.get("consumed")),
                "record": record,
                "invite": invite,
            }

    def consume(self, access_token, session_id):
        if not access_token:
            return False
        now = self._now()
        with self._lock:
            access = self._access()
            key = self._hash(access_token)
            record = access.get(key)
            if record is None or record.get("consumed"):
                return False
            if now >= record.get("expires_at", 0):
                return False
            invites = self._invites()
            invite = invites.get(record.get("invite_id"))
            if not self._valid_invite(invite, now):
                return False
            invite["uses"] = invite.get("uses", 0) + 1
            invite.setdefault("sessions", []).append(session_id)
            record["consumed"] = True
            record["session_id"] = session_id
            self._write(self.invites_path, invites)
            self._write(self.access_path, access)
            return True

    def allow_attempt(self, key, limit, window_seconds):
        now = self._now()
        with self._lock:
            attempts = self._attempts[key]
            while attempts and now - attempts[0] > window_seconds:
                attempts.popleft()
            if len(attempts) >= limit:
                return False
            attempts.append(now)
            return True

    def emit(self, event, session_tag=None, **fields):
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
        }
        if session_tag:
            payload["session_tag"] = session_tag
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        line = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        with self._lock:
            with open(self.events_path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
            try:
                os.chmod(self.events_path, 0o600)
            except OSError:
                pass

    def progress_events(self, session_tag, old, new, step_ids):
        old = old or {}
        new = new or {}
        old_step = old.get("stepIndex")
        new_step = new.get("stepIndex")
        step_id = (
            step_ids[new_step]
            if isinstance(new_step, int) and 0 <= new_step < len(step_ids)
            else None
        )
        if new_step != old_step:
            self.emit(
                "step_entered",
                session_tag,
                step=step_id,
                step_index=new_step,
            )
        for key, event in (
            ("quizDone", "quiz_correct"),
            ("quizWrong", "quiz_wrong"),
            ("predictionDone", "prediction_correct"),
            ("predictionWrong", "prediction_wrong"),
            ("motionDone", "motion_done"),
        ):
            if new.get(key) and not old.get(key):
                self.emit(event, session_tag, step=step_id, step_index=new_step)
        old_hints = old.get("hintsShown")
        new_hints = new.get("hintsShown")
        if isinstance(new_hints, int) and new_hints > (old_hints or 0):
            self.emit(
                "hint_shown",
                session_tag,
                step=step_id,
                step_index=new_step,
                hints=new_hints,
            )
        if new.get("solutionVisible") and not old.get("solutionVisible"):
            self.emit(
                "solution_shown",
                session_tag,
                step=step_id,
                step_index=new_step,
            )
