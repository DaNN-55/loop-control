#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
brew_prefix="$(brew --prefix)"
node_binary="$brew_prefix/opt/node@24/bin/node"
n8n_entrypoint="$script_dir/node24/node_modules/n8n/bin/n8n"
simdjson_dylib="$(otool -L "$node_binary" | awk '/libsimdjson\./ { print $1; exit }')"

if [[ ! -x "$node_binary" || ! -f "$n8n_entrypoint" ]]; then
  print -u2 "缺少 Node 24 或本地 n8n 2.34.5 依赖。"
  exit 1
fi
[[ "$("$node_binary" -p 'process.versions.node.split(".")[0]')" == "24" ]] || { print -u2 "n8n 必须使用 Node 24；请检查 Homebrew node@24 安装。"; exit 1; }

if [[ -n "$simdjson_dylib" && ! -f "$simdjson_dylib" ]]; then
  simdjson_dylib="$(find -L "$brew_prefix/Cellar/simdjson" -type f -name "${simdjson_dylib:t}" -print | sort | tail -n 1)"
fi

export PATH="$brew_prefix/opt/node@24/bin:$brew_prefix/bin:/usr/bin:/bin"
if [[ -n "$simdjson_dylib" ]]; then
  export DYLD_LIBRARY_PATH="${simdjson_dylib:h}${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi
export N8N_USER_FOLDER="${N8N_USER_FOLDER:-$project_root/n8n/runtime}"
export N8N_DIAGNOSTICS_ENABLED="false"
export NODES_EXCLUDE=""

if [[ -f "$script_dir/worker.env.local" ]]; then
  set -a
  source "$script_dir/worker.env.local"
  set +a
fi

mkdir -p "$N8N_USER_FOLDER"
workflow_staging_dir="$(mktemp -d "$N8N_USER_FOLDER/import-workflows.XXXXXX")"
trap 'rm -rf "$workflow_staging_dir"' EXIT
"$node_binary" "$script_dir/prepare-workflows.mjs" "$script_dir/workflows" "$workflow_staging_dir"
"$node_binary" "$n8n_entrypoint" import:workflow --separate --input="$workflow_staging_dir"
for workflow_id in Cy50xRCgT2cj4WT4 fFvOzmKS4OAMTcjd BhEqokY531BBg64d BxXyfBbkS49QMTEv; do
  "$node_binary" "$n8n_entrypoint" publish:workflow --id="$workflow_id"
done
