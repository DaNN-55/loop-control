# T07 字幕与原生增量接入契约

## 权威与身份

OpenChatCut document 是正文、cue、布局的唯一编辑权威。`workspace.captions` 是由当前不可变工程、当前音轨和证据表派生的只读投影，不是一套独立时间线。

- 片段使用 T02 的 `clip.id` / `clip.itemId`；字幕 lane 为 `workspace-caption-${clip.itemId}`。
- **原生迁移会重命名 track ID。** 每次修改都从 live document 根据稳定 lane ID 查找其实际 track；新 lane 可复用已有 LC lane 所属轨。不得以 `workspace-captions`、`V1`、旧数组下标断言迁移后的实际 track。T08/T10 的候选替换也须先解析实际稳定目标身份。
- 仅目标 lane、其 slot/perSource 项被更新；其他 lanes、共享 auto-stack 策略、图像、变换、keyframes、音轨、其他 timelines 保留。不能直接传一个 `sourceEntries` 给原生浅合并 `updateCaptions` 丢弃其他 lanes。
- lane `loopControl` 保存 runtime 未支持的内容模式/排版约束；实际 cue 读取 `words`，实际 anchor 读取 lane/slot。原生 JSON 键序改变不会被当作契约损坏。

## 时间与字数适配

Owner cue 的 `startMs/endMs` 相对当前片段；原生 manual lane words 是**绝对 timeline 毫秒**。`applyWorkspaceCaptionEdit` 显式加上当前 item.startFrame/fps 的时间偏移。

安装版原生 generated captions 固定每行24字，`maxCharactersPerLine` 不被消费。本适配器按 `maxCharactersPerLine × maxLines` 将 cue 分成 timed manual pages，写入明确 `\n`，并计算适合安全区的字号；原生 preview 与 Remotion 使用同一数据；安全区preset始终按当前native canvas纵横比派生。分页只在原 cue 的时间范围内分配时间，不省略正文。行数为1～2，每行1～24字。保存后读回可编辑的实际分页 cue。

T08 移动/替换片段时必须显式平移目标 manual words，不能仅移动视频 item 后认为字幕会跟随。任何正文、实际已用音轨、源区间/播放速度或目标时间窗口变化，都要重核当前证据。单纯选择、其他片段和背景音乐变化不影响此目标输入指纹。

## Owner HTTP

所有命令沿现有 `/api/local/episode-commands`，保留 Owner/session、Origin/CSRF、幂等回执、Episode/文件边界，并先调用 `lockProductionWorkspace`。共同字段：`episodeId,workspaceId,expectedRevision,clipId`。

| 命令 | 额外字段 | 作用 |
| --- | --- | --- |
| `saveWorkspaceCaptions` | `captionContract,nativeApplied?` | 闭态精确更新原生 lane；活跃 Studio 要求已由 bridge 保存的实际 lane 与契约相同 |
| `requestWorkspaceCaptionAlignment` | `localOnly?` | 通过现有 `public.request_shot_acoustic_alignment` 排队；提交后沿现有 Worker 唤醒边界 |
| `applyWorkspaceCaptionAlignment` | `taskId,expectedInputFingerprint` | 保存并返回后显式采用当前已完成对齐；同时核任务、正文、音轨、证据文件和当前目标输入身份 |
| `confirmWorkspaceCaptionText` | `expectedInputFingerprint` | 对当前正文/音轨/cue 的明确核对；有音轨时复用已有 `confirm_caption_text` |

独立无音轨字幕支持手工 cue 和正文核对。跟随口播必须等于当前口播正文；缺少当前口播音轨时不能完成跟随字幕正文核对。字幕关闭保留原 cue，仅关闭目标 lane。

`local_identity.save_workspace_caption_input` 只同步本期现有 draft 的字幕输入，保留音轨、声音、片段和其他参数；缺 draft 时建立无主声音的字幕 draft。不会伪造逐镜审批。原有 alignment/manual SQL 路径及任务 fence 保持。

迁移 `089-workspace-captions.sql` 的 evidence 表只保存输入/渲染词流指纹、任务及核对证据。读取时与当前 native lane、正文、native采用音轨身份/文件hash/编辑范围及片段窗口比较；过期证据不会因为旧 Worker 回调变成有效。Worker 不直接写 workspace document。

T05 的 native narration 以 `workspace-narration-${clip.id}`、`sourceAssetId=audio-track-${track.id}` 识别；存在真实采用项时优先于 draft.current_audio_track_id。注册音轨/任务素材的 validator resolver 由 T05 合入，本票不修改或假定其已部署。

## 宿主 bridge：T08/T10 接入点

原有 `channel/projectId/requestId`、精确 parent origin/source 检查保留。

1. `action:'inspect'` 返回 `result:{revision,documentFingerprint,document}`。SHA-256 对当前完整 native document 的 JSON 计算，revision 是会话内观察序号，均不充当持久业务 revision。
2. `action:'apply-captions',itemId,contract,expectedRevision,expectedDocumentFingerprint`。读取 live doc，检查观察序号、SHA 与 await digest 前后的 live doc 引用/序号；校验字幕契约后从 live doc clone 精确修改目标 lane，并调用原生 `commands.applyDoc(next)`。
3. 等 React 更新后等待真实 `flushBeforeLeaveRef`。成功返回最新文档，失败保留编辑器与错误。**applyDoc 不是 CAS；预检查不能替代原生持久化 ownership CAS。**
4. `EmbeddedStudioBridge.applyCaptions` 再经既有 `onSave` → `saveWorkspaceStudio` → 原生 snapshot/文件hash/SQL CAS；之后 `saveWorkspaceCaptions(nativeApplied:true)` 才记录 provenance。任一步失败不宣称完成。

T08 可沿此 inspect、expected revision/hash、live文档检查、原生 flush、宿主持久CAS增量扩展 item 编辑。此票未提供任意全工程替换 RPC、原生 ownership capability 或绕过媒体注册的写入口。bridge 检查冲突后拒绝，不能用 `applyDoc`/`batch` 名称推断事务回滚。

## 验收与复现

真实 HTTP/DB/Worker/渲染：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
./node_modules/.bin/vitest run src/local-app/workspaceCaptions.integration.test.ts
```

真实 UI（必须在当前工作树 cwd）：

```sh
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
node --import /Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut/node_modules/tsx/dist/loader.mjs \
docs/verification/issue-159-workspace-captions/serve.ts
```

driver 输出随机 localhost origin、测试 Owner、确切 PID/DB/媒体根，并写 `/private/tmp/t07-caption-ui.json`。登录 → 进入本票生产单 →「保存并进入剪辑」→ 宿主「字幕」→ 改每行字数并保存。经 bridge inspect 或 Owner workspace GET 核对始终只有一个目标 lane。验收后先「返回生产单」，再仅向输出的 node PID 发 SIGTERM，driver替换本专用Vite进程的提前退出handler并等待自己的DB／媒体清理后退出；不要对整个 PTY 发 Ctrl-C（tsx CLI wrapper 会先终止其 Docker streams）。不运行 `scripts/start.mjs` 或日常 migrate。
