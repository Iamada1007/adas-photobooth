#!/bin/zsh
cd "$(dirname "$0")"

NODE="/Users/lo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ ! -x "$NODE" ]; then
  NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  echo "Node.js was not found. Please run this from Codex or install Node.js."
  read "?Press Enter to close."
  exit 1
fi

open "http://localhost:4288"
"$NODE" server.js
