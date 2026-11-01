# 新账号至导出交付 E2E 验收

2026-11-01，正式本机服务 `http://127.0.0.1:5174/`。主流程完成，最终阶段为 `production_completed`，刷新后仍显示「已交付」。此次覆盖本地素材路径，保留全部生产数据；未调用付费生成。仍有手动口播登记、第二镜头字幕采用提示及应用内浏览器视频预览问题，不能记为全绿。

## 保留的生产数据

- 账号：`流程验收1101`，`e2e-settings-1101`。
- 系列：`双镜头流程验收`，规则 v1。
- [生产单](http://127.0.0.1:5174/?episode=2f7553cb-c3e9-4dc5-b900-f1439329a0b0)：`账号系列参考图预算返回 · 完整E2E`。
- 生产目录：`/Volumes/Ebuget 1T/Media/流程验收1101--2fb0abe3-a125-429c-97b9-3330929c5c6b/双镜头流程验收--613ba518-9bf6-498e-904a-b612091c56ee/账号系列参考图预算返回 · 完整E2E--2f7553cb-c3e9-4dc5-b900-f1439329a0b0`。
- 保留 9 份素材登记、13 个工程版本、5 个已完成 Worker 任务，以及生产目录中 58 个文件，共 8,163,031 字节。
- 成片：[`downloads/final.mp4`](downloads/final.mp4)，4,227,245 字节，SHA-256 `c384cee57060e5bac02a7c51b85348c2ebc62f9e780ef82a5ddcac4b8068fb71`。
- 原生工程：[`downloads/project.json`](downloads/project.json)。交付清单：[`downloads/manifest.json`](downloads/manifest.json)。

## 重点检查

| 范围 | 实际操作与结果 | 证据 |
| --- | --- | --- |
| 账号规则与预算 | UI 新建账号，统一保存定位、语气、视觉、约束与预算；刷新后值一致。试片上限最初 ¥1.50、总额 ¥5.00；无效总额 ¥0.50 被拒绝，规则及预算草稿均保留，共同撤销恢复。 | `account-settings.png`、`settings-readback.json`、操作日志 |
| 系列设置 | UI 创建系列并填写 7 项规则；生产单绑定正确版本。5 个实际 Worker 任务包均冻结同一账号蓝图、系列版本和规则。预算单独存储，未进入创作策略。 | `completed-workspace-evidence.json`、`final-assertions.json` |
| 参考图 | 上传 2 张本地参考图，另选已登记静帧；选择、移除、重新加入、刷新及预算往返后 3 张选择与提示词草稿保留。 | `references-picker.png`、`budget-return-shot02.png` |
| 调整预算与返回镜头 | 在第二镜头跳至正确账号，调整预算后返回第二镜头；原生编辑并保存后再次跳转，返回仍是第二镜头，3 张参考图草稿保留，没有残留 iframe。最终试片 ¥2.25、账号总额 ¥8.50。 | `budget-return-after-native-edit.png`、`settings-readback.json` |
| 素材与声音 | 导入并显式采用两段 6 秒视频；通过实际 Worker 提取、试听入口和显式采用两段视频原声。 | 两项 `extract_embedded_audio` 完成记录 |
| 字幕 | 两项实际本地 WhisperX 对齐完成，均保留原始置信度证据。第一镜头对齐采用成功；第二镜头出现采用保存提示，退出保存后真实时间进入原生工程，最终按有效手工时序记录，未伪记为成功采用。 | `captions-adopted.png`、`completed-workspace-evidence.json` |
| 导出与交付 | 实际原生渲染，5/5 检查通过；人工抽查 0.6、6.6、10 秒代表帧后确认成片与字幕，上传封面、填写资料并完成真实交付 Worker。刷新后保留「生产完成 · 交付包已验证」。 | `delivery-persisted.png`、`export-checks.json`、`final-ffprobe.json` |
| 隔离与清理 | 原有 3 个账号完整行指纹不变，13 个连接、19 个凭据版本保留；活动任务 0。本轮测试页 2、4 已关闭，用户原页 1 保留，关闭前 iframe 为 0。 | `final-assertions.json`、`browser-cleanup.json` |

参考图选择和提示词属于浏览器会话草稿；上传文件已持久化。本轮没有提交 AI 图片或视频生成，因此未验证参考图进入真实供应商请求、跨新浏览器会话恢复或付费扣费。

## 成片与交付文件

成片视频为 1080×1920、30 fps、360 帧、12.000 秒，H.264 High；含 AAC 48 kHz 音频。容器时长 12.053333 秒，黑帧检查为 0。已实际解码两镜头及后段代表帧，画面与字幕顺序符合脚本；彩条白色区域上的白字对比度偏低，未计为视觉无问题。

封面、元数据、检查证据、可编辑工程和交付清单，均从已登录浏览器真实 HTTP 200 响应保存原始字节并逐项核对 SHA。MP4 的 HTTP 200 已观察到，但应用内浏览器媒体文档加载受阻，无法取得响应正文；证据目录中的 MP4 是从不可变导出文件复制，并与清单 SHA 核对，不能称为已完成浏览器视频下载验收。

六项文件的大小、期望 SHA、实际 SHA、来源见 `file-verification.json`。交付 Worker 与刷新后的服务端读回均通过包验证；未以单纯任务排队成功代替交付成功。

## 本轮发现与修复

### 已修复：匹配后缺少通用素材导入入口

进入素材匹配后，「本期素材」只列清单，没有通用导入入口。现复用原有上传流程，在展开清单后显示用途选择和导入按钮；真实页面已导入 `voice-01.mp3` 并出现在素材清单。没有自动采用或绕过音轨校验。

改动：`src/local-app/ProductionWorkspacePanel.tsx` 与对应测试。32 项相关组件回归通过。新增测试只证明素材导入入口可达与登记成功，不能证明人工口播已经可用。

### 已修复：真实对齐结果被原生编辑器拒绝

真实 WhisperX cue 带有 `confidence`，`prepareWorkspaceCaptionAlignment` 原样转发。原生编辑器使用规范化格式的严格校验，因此返回「字幕增量输入无效。」。

现先验证原始时间，再规范化转交的字幕契约；不放宽编辑器校验，原始 task 和证据文件的置信度仍保留。真实 HTTP／Worker 集成回归先失败后通过；更新本机服务并重新登录后，第一镜头实际采用显示「时序有效」。

改动：`src/local-app/workspaceCaptionsCommands.ts` 与 `workspaceCaptions.integration.test.ts`。

### 未通过：人工口播素材尚未自动成为可选音轨

通用素材导入成功后，新的工作台没有将口播素材登记为 `audio_tracks`，人工口播「已登记音轨」仍不能选用该 MP3。旧登记流程依赖旧分镜审批边界。本轮没有通过 SQL 伪造音轨或审批，而是使用已有的本地视频原声路径完成主流程。此路径需要后续接通。

复现：素材匹配 → 本期素材 → 用途选口播、上传 MP3 → 口播 → 人工口播 → 已登记音轨。上传素材与可用音轨不一致。

### 未通过：第二镜头采用对齐时出现保存提示

第一镜头成功后，切至第二镜头并采用，实际时间已显示在原生字幕轨，但提交采用记录返回 HTTP 409：「对齐结果尚未保存到当前编辑器。」退出保存后，工程内两段时间与原始 WhisperX 结果一致，第二镜头证据为 `manual`；最终导出依照有效时序通过，并在成片确认时确认正文。

保存回执与实际工程内容的一致性需要继续排查，根因尚未确认。记录在操作步骤 65–67 和网络日志，未把这项记为自动对齐采用通过。

### 未通过：应用内浏览器直接打开 MP4 无法播放

最终视频链接返回 HTTP 200，但浏览器媒体页显示「无法播放媒体」。原文件 SHA、大小、FFprobe、实际解码和导出检查通过；尚不能据此判断是应用路由、浏览器媒体能力还是媒体拦截问题。见 `video-browser-load.txt`。未将浏览器播放或 MP4 下载记为通过。

另观察到一次编辑写连接变更提示，重新打开后恢复，工程未丢失。前后 `document.visibilityState` 都为 `visible`，不能归因于后台节流。截图 `editor-connection-changed.png` 保留。

## 验证命令与结果

- `npx vitest run src/local-app/ProductionWorkspacePanel.test.tsx src/local-app/WorkspaceNarrationPanel.test.tsx`：32 项通过，见 `manual-import-green-final.log`。
- `LOOP_WORKSPACE_ACCEPTANCE=1 npx vitest run src/local-app/workspaceCaptions.integration.test.ts`：3 项真实隔离 HTTP／DB 集成通过，含实际横竖屏 Remotion 字幕像素检查，见 `caption-integration-final.log`。
- 字幕置信度回归先红后绿：`caption-confidence-red.log`、`caption-confidence-green.log`。
- `npm run check`：通过，见 `check-final.log`。
- 正常 `npm stop`／`npm start` 完成运行时准备与更新，登录会话失效后由用户重新登录；工程和既有任务未重建。
- 实际正式生产单：2 项原声提取、2 项 WhisperX、1 项交付，共 5 项 Worker 全部完成、实际费用 0 分；原生导出由真实同步渲染执行，不是模拟结果。

## 日志与保留边界

- `browser-steps.jsonl`：77 个操作／观察记录，主体为完整可访问性快照，个别收尾记录为差异；覆盖账号建立至完成后刷新。
- `network.jsonl`：4,484 条请求、响应和加载失败元数据；只保留路径、查询键、命令、字段名、状态等，排除认证头、Cookie、正文、密钥和 base64。文件阶段导航后 CDP 缓冲重置，单独保留 `browser-downloads.json` 和 `file-verification.json`，不声称所有导航网络事件连续无缺口。
- `app-runtime-sanitized.log`、服务更新日志、回归测试日志：保留执行输出与失败记录。既有同步渲染成功时不持久化子进程 stdout，本轮保留渲染检查、文件身份与解码帧；不补造原始 stdout。
- `completed-workspace-evidence.json`：完整任务、尝试、工作区、导出、交付和字幕证据；15 处 token 字段已脱敏。`production-files.json` 记录生产目录全部文件的 SHA。
- 私有原始快照、输入文件及审计工具：`.loop-control/maintenance/account-series-delivery-e2e-20261101/`。测试数据不删除、不归档到旧生产目录。
- 本轮没有提交、推送、外部发布或改变供应商连接。旧生产归档保留。

辅助审计中的一次「规则快照不一致」源于脚本错误读取 `task_runs.prompt_context`，已按实际 `task_runs.task_package.prompt_context` 更正；5 个任务包版本均一致。独立包验证辅助调用因未传存储适配器、随后 Keychain 访问不可用而未完成，未绕过存储边界；最终包结论来自真实 Worker、正式服务读回及六项文件 SHA。
