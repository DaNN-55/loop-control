# 第一批：停用内容与执行依赖独立审查

审查范围：48 类中的 6—9、20—23、26—29、31—37、38（关联影响），源码由主 Agent 实施；本审查未修改业务代码。

## 已确认

- `workspaceExecutionProject` 只排除显式开关关闭的音频（原生 mute 元数据或功能标记），普通音量为零仍保留依赖，不将静音误认舍弃。
- 使用 `structuredClone`，不修改历史原生工程、素材或保留的音量。重新启用后恢复来源及 gain。
- `usedWorkspaceContent`、导出 readiness 和实际 render spec 都使用执行图，避免仅跳文件验证后渲染仍尝试读取已关闭文件。
- 口播 mode 保存与 enabled 同步，保留原音轨；待准备计数及自动刷新跳过关闭口播。
- 字幕原始读图的 `resolveWorkspaceMainVoice` 已看 audible，并由 disabled marker 保持 `explicitRoute`，因此关闭口播后不回退旧 draft 音轨。字幕仍开启时，声音变化使旧时序证据失效，需要校对当前时序；不会因旧口播任务强制生成。
- `adoptFirstWorkspaceNarration` 已跳过 `enabled=false`，迟到结果不会自动恢复关闭的口播。

## 发现并已反馈

1. 导出 render spec 使用执行图，但 technical check 的 expectedDuration 仍从原始 project 计算。如果已停用音轨尾部比画面长，正确的渲染文件会被误判时长不足。主 Agent 已收到修正及专项测试建议。

## 实际检查

- `npx vitest run src/workspaceExecution.test.ts src/workspaceAudio.test.ts src/workspaceCaptions.test.ts src/local-app/workspaceExportCoverage.test.ts --reporter=dot`：4 文件、14 测试通过，日志 `batch1-independent-unit.log`。
- 使用本轮隔离 PostgreSQL 上下文执行 `workspaceNarrationTabs.integration.test.ts`、`workspaceAudioStorage.integration.test.ts`、`workspaceExport.integration.test.ts`，3 文件、12 例：10 通过、2 失败。`workspaceNarrationTabs` 与 `workspaceExport` 通过；`workspaceAudioStorage` 中 legacy/registered synchronized preview 两例由 Worker `review_rendering` 返回 generic failed，失败发生在 `mediaWorker.ts:122` 包装的媒体执行/验证边界。旧同步预览不调用本次 `workspaceExecutionProject`，尚不能归因本批修复，也不能忽略。日志 `batch1-independent-integration.log`。

## 同步预览失败的环境复验

环境 Agent 独立查明：旧同步预览使用 `OPENCHATCUT_ROOT` 环境变量，不使用 HTTP fixture 的 runtime.root。补上 `/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut` 后，两个失败用例 2/2 通过（19.65s，8 非目标跳过），见 `environment/sync-preview-diagnosis.log`。因此第一批 12 个目标用例最终均有通过证据，无需为同步预览修改业务代码。后续集成统一设置该环境变量。
