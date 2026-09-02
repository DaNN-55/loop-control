#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
dry_run=false
case "${1:-}" in
  "") ;;
  --dry-run) dry_run=true ;;
  *) print -u2 "用法：npm run stop:all [-- --dry-run]"; exit 2 ;;
esac
(( $# <= 1 )) || { print -u2 "用法：npm run stop:all [-- --dry-run]"; exit 2; }

typeset -A seen_groups
typeset -a groups

add_group_for_pid() {
  local pid="$1"
  local group
  group="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  [[ -n "$group" && -z "${seen_groups[$group]-}" ]] || return 0
  seen_groups[$group]=1
  groups+=("$group")
}

add_process_tree() {
  local pid="$1"
  local child
  while read -r child; do
    if [[ -n "$child" ]]; then
      add_process_tree "$child"
    fi
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  add_group_for_pid "$pid"
}

for port in "${VITE_PORT:-5173}" "${N8N_PORT:-5678}"; do
  while read -r pid; do
    if [[ -n "$pid" ]]; then
      add_process_tree "$pid"
    fi
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
done

hyperframes_command="$project_root/node_modules/.bin/hyperframes preview "
while read -r pid command; do
  if [[ "$command " == *"$hyperframes_command"* ]]; then
    add_process_tree "$pid"
  fi
done < <(ps -axo pid=,command=)

if (( ${#groups} == 0 )); then
  print "没有发现需要关闭的本项目进程。"
  exit 0
fi

if $dry_run; then
  print "将关闭 ${#groups} 个本项目进程组：${(j:, :)groups}"
  exit 0
fi

for group in "${groups[@]}"; do
  kill -TERM -- "-$group" 2>/dev/null || true
done

for _ in {1..20}; do
  alive=false
  for group in "${groups[@]}"; do
    if kill -0 -- "-$group" 2>/dev/null; then
      alive=true
    fi
  done
  $alive || break
  sleep 0.1
done

for group in "${groups[@]}"; do
  if kill -0 -- "-$group" 2>/dev/null; then
    kill -KILL -- "-$group" 2>/dev/null || true
  fi
done

print "已关闭本项目的 Vite、n8n 和 HyperFrames Preview。"
