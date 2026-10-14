#!/bin/sh
# Starts the virtual display the headed Chrome renders into, waits until it
# accepts connections, then hands PID 1 to the command (the worker by default).
set -eu
display_number="${DISPLAY#:}"
rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}"
Xvfb "$DISPLAY" -screen 0 1366x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
i=0
until [ -S "/tmp/.X11-unix/X${display_number}" ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then
    echo "Xvfb did not start on $DISPLAY:" >&2
    cat /tmp/xvfb.log >&2
    exit 1
  fi
  sleep 0.1
done
exec "$@"
