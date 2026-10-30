# 重规划后的口播采用状态修复

日期：2026-10-30。全部回归使用隔离临时数据库、真实 HTTP/Postgres 和受控 Worker；未调用付费在线生成。

## 根因与结果

`workspace_narrations.adopted_audio_track_id` 会保留历史采用轨道。正式重规划重建当前工程，却保留该历史记录。读取时直接把这条历史指针当作当前采用状态，造成工程没有主声但 UI 显示旧音轨已采用，也使首次新音轨自动组装条件无法成立。

- 读取当前采用状态改为检查当前工程真实主声路由及绑定音轨；历史 SQL 决策记录保留。
- 候选列表的 `adopted` 也以当前工程主声为准；旧历史采用候选按当前输入有效性显示 `available` 或 `stale`，拒绝记录仍保留。
- 首次 AI 视频入口复用已有的首次口播安全组装逻辑，先把当前已确认、已完成音轨组装到未人工编辑的初稿，再冻结真实主声窗口；不再出现“UI 按已测音轨显示 2.4/4 秒，队列却没有实际主声”的不一致。
- 已有 native 编辑、锁定范围冲突或已存在其他主声时，不自动覆盖；仍须在 Studio 明确采用候选。

## 验证

- `narration-replan-red.log`：正式新建、口播完成并采用、正式修订主脚本及重规划后，读取旧采用 ID 的断言失败，成功复现根因。
- `narration-replan-green.log`：3/3 通过，包含上述真实重规划恢复以及无旧 approval 的首次视频（含实际主声/无主声）。
- `narration-replan-type.log`：`npm run check` 通过。
- `narration-replan-backend-build.log` 与 `narration-replan-runtime-prepare.log`：后端构建及运行时源码完整性检查通过。
- 既有 narration/native 编辑/候选回归由独立验证 Agent 在最终源码上补跑，结果见最终集成日志。

## 当前验收单只读核对

单据 `529a7070-f80e-4d97-9ac0-80ee2e057ba5` 由主 Agent 通过正式 UI 在 Studio 采用新口播并生成、填入视频，本修复没有代写该业务步骤。恢复后 HTTP 读回见 `narration-restored-current-state.json`：

- 当前主声 `207516cd-e0f6-41dd-ad7f-ab4eac3a9ae3` 为 `adopted`；
- 历史主声 `1ffc1e7e-8a67-4eb4-968b-a7d7fc661e25` 为 `stale`；
- 实际主声窗口 2.4 秒、Provider 请求 4 秒，native 编辑保护仍开启。

## 服务中断与恢复

Inspector 测试脚本的清理实现错误导致 VM dynamic import 异常和进程退出。主 Agent 明确授权同库恢复，新的持久进程 PID1666 使用相同数据库/媒体及最新源码。未删除或重建数据库，未清理媒体，未写入替代业务结果。原因、恢复步骤及后续禁止 Inspector/生命周期操作记录于 `SETUP.md`。

字幕声学校时尚未运行真实 WhisperX；当前 fixture Worker 不处理 `align_shot_captions`。正式手工字幕路径仍可验证，不应把受控协议响应称作真实声学对齐。

## 最终集成补齐（12:02）

- 原 Audio 两个用例在已采用原声/配乐等 native 编辑之后直接调用快捷 `adoptWorkspaceNarration`，与 git HEAD 已有的 native 编辑围栏冲突。本轮保留快捷采用 409 和工程 SHA 不变的断言，改用正式 `prepareWorkspaceCandidate` → `adoptWorkspaceCandidate`，明确 `use-candidate`。
- Candidate 明确采用不自动扩画面。短原声用例通过正式 `editWorkspaceStructure(range)` 扩画面 12 帧为 2.4 秒，再证明旧 2 秒提取源不能作为该窗口环境声：409，工程 SHA 不变。`saveWorkspaceVideoRanges` 作为初始准备接口会正确拒绝已有 native 编辑，因此未用它绕过围栏。
- `workspaceFirstVideo.source.integration.test.ts` 新增真实边界：Worker 提取原声 → 采用 → 真实 native 存储保存新占位并保留主声 → 保存无关未生成 TTS 草稿 → 首次 AI 视频。修前复现 409，修后按实际源主声 2 秒窗口、Provider 4 秒入队；native 编辑版本不变。原声源文件和实际主声绑定保持一致，`narration_target` 不再误冻无关 TTS 草稿。
- 首次口播自动组装明确跳过任何已经存在的实际主声；未放宽 native guard。
- 实际主声超过 Provider 最大值仍在付费提交前拒绝，并恢复明确“上限 15 秒”提示；不会裁词或变速。
- 证据：`first-video-source-red.log` / `first-video-source-green.log`（新增回归红→绿），`source-voice-short-source-green.log`（旧短源用例通过），`source-voice-focused-attempt.log`（另外两条旧失败已通过；该次尝试还保留了后续纠正的新测试快照结构/短源前提失败），`source-voice-type.log` / `source-voice-runtime-prepare.log`（通过）。最终全组由独立验证 Agent 在最终源码上重跑。
- 本段完成期间未重启或热换当前 E2E 服务，未操作验收单业务数据；当前在线进程继续保留，最终新增源主声边界在独立真实 HTTP/PG 测试中验证。

### 首次视频的口播就绪前提补齐

稳定产物重跑发现原 `actual narration drives the paid video window...` 两个分支在 TTS 尚未生成时应返回 409，本轮 source 路由修复遗漏了这个无主声前提，实际错误返回 200。最终仅补 `workspaceImages.ts` 条件：当前工程没有实际主声，且计划为 TTS/manual 时，仍须先通过当前真实口播音轨就绪检查；当前工程已有实际 source 主声时，继续以该源主声窗口为准，不受无关 TTS 草稿阻断。未修改 native 编辑围栏。

`planned-voice-ready-type.log`、`planned-voice-ready-backend.log`、`planned-voice-ready-runtime.log` 均通过；最终受影响 17 项由独立验证 Agent 跑 Narration13、FirstVideo3、FirstVideo.source1，不重复无新风险的其他已绿组。

最终结果：`planned-voice-final-17-green.log`，3 文件 17/17 通过（61.66 秒）。包含两个 notReady 前置分支、真实 TTS 窗口冻结、source 主声忽略无关 TTS 草稿、超限拒绝、native 编辑保护与重规划采用真值。结果由独立验证 Agent 执行，本 Agent 读取日志确认。之后未再修改生产源码。
