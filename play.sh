#!/usr/bin/env bash
# Twicycraft launcher for Linux (works great on Bazzite / SteamOS / Fedora etc.)
#
#   ./play.sh          start the game (multiplayer server if Node.js exists,
#                      otherwise opens the offline single-player version)
#   ./play.sh offline  force the offline version (no server)
#
set -u
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

open_url() {
  # try the common Linux openers in order
  for opener in xdg-open gio flatpak-spawn; do
    if command -v "$opener" >/dev/null 2>&1; then
      case "$opener" in
        gio) gio open "$1" >/dev/null 2>&1 && return 0 ;;
        flatpak-spawn) flatpak-spawn --host xdg-open "$1" >/dev/null 2>&1 && return 0 ;;
        *) "$opener" "$1" >/dev/null 2>&1 && return 0 ;;
      esac
    fi
  done
  echo "Could not auto-open a browser. Open this yourself:"
  echo "  $1"
}

if [ "${1:-}" != "offline" ] && command -v node >/dev/null 2>&1; then
  echo "Node.js found — starting the full game with multiplayer on port $PORT"
  echo "Friends on your network can join via the LAN URL printed below."
  ( sleep 1; open_url "http://localhost:$PORT" ) &
  exec node server/server.js
else
  if [ "${1:-}" != "offline" ]; then
    echo "Node.js not found — launching offline single-player instead."
    echo "(For LAN multiplayer on Bazzite: 'brew install node' or use a distrobox, then rerun.)"
  fi
  open_url "file://$PWD/public/index.html"
fi
