# A 阶段修复后的本地手动检查

当前服务已运行，独立 Chrome 已登录合成 Owner。地址：<http://127.0.0.1:55173>。生产地址 5173 不属于这次验收。

## 1. 确认目录和运行身份

在终端运行：

```sh
cd /Users/dan/.codex/worktrees/local-first-optimization/loop-control
git branch --show-current
npm run isolated:status
lsof -nP -iTCP:55173 -iTCP:55431 -iTCP:55432 -sTCP:LISTEN
```

预期分支 `codex/local-first-stage-a`，status 的 running 为 true，三个监听地址均为 `127.0.0.1`。55173 是控制台、55431 是本地 API、55432 是本地数据库。不要更改这些配置以连接生产。Codex 受限工具环境可能无法读 ps 而误报 running false；正常 macOS 终端检查应与 lsof/页面一并判断。

若新浏览器要求登录，账号 `stage-a@example.test`；密码仅存在本机 `.loop-control/stage-a/state/owner.json`，用本地编辑器查看，不要发送或写入报告。当前已打开的 Chrome 无需重新登录。

## 2. 在页面检查真实读取和任务结果

1. 进入左侧“生产单”，账号选择“A阶段隔离测试”。当前有 10 条测试记录，重复名称由独立复跑产生，早期失败保留。
2. 打开最新 `Stage A fixed 3-shot`，短 ID `13029a1c`，时间 2026-10-23 17:58。
3. 点击“刷新生产单状态”。预期详情能正常加载，当前任务“已完成”，最近 Worker 已完成；当前阶段仍是“等待输入”。
4. 点击“查看产物索引”。预期 3 条 `a_roll_video`，路径分别以 `shot-0.mp4`、`shot-1.mp4`、`shot-2.mp4` 结尾。
5. 关闭产物索引，再点击“查看执行与审计时间线”。当前实测显示“暂无状态变化”：样本直接准备了测试数据，没有走状态流转/审批链。任务执行应以详情“当前任务：已完成”、产物索引和原始 baseline 中的 task_run 为准，不能把空时间线当作任务未执行。
6. 关闭详情，打开最新 `Stage A fixed 1-shot`，短 ID `4d8120a8`。预期 1 条 a_roll_video，Worker 已完成。
7. 刷新整个浏览器页面，确认仍能读取这两个样本和产物。

不要用“等待输入”、无待审包或 OpenChatCut 主按钮禁用来判断这轮真实渲染失败：基线直接调用渲染模块，没有把模块产物注册成完整 DB 审核渲染工作流。系统状态“需处理”也不代表全流程已配置：隔离环境未启 n8n、未配置在线模型。页面验收只覆盖读取和已完成的 FFmpeg 任务。

## 3. 播放真实渲染文件

在 Finder 中按 Cmd+Shift+G，分别粘贴下面两个目录，再用 QuickTime 打开 `review.mp4`：

```text
/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-a/media/smoke/episodes/4d8120a8-9e51-4ff5-91ee-b8cd36144dd6/review-render/v1
/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-a/media/smoke/episodes/13029a1c-8dff-49eb-a2d4-e04e36126f6d/review-render/v1
```

预期为竖屏 360×640；单镜头约 2.05 秒，三镜头约 6.06 秒，三镜头按蓝→绿→红变化，带声音。目录还有工程/运行时/QC 文件。上一级 Episode 目录中的 `publish-package/manifest.json`、`cover.jpg`、`metadata.json` 是测试发布包产物；不是已批准或已发布内容。

## 4. 复跑隔离单元和 HTTP 冒烟

```sh
npm run test:isolation
npm run isolated:smoke
```

预期 30 项通过；smoke 输出 `httpRead.status: 200`、`unauthenticatedStatus: 400`、匿名 Episode 可见数 0（本轮 anonymousError 为 42501）。smoke 会幂等准备独立测试 fixture，不执行在线模型。结果保存到 `.loop-control/stage-a/state/smoke.json`。

修复前的失败结果、修复后的30项测试及真实 CLI 故障注入证据见 [修复报告](README.md)。

## 5. 可选：完整重复真实固定样本

先确认测试媒体卷仍挂载、专用服务仍在运行，然后顺序执行：

```sh
npm run isolated:baseline
node scripts/isolation/package.mjs
```

预期新增两条独立 UUID 的生产单，共 4 个真实 FFmpeg 任务和两份真实 OpenChatCut 视频；第二条命令验证两份真实文件包、篡改拒绝及恢复成功。它们只使用固定合成媒体和本地执行器，不调用在线模型。运行期间本地 CPU/内存会升高。

查看 `.loop-control/stage-a/state/baseline.json` 和 `packages.json`；后者每份样本的 `corruptionRejected`、`restoredAndVerified` 应为 true。重新打开生产单列表，以新 UUID 识别这次样本。最新状态 JSON 会被覆盖，版本化 `docs/verification/stage-a/review/` 证据不会被覆盖。不能用两次小样本说明吞吐容量或 p95。

不要派发 `Stage A synthetic smoke Episode` 的占位任务。本轮复跑范围是固定合成媒体、本地 FFmpeg/渲染和文件包，不需要配置在线 Codex/发布连接或执行完整审批。

## 6. 可选：启停验收

```sh
node scripts/isolation/lifecycle.mjs
```

它会暂时关闭并重启 55173，测试错误 PID 跳过；页面短暂断开后刷新即可。预期 `consoleStops`、`consoleRestarts`、`foreignPidSkipped` 均 true，productionPidsBefore/After 一致。错误 PID 是本轮自己的哨兵，不会拿生产进程做故障注入。

## 7. 检查完成后按顺序停止

服务目前为你保留运行。检查完成后可执行：

```sh
npm run isolated:stop
npm run isolated:database -- stop
colima -p loop-stage-a stop
```

推荐依上述顺序正常停止。本轮已修复异常清理：即使 inspect 失败，仍清理身份匹配的专用隧道，并如实报告数据库检查失败。不要使用项目原始 stop-all 或 pkill。停止后 55173/55431/55432 应无监听，生产 5173/5678 应仍工作。

以后重启同一环境：

```sh
colima -p loop-stage-a start --activate=false --ssh-config=false --port-forwarder none
npm run isolated:database -- start
npm run isolated:start
```

若媒体卷已卸载，在启动前仅重新挂载本次镜像：

```sh
hdiutil attach .loop-control/stage-a/media.sparseimage -mountpoint "$PWD/.loop-control/stage-a/media" -nobrowse
```

当前镜像已挂载，无需重复 attach。不要运行 init/prepare 覆盖已有环境。

## 验收如何判定

两名子Agent再次复审后，T01/T02验收满足，T03文档交付满足；见 [修复报告](README.md)。Owner已于2026-10-23确认A阶段通过并批准ADR为Accepted，授权提交A相关改动；仍未授权合并。
