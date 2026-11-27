# macOS 空库验收与新机安装边界

> 当前 `npm start` 只启动已配置好的日常部署，不会在新 Mac 上创建数据库、媒体根、Keychain 或首位 Owner。下面可以从独立源码验证第一张测试生产单到成片，但不是日常部署安装说明。请勿把测试 Owner、测试回执或临时目录用于日常运行。

## 新 Mac 需要准备什么

| 随源码提供 | 由新机安装或配置 |
| --- | --- |
| 控制台、Worker、锁文件、`clean-v3` 空库 schema 和前向迁移 | 原生 PostgreSQL 17、Node.js 24、npm、Git |
| 本地媒体登记、编辑桥、导出和交付校验 | OpenChatCut 源码和其锁定依赖；FFmpeg、ffprobe；隔离验收使用 Chrome 和 `agent-browser` |
| 日常部署读取器与路径／角色／发布绑定校验 | 新库的应用/Worker 角色与密码引用、媒体根、专用 Keychain、首位 Owner 和部署回执；目前没有受支持的全新初始化入口 |

## 在隔离空库验证第一张生产单

只在新检出的目录运行；不要进入日常 Loop Control 目录。事先准备 Node.js 24、PostgreSQL 17、FFmpeg/ffprobe、Chrome 和 `agent-browser`，并确保命令在 `PATH` 上。Mac 自带 `hdiutil` 和 `diskutil`，本轮用它们挂载临时 APFS 镜像。OpenChatCut 的浏览器集成不需要 Electron 安装包。前置准备需要联网下载公开依赖和运行资源；验收不调用付费供应商。

```zsh
set -e
umask 077
check_root="$(mktemp -d /private/tmp/loop-control-mac-check.XXXXXX)"
export npm_config_cache="$check_root/npm-cache"
git clone --branch main --single-branch --depth 1 \
  https://github.com/DaNN-55/loop-control.git "$check_root/loop-control"
git clone --branch v0.2.17 --single-branch --depth 1 \
  https://github.com/0xsline/OpenChatCut.git "$check_root/OpenChatCut"
test "$(git -C "$check_root/OpenChatCut" rev-parse HEAD)" = \
  72ddb3300cda4ed31cbd0bccbfc94fb29b8cffca

(cd "$check_root/loop-control" && npm ci --no-audit --no-fund)
(
  cd "$check_root/OpenChatCut"
  # npm 12 拒绝 v0.2.17 锁文件里的第三方镜像 URL；只换归档来源，保留摘要。
  node --input-type=module <<'JS'
import {readFileSync, writeFileSync} from 'node:fs';
const file = 'package-lock.json';
const lock = JSON.parse(readFileSync(file, 'utf8'));
const mirror = 'https://registry.npmmirror.com/';
const entries = Object.values(lock.packages).filter(p => p.resolved?.startsWith(mirror));
if (entries.length !== 28 || entries.some(p => !p.integrity?.startsWith('sha512-'))) {
  throw new Error('OpenChatCut 锁文件与固定版本不符');
}
for (const p of entries) p.resolved = 'https://registry.npmjs.org/' + p.resolved.slice(mirror.length);
writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
JS
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
  npm run sync:mediapipe
)

cd "$check_root/loop-control"
LOOP_TEST_POSTGRES_BIN="$(brew --prefix postgresql@17)/bin" \
LOOP_TEST_OPENCHATCUT_ROOT="$check_root/OpenChatCut" \
node scripts/e2e/t12.mjs --scenario unassigned --output "$check_root/evidence"
```

非 Homebrew 安装请直接填写 PostgreSQL 17 `bin` 绝对路径。端口、库、Keychain 或挂载配置不要从旧部署复制。不要省略 `LOOP_TEST_OPENCHATCUT_ROOT`，以免退回日常剪辑路径。

T12 通过私有 Unix socket 接入临时 PostgreSQL，把 `clean-v3` 和后续迁移应用到新库。测试夹具建立测试 Owner 和制作账号，再用真实浏览器登录并新建未归属系列的生产单。素材由测试导入，视觉、语音和对齐使用受控的本地合成结果。浏览器实际打开 OpenChatCut、编辑、保存和重开，再导出、确认并校验交付；不代表走完首位 Owner 自助创建，也不代表用户逐个上传素材。它还在隔离数据内做备份／恢复等检查。

在 T12 打印的 `evidence` 目录检查 `run.json` 是否 `passed: true`、`cleanup.cleanupErrors` 是否为空，再看 `unassigned/browser-playback.json` 的播放证据和 `unassigned/browser-downloads.json` 的下载校验。若失败，先看 `runner-error.txt`、`build.log`、`tests.log`（以实际生成的文件为准）；日志或浏览器快照只留本机，不要提交。不能通过手写回执或修改数据库身份跳过失败。

- 若浅克隆报 `early EOF` 或 `Transferred a partial file`，先检查到 GitHub 的连接，再用新的临时目录重试；不要转而复制日常运行目录。
- 若 npm 报 `EALLOWREMOTE`，先核对 SDK 是否为指定提交，并确认上面的锁文件来源转换已完成，不必放开 npm 的远程归档限制。
- 若 `hdiutil create` 报「目录非空」，确认测试分支包含 macOS 27 的 RAW APFS 夹具兼容修改；它不修改正式媒体盘。

## 最近一次验收结果

2026-11-27，Apple Silicon、macOS 27.0、Node.js 24.20.0、npm 12.2.1、PostgreSQL 17.11。以公开 `main` 的 `7feb25c19b` 为基线：

- 已从版本化 schema 创建独立空库并执行到 232；Owner、制作账号、生产单均为零。临时 APFS 镜像的挂载、写入、重新挂载和退出通过。运行包构建与 33 项定向用例通过。
- T12 `unassigned` 已实际登录、新建生产单、准备本地合成素材并打开嵌入式 OpenChatCut。当前浏览器驱动未能操作 iframe 内的水平位置控件，完整 T12 未通过；未验证从控制台完成导出和交付。未重测 `series`。
- 独立 SDK 集成跑通编辑、保存重开、冻结和实际 MP4 渲染；`ffprobe` 校验了画幅和音轨。运行时向 SDK 明确提供了本地 Chrome（避免首次渲染另行下载浏览器）。这不是控制台整链验收。
- `npm run check` 在未修改的公开基线也出现 `templateSettings.integration.test.ts` 的 Vite source map 类型错误，不计作通过项。

SDK 集成可单独复核。在上面的两个目录都完成依赖准备后，从 Loop Control 的隔离目录运行：

```zsh
OPENCHATCUT_ROOT="$check_root/OpenChatCut" \
CC_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
npm run test:openchatcut-integration -- -t 'opens, edits, freezes, and renders one real Episode'
```

## 日常安装还缺什么

1. 发布专用新机初始化命令：新建并绑定 PostgreSQL 空库、媒体根与专用 Keychain；登记首次发布回执，而不是让操作者手写恢复回执。
2. 提供一次性的首位 Owner 初始化入口及本地身份验证；日常启动和测试夹具不得代替初始化。
3. 用未配置过的新 Mac 用户环境验证正常 `npm start`、首次 Owner、创建制作账号、手工上传本地脚本/素材、编辑并导出 MP4、重启后复查。通过后再写日常操作步骤。

已有日常部署请看[日常运行说明](local-daily-runtime.md)。本轮不涉及旧数据迁移、策稿联通、第三方付费生成、Windows 或发布视频。
