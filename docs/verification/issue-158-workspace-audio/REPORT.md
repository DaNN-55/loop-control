# #158 / T06 验证记录

状态：执行中，最终结果在下文补齐。唯一写树 `/Users/dan/.codex/worktrees/t06-workspace-audio/loop-control`，分支 `codex/t06-workspace-audio-152`。合入基线包含 abf1e9f4、T10 07610e8c 与受控媒体 21a71be1。未改日常数据库、凭据或 Keychain，未触发付费调用或社媒发布。

## TDD 与接收边界

批准 seam 为 Owner 原生 HTTP、隔离 PostgreSQL、真实 loop_worker lease/result、真实 native 工程与实际音频渲染。最初纯 native 路由测试缺模块为 RED；实现后 GREEN。首个 Owner HTTP 人工整期 BGM 用例在命令不存在时返回 400 为 RED；接线后完成采用、gain/ducking、重启恢复与 CSRF 验证。

仅 JSON、排队成功和 iframe 出现均不计完成。受控 Provider 明确使用 synthetic secret/module，不读取或测试 Owner 真实外部连接；所有素材为受控正弦音/纯色画面，仅验证传输、路由、时间、相对增益与闪避。

## 隔离资源与排障记录

每个场景新建 `loop_studio_153_<random>` 数据库，仅 schema-only 读取日常结构；所有后续 DDL/DML/Owner/Worker 池绑定该随机库。原生、Owner/UI 和 Worker DB 转发均随机 loopback 端口；转发只接收该确切随机库和 `loop_worker`，拒绝其他 role/database/startup 选项。

首次真实 CLI source/Freesound 路径被生产 `verifyMediaLibrary` 正确阻塞：普通 tmp 目录不是实际 mountpoint。未放宽此 guard。经 root 明确授权，测试在随机 `/private/tmp/loop-t06-volume-*` 中创建独立 256 MB APFS sparseimage，并仅将其挂载到自身 `mounted` 目录；`embeddedStudioFixture.testRootParent` 把本次账号媒体建在该卷中。finally 先关闭本次 Worker/Owner/Studio、删除本次随机测试库/媒体，再精确 detach 此 mountpoint 并删除自身映像。记录 `isolated-volume-log.txt`；不操作日常卷。

实际 source 提取 CLI→lease/result→`audio_tracks`→native 采用已单例 GREEN。Freesound 的受控 HTTP 503 沿既有 Worker 协议为 `failed`，允许 Owner 显式重试。

两次执行在 runtime:prepare 或测试期间继续修改受跟踪音频源码，被 manifest 完整性保护拒绝。原因是本票执行顺序；没有将其当作业务 GREEN。改为冻结所有 runtime 依赖，先完成前端 build，再 runtime:prepare，随后串行 Worker/渲染，期间只写测试/文档。

OpenChatCut 外层 Vite 使用本次随机端口，内部 renderer 使用原生固定 localhost:3000。与 root/T10 协调串行渲染；没有停止任何他人进程。T10 曾遇 renderer500，缺少同时运行的双进程证据，因此只记为潜在并行干扰，未认定根因。

## 已读取的检查

- `src/workspaceAudio.test.ts`：主声路由、多槽不复制、source/TTS/none、BGM/SFX 独立与未准备 source 阻塞。
- `WorkspaceAudioPanel.test.tsx`、`ProductionWorkspacePanel.test.tsx`、`EmbeddedStudioHost.test.tsx`：显式准备/应用、TTS 原片默认关闭、真实 Host 协议的单元回归。早期合计 12 项通过；新增公共接口用例另通过。
- 前端 build、worker:build、backend:build、runtime:prepare 已成功；生产 bundle 保留现有 >500 kB 提示。

## 最终集成与渲染

待补：完整 HTTP/Worker 结果、各实际 MP4 的独立频谱数值、浏览器交互与最终合并复验。
