# T05 验证记录

分支 `codex/t05-workspace-narration-152`，基于 `3fb5055d`。只使用随机 `loop_studio_153_<random>` 数据库、临时媒体根/HTTP/Studio 端口及真正 `loop_worker` 连接；日常数据库仅 schema-only 读取，无日常 DML/DDL、Keychain 或真实付费请求。

TDD 首次红灯：Owner HTTP 对 `saveWorkspaceNarration` 返回 400（命令尚不存在）；实现后该场景通过。真实 Worker 链路的 fixture 曾因未启用生产范围、缺少隔离调度容量、受控模块转义错误失败，分别按持久诊断修正后通过；没有放宽业务权限来迁就 fixture。

已执行并读取：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
./node_modules/.bin/vitest run \
 src/local-app/workspaceNarration.integration.test.ts \
 src/local-app/productionWorkspace.integration.test.ts \
 src/local-app/ProductionWorkspacePanel.test.tsx
```

该轮结果：3 文件、8 测试通过；含真实 Owner HTTP → PostgreSQL → claim/lease → `runCodexWorker` → `executeNativeNarration` → Provider 受控响应 → staging 验证及发布 → artifacts/audio_tracks 登记 → HTTP/Worker 重启恢复 → 真 OpenChatCut Studio 打开读取。

受控样本为共享目录的 2.4 秒 MP3 tone；实际 ffprobe 时长 2.4 秒，进入原生音轨 72 帧并驱动画面与后续镜头排布。tone 只证明真实音频 transport、时长和来源身份，不证明语音合成或口播听感。

覆盖：未确认/未授权禁止执行；重复生成返回同任务；两镜真实 Worker 结果首次组装；已匹配可用视频裁切到主声音实际时长；匹配另镜不使已付费口播过期；未知提交跨重启与换输入阻止重发；明确拒绝后显式重试新任务；运行中改稿后迟到文件只登记历史、正文/工程与 deliverable=false 保持。

准备页提供本期默认、逐镜覆盖、人工/关闭选择、准备/重试、原文件试听及首次安全恢复轮询。待本票合并最新 integration 与浏览器验收后追加最终结果。

## 最终验证

已依次合入 T04 `a96e4d0`、T07 `20991dfb` 与包含 T03 的最新 integration `92d0ef27`；共享冲突保留全部 dispatcher/UI、native edit counter、captions 只读投影、统一 source resolver 和 fresh fixture 默认迁移 084/086/087/089。没有修改 PLAN 内容；其变化仅来自 integration 的已有提交。

最终针对性回归 **12 个文件、45 个测试通过**，包括 T05 全部 12 个真实场景，以及 T02/T03/T04/T07 的 HTTP/PG/Worker/Studio/原生渲染与 UI 边界。`npm run build`、`npm run backend:build`、`npm run worker:build` 均通过。完整回归和构建输出保存于 evidence。

新增交叉与恢复场景：

- 实际 2.4 秒主声无需预先人工采用，即驱动现有 Seedance 4 秒受控请求，原生画面只使用 72 帧；冻结音频 provenance，改正文后回填拒绝。
- 真 OpenChatCut 渲染输出有声 MP4：180×320、4.458667 秒（包含第二镜占位）、无黑帧；2.4 秒/72 帧为第一镜原生使用窗口，4 秒是 Provider 请求窗口。`evidence/render-observation.json` 与 MP4 是实际产物。
- 真原生保存后的首次迟到声音只保留候选，不覆盖已修改 transform。
- 16 秒完整主声超过 Provider 15 秒上限，视频提交阻塞且没有 video request。
- 已运行 legacy 任务通过真实旧 Owner RPC 安排，启用新 workspace 后迟到 Worker 可登记历史文件，但工程 SHA 和 Episode stage 不提升。此场景不声称旧 HTTP 挂载 preflight 通过；该旧入口在普通临时目录下按原规则阻塞，没有放宽挂载检查。
- 同 shot 两个 visual range 只一条 canonical 主声；删首 range 后正文、原 task/track/item 身份保留，剩余 range 仍可找到同一实际主声；重复生成复用原任务，Provider 日志保持一次。范围长度不符显示明确待调整状态。

浏览器通过 agent-browser 专用 session 在全新临时应用操作：合成 Owner 登录 → 普通准备页 → 生成口播 → 实际 Worker → 首次自动组装 → 真实 audio 播放（duration=2.4,error=null）→ 选择注册图片/AI 视频 → **提交前可见“使用 2.40 秒 · 生成 4 秒”** → 显式提交视频 → 实际受控视频 Worker → “填入首次结果”。检查 1280 与 800 宽度，截图已保存。UI fixture 与浏览器均已结束；测试的临时数据库和媒体根由各自 finally 清理。

`evidence/preparation-800.png` 展示结果回填后仍只有一条主声音轨、紧凑生成/使用窗口和可播放原文件。此前发现的成功结果 `retry.reason` 被误作错误提示已修正，提交期间输入禁用，镜头声音标签保持单行。

## root UI 重验

```sh
LOOP_T05_UI=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
./node_modules/.bin/vitest run src/local-app/workspaceNarration.ui.integration.test.ts
```

该显式 fixture 创建随机独立 DB/media、同源本机 Vite 与真正 loop_worker，Provider 只返回固定本地样本；`/private/tmp/t05-ui-fixture.json` 仅含本次合成登录与地址。页面按普通按钮操作；完成后创建 `/private/tmp/t05-ui-done`，fixture 关闭自己的服务并清理自己的资源。默认最多六分钟，不触及日常服务。

多范围整段 caption 稳定 lane/证据/bridge 迁移仍由 T10/T13 接续，见 CONTRACT；本票只完成 canonical 音轨识别、聚合窗口读取与明确临时阻塞，不将该范围外工作当作已验收。全部 Provider 证据为受控 transport/时长/身份验证，tone 不证明真实语音质量。

随后补充第 13 个统一 source resolver 集成场景并单独通过：本期已完成任务注册的 `b_roll_asset` 不创建伪 material 即可读取，未登记 blob 和实际文件 hash 篡改返回 409。该补测是对允许媒体 artifact 类型补齐后的验证，完整 45 项回归没有无理由重复。
