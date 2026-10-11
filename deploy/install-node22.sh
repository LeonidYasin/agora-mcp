#!/usr/bin/env bash
# Root; isolated Node installation, no system Node replacement.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
if [ -e /opt/agora-node ]; then
  /opt/agora-node/bin/node -e 'if(process.versions.node.split(".")[0]!=="22")process.exit(1)'
  echo "Existing Node 22 retained; no update performed."
  exit 0
fi
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "Unsupported architecture"; exit 1 ;; esac
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
BASE=https://nodejs.org/dist/latest-v22.x
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
ARCHIVE=$(awk -v a="$ARCH" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" a "\\.tar\\.xz$") {print $2}' "$TMP/SHASUMS256.txt")
[ -n "$ARCHIVE" ] && [[ "$ARCHIVE" != *$'\n'* ]] || { echo "Archive selection failed"; exit 1; }
curl -fsSL "$BASE/$ARCHIVE" -o "$TMP/$ARCHIVE"
(cd "$TMP"; awk -v f="$ARCHIVE" '$2 == f' SHASUMS256.txt | sha256sum -c -)
install -d -m 755 /opt/agora-node
tar --no-same-owner -xJf "$TMP/$ARCHIVE" --strip-components=1 -C /opt/agora-node
/opt/agora-node/bin/node --version
PATH="/opt/agora-node/bin:$PATH" /opt/agora-node/bin/npm --version
