# 主脚本格式修正及原界面重跑：视觉入口失败

## 已完成的授权内容

Owner 明确确认三段正文与色板，并随后要求「将你的txt调整为系统要求的格式然后重新跑一下」。已执行：

1. 原 TXT 缺少系统要求的 H1 标题和 `## 正文`，正常导入校验拒绝。失败截图 `input-format-rejected.png` 保留。
2. 新建 `main-script.md`，仅增加标题/正文结构。三段正文提取后与批准的原文逐字相同，见 `input-format-fix.json`；原 TXT 保留，校验未弱化。
3. 原界面选择修正后的主脚本和相同色板，按已有批准确认并导入。两份材料大小/SHA 均匹配，见 `inputs-imported.json`。实际路径为本次 Episode 自身的 `materials/...-script.md`、`...-actor.png`，没有借用旧成片。
4. 点击正常入口「材料准备完成，开始制作」，本地状态由 `waiting_input` 推进至 `visual_draft`。视觉任务 `c4355dd9-c71d-4a1d-9a95-2d54bb228db0` 创建于上海 13:28:57.119。

## 实际失败与次数

| 本地尝试 | task_run ID | 开始 / 结束（上海） | 耗时 | 结果 |
| --- | --- | --- | --- | --- |
| attempt 0 | `6ad86e39-7a3c-4389-a678-b14197b177c0` | 13:28:57.145855 → 13:28:57.349539 | 203.684 ms | failed，视觉执行器未返回有效结果；系统报告 shouldRetry=true |
| attempt 1 | `e8c2c293-f7aa-49a7-a5b4-ceeca69ed45e` | 13:28:58.400203 → 13:28:58.540161 | 139.958 ms | failed，shouldRetry=false，任务终止 |

这是系统默认产生的 1 次本地自动重试，不符合本次不自动重试的约束；不是 Agent 手工再次提交，也不能抹去。当前任务 `attempt=2/max_attempts=2`，无产物、无审核包/审批。详见 `visual-started.json`、`visual-failure-final.json`、`visual-task-failed.png`。

**本次重跑没有进入 Codex CLI 调用：实际模型调用仍为 0/2。** Provider 账本仍 2/11，仅为前一阶段两家资格验证，预留 ¥0.01，实际账单未知。没有进一步素材/TTS 请求。

## 根因与本次证据

- `scripts/runtime/codex.mjs` 入口只接受 `visual_asset_preparation`、`storyboard_planning`。实际 WorkerTaskPackage 能力为 `visual_planning`。入口条件因此在 spawn Codex 之前抛出 `Unsupported planning package`；此路径不会读取模型结果或发模型请求。
- 已用当前脚本做离线最小复现，确实 exit 1，原始 stderr 在 `codex-capability-red.log`。真实队列输入能力与执行器记录在 `visual-started.json`，不是用另一个能力名推断。
- 当前 `public.orchestrate_provided_script_tasks_for_episode(uuid)` 把 `max_attempts` 和冻结预算的 max_attempts 均写为 2；`freeze_shared_planning_harness()` 只冻结 Harness/executor/model，没有冻结所选规划配置的尝试上限。现有蓝图配置 1 没有生效。保留了当前实际函数与失败任务快照。
- 只读检查当前 Codex CLI help 确认脚本所用的 `--sandbox`、`--ephemeral`、`--output-schema` 等选项存在；没有运行新的真实模型探测。

## 待授权的最小修复（未应用）

1. 日常 `scripts/runtime/codex.mjs` 将错误能力名改为实际契约 `visual_planning`。可审阅补丁：`proposed-codex-capability.patch`。
2. 增加前向迁移 `048-native-planning-attempt-limits.sql`，仅在未来本地托管视觉/分镜任务 INSERT 时，把所选规划配置 max_attempts 同时冻结到任务列及 snapshot。当前配置 1 生效后，异常不会自动再跑。SQL 草案：`proposed-native-planning-attempt-limits.sql`。不修改旧迁移、不覆盖失败任务、不更改旧尝试和预算账本。
3. 针对实际入口增加离线回归；在当前日常专用数据库用回滚事务验证新任务上限与历史不变。正常 runtime:migrate 在变更前创建备份；正常 stop/start 后核对当前构建和数据库。
4. 由于原界面没有此类失败规划任务的正常重试命令，不手工把失败任务改 ready/completed。保留当前失败单，另从原界面新建接续生产单，沿用 Owner 已批准的相同正文/色板字节与同一授权剩余额度；它是新的完整执行，不把原失败单改记为成功。视觉/分镜/QC 仍按实际内容逐次等 Owner。

已对能力名补丁的**临时候选副本**完成离线测试：真实 CLI 被本次自建 stub 替代，候选能接受 visual_planning 并只调用 stub 1 次。`offline-capability-proposal-test.json` 明确 realModelCalls=0；它只证明入口改名方向，不是实际模型、Worker、产物或 SQL 修复通过。生产源文件与数据库均未应用上述补丁。

当前主程序与失败生产单保持可打开；历史账号接入仍按 Owner 要求放在新视频完成后。没有提交、推送、合并或清理。
