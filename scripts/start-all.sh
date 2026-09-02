#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
n8n_port="${N8N_PORT:-5678}"
n8n_pid=""

cleanup() {
  if [[ -n "$n8n_pid" ]] && kill -0 "$n8n_pid" 2>/dev/null; then
    kill "$n8n_pid"
    wait "$n8n_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$project_root"
if ! curl --fail --silent --max-time 1 --output /dev/null "http://127.0.0.1:${n8n_port}/healthz"; then
  "$project_root/n8n/start-local.sh" &
  n8n_pid=$!
  for _ in {1..30}; do
    curl --fail --silent --max-time 1 --output /dev/null "http://127.0.0.1:${n8n_port}/healthz" && break
    sleep 0.5
  done
  curl --fail --silent --max-time 1 --output /dev/null "http://127.0.0.1:${n8n_port}/healthz" || { print -u2 "n8n 未能在 15 秒内启动。"; exit 1; }
fi

npm run dev:local
