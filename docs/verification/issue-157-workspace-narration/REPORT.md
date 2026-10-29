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

当前结果：3 文件、8 测试通过；含真实 Owner HTTP → PostgreSQL → claim/lease → `runCodexWorker` → `executeNativeNarration` → Provider 受控响应 → staging 验证及发布 → artifacts/audio_tracks 登记 → HTTP/Worker 重启恢复 → 真 OpenChatCut Studio 打开读取。

受控样本为共享目录的 2.4 秒 MP3 tone；实际 ffprobe 时长 2.4 秒，进入原生音轨 72 帧并驱动画面与后续镜头排布。tone 只证明真实音频 transport、时长和来源身份，不证明语音合成或口播听感。

覆盖：未确认/未授权禁止执行；重复生成返回同任务；两镜真实 Worker 结果首次组装；已匹配可用视频裁切到主声音实际时长；匹配另镜不使已付费口播过期；未知提交跨重启与换输入阻止重发；明确拒绝后显式重试新任务；运行中改稿后迟到文件只登记历史、正文/工程与 deliverable=false 保持。

准备页提供本期默认、逐镜覆盖、人工/关闭选择、准备/重试、原文件试听及首次安全恢复轮询。待本票合并最新 integration 与浏览器验收后追加最终结果。
