#!/bin/bash
# Cloud sessions ship an older Node, but cli/ (hexc) needs Node >=24.18 <25.
# Install Node 24 from nodejs.org when needed and put it on PATH for the session.
set -euo pipefail

# Only run in Claude Code cloud sessions; local sessions use their own Node.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

NODE_VERSION="${HEXAGON_NODE_VERSION:-24.18.0}"
NODE_DIR="$HOME/.local/node-v$NODE_VERSION"

# True when the given node binary is 24.x at 24.18 or later.
node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a===24&&b>=18?0:1)' 2>/dev/null
}

if command -v node >/dev/null 2>&1 && node_ok node; then
  exit 0
fi

if ! { [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; }; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "session-start: unsupported arch $(uname -m)" >&2; exit 1 ;;
  esac
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" -o "$tmp/node.tar.xz"
  mkdir -p "$tmp/x"
  tar -xJf "$tmp/node.tar.xz" -C "$tmp/x" --strip-components=1
  rm -rf "$NODE_DIR"
  mkdir -p "$(dirname "$NODE_DIR")"
  mv "$tmp/x" "$NODE_DIR"
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
echo "session-start: using Node $("$NODE_DIR/bin/node" -v) from $NODE_DIR" >&2
