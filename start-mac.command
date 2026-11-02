#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed - opening the offline version (install Node.js from https://nodejs.org for LAN play)."
  open "Nightbound.html"; exit 0
fi
(sleep 1; open "http://localhost:8090") &
node server.js 8090
