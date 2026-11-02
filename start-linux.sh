#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed - opening the offline version."
  xdg-open "Nightbound.html"; exit 0
fi
(sleep 1; xdg-open "http://localhost:8090" >/dev/null 2>&1) &
node server.js 8090
