#!/usr/bin/env python3
"""Provision one invited user. Raw token stays in root-only files, not stdout."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--external-id", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--database", default="agora")
    parser.add_argument("--port", type=int, default=5432)
    args = parser.parse_args()
    if os.geteuid() != 0:
        sys.exit("Run as root.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.external_id):
        sys.exit("External ID must be 1-80 letters/digits/_/-.")
    if not re.fullmatch(r"[a-zA-Z0-9_]{1,63}", args.database) or not 1 <= args.port <= 65535:
        sys.exit("Invalid database or port.")
    if not args.display_name.strip() or len(args.display_name) > 100:
        sys.exit("Invalid display name.")
    directory = Path("/root/agora-invites")
    paths = [directory / (args.external_id + suffix) for suffix in (".token", ".curl")]
    if directory.is_symlink() or any(p.exists() or p.is_symlink() for p in paths):
        sys.exit("Unsafe path or existing token files; no overwrite.")
    def sql(query, token_hash=None):
        command = ["runuser", "-u", "postgres", "--", "psql", "-X", "-p", str(args.port),
                   "-d", args.database, "-At", "-v", "ON_ERROR_STOP=1",
                   "-v", "external_id=" + args.external_id, "-v", "display_name=" + args.display_name]
        if token_hash:
            command += ["-v", "token_hash=" + token_hash]
        result = subprocess.run(command, input=query, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Database operation failed; details hidden.")
        return result.stdout.strip()
    if sql("SELECT id FROM users WHERE external_id = :'external_id';\n"):
        sys.exit("User already exists. No token is replaced or recovered.")
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    token = secrets.token_hex(32)
    contents = [token + "\n", 'header = "Content-Type: application/json"\n'
                'header = "Accept: application/json, text/event-stream"\n'
                'header = "Authorization: Bearer ' + token + '"\n']
    created = []
    try:
        for path, content in zip(paths, contents):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, "w") as file:
                file.write(content)
        sql("INSERT INTO users (external_id, display_name, token_hash) "
            "VALUES (:'external_id', :'display_name', :'token_hash');\n",
            hashlib.sha256(token.encode()).hexdigest())
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        sys.exit("Provisioning failed. New token files removed; inspect DB state before retrying.")
    print("Created:", args.external_id)
    print("Private token:", paths[0])
    print("Do not paste tokens into chat, issues or documentation.")


if __name__ == "__main__":
    main()
