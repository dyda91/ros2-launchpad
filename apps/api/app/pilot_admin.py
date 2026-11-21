import argparse
import json
import os

from .pilot import PilotStore


def build_store():
    return PilotStore(
        os.environ.get("PILOT_STATE_DIR", "/var/lib/launchpad/pilot"),
        int(os.environ.get("PILOT_INVITE_TTL_SECONDS", "7200")),
        int(os.environ.get("PILOT_ACCESS_TTL_SECONDS", "7200")),
    )


def main():
    parser = argparse.ArgumentParser(prog="pilot-admin")
    subparsers = parser.add_subparsers(dest="command", required=True)

    invite = subparsers.add_parser("invite")
    invite.add_argument("--label", default="convidado")
    invite.add_argument("--ttl", type=int, default=None)
    invite.add_argument("--max-uses", type=int, default=1)

    subparsers.add_parser("list")
    subparsers.add_parser("status")
    subparsers.add_parser("pause")
    subparsers.add_parser("resume")
    subparsers.add_parser("close")
    subparsers.add_parser("events")

    revoke = subparsers.add_parser("revoke")
    revoke.add_argument("invite_id")

    events = subparsers.add_parser("events-session")
    events.add_argument("session_tag")

    args = parser.parse_args()
    store = build_store()

    if args.command == "invite":
        code, invite = store.create_invite(
            args.label,
            ttl_seconds=args.ttl,
            max_uses=args.max_uses,
        )
        print(json.dumps({"id": invite["id"], "code": code}))
    elif args.command == "list":
        print(json.dumps(store.list_invites(), indent=2, ensure_ascii=False))
    elif args.command == "status":
        print(json.dumps({"state": store.control_state()}))
    elif args.command == "pause":
        store.set_control("paused")
        print(json.dumps({"state": "paused"}))
    elif args.command == "resume":
        store.set_control("open")
        print(json.dumps({"state": "open"}))
    elif args.command == "close":
        store.set_control("closed")
        revoked = store.revoke_all_invites()
        print(json.dumps({"state": "closed", "revoked": revoked}))
    elif args.command == "revoke":
        revoked = store.revoke_invite(args.invite_id)
        print(json.dumps({"revoked": revoked}))
    elif args.command == "events":
        try:
            with open(store.events_path, "r", encoding="utf-8") as handle:
                for line in handle:
                    print(line.rstrip())
        except OSError:
            return
    elif args.command == "events-session":
        try:
            with open(store.events_path, "r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        payload = json.loads(line)
                    except ValueError:
                        continue
                    if payload.get("session_tag") == args.session_tag:
                        print(json.dumps(payload, ensure_ascii=False))
        except OSError:
            return


if __name__ == "__main__":
    main()
