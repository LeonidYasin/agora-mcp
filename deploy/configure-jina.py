#!/usr/bin/env python3
"""Root-only first-time environment setup. No secret values in output or argv."""
import getpass
import os
from pathlib import Path
import sys
from urllib.parse import quote


def main():
    if os.geteuid() != 0:
        sys.exit("Run as root.")
    directory = Path("/etc/agora-mcp")
    path = directory / "agora.env"
    if directory.is_symlink() or path.exists() or path.is_symlink():
        sys.exit("Unsafe path or existing configuration; no overwrite.")
    password = getpass.getpass("Database password for agora: ")
    key = getpass.getpass("Jina API key: ").strip()
    if not password or not key or any(c.isspace() for c in key):
        sys.exit("Empty password or invalid API key; no file written.")
    values = {
        "NODE_ENV": "production", "HOST": "127.0.0.1", "PORT": "3011",
        "DATABASE_URL": "postgres://agora:" + quote(password, safe="") + "@127.0.0.1:5432/agora",
        "EMBEDDING_PROVIDER": "openai", "EMBEDDING_BASE_URL": "https://api.jina.ai",
        "EMBEDDING_MODEL": "jina-embeddings-v3", "EMBEDDING_API_KEY": key,
    }
    def quoted(value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write("".join(k + "=" + quoted(v) + "\n" for k, v in values.items()))
    print("Configuration saved privately to /etc/agora-mcp/agora.env")


if __name__ == "__main__":
    main()
