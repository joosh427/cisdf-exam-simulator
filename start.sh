#!/usr/bin/env bash
# Uruchamia symulator w tle (bez systemd). Użycie: ./start.sh | ./start.sh stop
cd "$(dirname "$0")"
[ -f .pid ] && kill "$(cat .pid)" 2>/dev/null && sleep 1
rm -f .pid
[ "$1" = "stop" ] && exit 0
set -a; . ./.env; set +a
nohup node server.js >> app.log 2>&1 &
echo $! > .pid
sleep 1; tail -n 3 app.log
