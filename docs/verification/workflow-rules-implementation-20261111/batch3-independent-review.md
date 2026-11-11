# 第三批：退避、失效输入与原任务重试独立验收

本批审查 48 类中的 3、18、20、24、27、29、46。主 Agent 修改业务，审查 Agent 新增独立验收测试 `src/local-app/workflowRetryRules.independent.integration.test.ts`，未修改业务实现。

## 发现与修正

- `preparationCurrent` 初版使用 `workspace_source.relative_path`，实际冻结键是 `relativePath`，会把所有原片提取判为失效。已反馈，主 Agent 修正为驼峰键；独立 HTTP + Worker 测试证明未变化输入可恢复重试。
- 首次独立测试末段尝试删除唯一有效镜头，被正确 409 拒绝。测试补入另一个已匹配有效镜头后再删除目标，不放松最后有效镜头保护。原失败保留在 `batch3-independent-integration.log`。

## 通过证据

- 三文件单测 29/29 通过：`workspaceTaskRetry.test.ts`、`WorkspaceVisualTaskStatus.test.tsx`、`WorkspaceGenerationLocale.test.tsx`；日志 `batch3-independent-unit.log`。涵盖持久字段投影、unknown/hold 不得重试、失效状态不恢复、自动耗尽与新 Owner 明确意图的区分。
- `workflowRules.integration.test.ts` 3/3 通过，见 `batch3-independent-integration.log`。
- 独立实际边界测试 1/1 通过（5.55s），见 `batch3-independent-integration-retest.log`。同一场景验证：
  1. source 任务的真实 `available_at` 设为未来，投影等待重试；真正 `claim_next_worker_task` 返回空。
  2. 重复显式 retry 不新建任务、不跳过退避。
  3. 暂移实际输入文件，真实 Worker 失败；恢复同一文件后原准备可重试，新任务实际 ffmpeg 完成。
  4. 修改原片使用范围后，投影失效且原准备重试 409；删除原目标后仍 409，均没有新建任务。

## 判定与保留项

| 48 类行号 | 本批结论 |
|---|---|
| 3、18 | 保留重复/未知请求保护；已保存 Provider ID 恢复路径由视觉 23 例复验。 |
| 20、27、29 | 原目标/窗口已变化或已删除时，原准备不能继续；同一失败输入恢复后可以明确重试。 |
| 24 | unknown/hold 保护未放宽；发送阶段分类按用户第 3 项暂缓。 |
| 46 | 通过：UI 退避、失效、耗尽投影、真实 claim 门槛、未发送队列停止、在途/未知/hold保留、重开不自动请求及同输入明确新请求。 |

## 46 调度缺口已补齐并独立验收

主 Agent 新增迁移 158 与 `persistWorkspaceRevision` 统一调用：只有明确关闭/删除用途且没有发送或费用/发布未知证据的 ready 请求会 superseded + invalidated；快照和原结果保留。running、started/received、已有费用预留、provider_result_unknown 和 publication hold 全部保守保留。

审查另发现并先红后绿修正：初版 SQL 函数只查 Owner，没有拒绝 archived/completed/过期脚本/审核包。主 Agent 已补 current writable 边界；权限没有扩大到 loop_app 直接更新任务。

独立 `workflowQueueStop.independent.integration.test.ts` 最终 **4/4 通过**（20.75s），日志 `batch3-queue-stop-independent-accepted.log`：

1. 实际配乐准备产生四个 ready 请求；真实 claim 其中一个到 running，另两条分别保留 unknown 和 publication hold 证据。关闭只停止未发送的退避请求，其他状态、input_snapshot、last_result 保持原样。重启重开不建任务，新的明确准备才创建任务。
2. 删除有效视觉目标停止其 unsent ready，快照保留，UI 禁止继续旧任务。
3. foreign Owner、非法 kind/null/不匹配 shot、当前仍存在的 shot 取消、archive/completed/脚本或审核包过期全部拒绝；直接 loop_app task UPDATE 权限仍拒绝。
4. 真实 TTS 队列停用后 superseded；重启重开不自动提交，同一正文/同一 inputFingerprint 的新明确确认会创建新任务，不复用已停止任务；整个场景没有一次 Provider 调用。

中间失败保留：`batch3-queue-stop-scope.log` 是修复前 archived guard 红例；扩大失效审核包场景时测试未填写必需 invalidated_reason，被数据库约束正确拒绝，补齐合法夹具后 scope 复验及最终全文件通过。不是通过放宽约束处理。

