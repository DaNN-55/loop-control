#!/usr/bin/env bash
# Review first. This script was syntax-checked only; the audit did not run it.
# Only the two frozen TypeScript/Vitest caches below can be removed.
set -euo pipefail
python3 - "$@" <<'PY_CLEANUP'
import json, os, stat, subprocess, sys, shutil
from pathlib import Path

FROZEN = json.loads('{"at":"2026-11-12T00:25:21.412040+08:00","root":"/Users/dan/.codex/worktrees/maintenance-20261111/loop-control","rootIdentity":[16777232,112516779,16877],"nodeModulesIdentity":[16777232,112528835,16877],"head":"aa404667e949225c8fad1dae2e2aed56887cb357","branch":"codex/maintenance-five-steps-20261111","sourceStatusPaths":["src","scripts","package.json","package-lock.json","tsconfig.json","tsconfig.app.json","tsconfig.node.json","tsconfig.worker.json","tsconfig.local-app.json","vite.config.ts","index.html"],"sourceStatus":"M scripts/storage/backup.mjs\\n M src/connections/ConnectionDraftSession.tsx\\n M src/connections/ConnectionWorkspace.tsx\\n M src/local-app/CompactConnectionWorkspace.tsx\\n M src/local-app/LocalDeletionRecovery.tsx\\n M src/local-app/accountAssetRoots.ts\\n M src/local-app/accountCommands.ts\\n M src/local-app/commandReceipt.ts\\n M src/local-app/configurationCommands.test.ts\\n M src/local-app/configurationCommands.ts\\n M src/local-app/episodeCollection.ts\\n M src/local-app/episodeCommands.ts\\n M src/local-app/episodeLifecycle.ts\\n M src/local-app/historyEpisodeDeletion.test.ts\\n M src/local-app/historyEpisodeDeletion.ts\\n M src/local-app/mediaPaths.ts\\n M src/local-app/mediaRootMigration.ts\\n M src/local-app/mediaRootSettings.ts\\n M src/local-app/recycleBin.ts\\n M src/local-app/scriptProductionStore.ts\\n M src/local-app/studioCommands.ts\\n M src/local-app/workspaceAudio.ts\\n M src/local-app/workspaceCaptionsCommands.ts\\n M src/local-app/workspaceNarration.ts\\n M src/local-app/workspaceVisualCandidates.ts\\n M src/worker/contracts.ts\\n M src/worker/openchatcutStudio.ts\\n M src/worker/runtimeEvidence.ts\\n M src/worker/runtimePreflight.ts\\n M src/workspace/WorkspaceViews.tsx\\n?? scripts/storage/backup-overlap.test.mjs\\n?? src/worker/fileSha256.test.ts\\n?? src/worker/fileSha256.ts","candidates":[{"relative":"node_modules/.tmp","entries":{".":[16777232,112562563,16877,128,1794410454876763583],"tsconfig.node.tsbuildinfo":[16777232,112562565,33188,51,1794412279237426448],"tsconfig.app.tsbuildinfo":[16777232,112562564,33188,46872,1794412279200698983]}},{"relative":"node_modules/.vite","entries":{".":[16777232,112566927,16877,96,1794410530663724612],"vitest":[16777232,112566928,16877,96,1794410530663779570],"vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709":[16777232,112566929,16877,96,1794410530663958195],"vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json":[16777232,112566930,33188,27156,1794412321144693401]}}],"safeLogicalBytes":74079,"safeAllocatedBytes":81920}')
if sys.argv[1:] != ['--apply']:
    print('No action. Review step5-storage.md, then explicitly run this script with --apply.')
    raise SystemExit(0)
root = Path(FROZEN['root'])
def fail(message):
    raise SystemExit('Refused: ' + message)
def meta(path):
    value = path.lstat()
    return [value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns]
def run(args):
    return subprocess.run(args, text=True, capture_output=True)
def git(*args):
    result = run(['git', '--no-optional-locks', '-C', str(root), *args])
    if result.returncode: fail('Git identity check failed')
    return result.stdout.strip()
def snapshot(path):
    rows, pending = {}, [path]
    while pending:
        item = pending.pop()
        value = item.lstat()
        if stat.S_ISLNK(value.st_mode): fail('cache contains a symlink')
        rows[str(item.relative_to(path))] = meta(item)
        if stat.S_ISDIR(value.st_mode):
            pending.extend(Path(entry.path) for entry in os.scandir(item))
        elif not stat.S_ISREG(value.st_mode): fail('cache contains a special file')
    return rows

def reject_build_processes():
    result = run(['ps', '-axo', 'pid=,comm='])
    if result.returncode: fail('cannot inspect active tools')
    names = {'node', 'npm', 'npx', 'tsc', 'vite', 'vitest', 'tsx'}
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or Path(parts[1]).name not in names: continue
        cwd = run(['lsof', '-a', '-p', parts[0], '-d', 'cwd', '-Fn'])
        if cwd.stderr or cwd.returncode not in (0, 1): fail('incomplete process visibility')
        for entry in cwd.stdout.splitlines():
            if entry.startswith('n'):
                location = entry[1:]
                if location == str(root) or location.startswith(str(root) + '/'):
                    fail('a Node/build/test tool is using this worktree')

if root.resolve() != root or not root.is_dir(): fail('worktree path changed')
if meta(root)[:3] != FROZEN['rootIdentity']: fail('worktree identity changed')
modules = root / 'node_modules'
if modules.resolve() != modules or meta(modules)[:3] != FROZEN['nodeModulesIdentity']:
    fail('node_modules identity changed')
if git('rev-parse', '--show-toplevel') != str(root): fail('unexpected repository root')
if git('rev-parse', 'HEAD') != FROZEN['head'] or git('branch', '--show-current') != FROZEN['branch']:
    fail('HEAD or branch changed; audit again')
if git('status', '--porcelain=v1', '--untracked-files=all', '--', *FROZEN['sourceStatusPaths']) != FROZEN['sourceStatus']:
    fail('source change set changed; audit again')
if not getattr(shutil.rmtree, 'avoids_symlink_attacks', False):
    fail('Python does not provide fd-based rmtree')
reject_build_processes()
for candidate in FROZEN['candidates']:
    if candidate['relative'] not in ('node_modules/.tmp', 'node_modules/.vite'):
        fail('unexpected cleanup target')
    target = root / candidate['relative']
    if target.resolve() != target or not target.is_dir(): fail('cache path changed')
    if snapshot(target) != candidate['entries']: fail('cache metadata changed; audit again')
    opened = run(['lsof', '-nP', '+D', str(target)])
    if opened.stderr or opened.returncode != 1 or opened.stdout:
        fail('cache is open or open-file visibility is incomplete')
    reject_build_processes()
    if snapshot(target) != candidate['entries']: fail('cache changed during checks')
    shutil.rmtree(target)
    print('Removed regenerable cache:', target)
print('No worktree, branch, session, log, SDK, runtime release or source was targeted.')
PY_CLEANUP
