# 三类集成契约失败修复

仅修改三个测试文件；没有修改生产触发器、Provider、日常数据库、共享夹具或运行服务，也没有调用真实API。原样复现与修复验证使用独立验证源码、已核验 label / image / network-none 的测试容器及受控 Provider。

## 结论

首轮原样定向复现：3文件失败、3测试失败、1通过、1手动浏览器门控跳过，耗时27.72秒。最终同一组完整定向：3文件通过、4个启用测试通过、1手动浏览器门控跳过，耗时34.02秒。该跳过项是旧的人工蓝图页面等待用例，未将其计为通过；正式新页面的浏览器验收由本轮主流程记录。

### embeddedStudio：改用实际原生文档边界

旧测试直接读写 `runtime/project-store-v1/<project>.json`，当前SQLite权威存储不保证该备份存在，故出现ENOENT。改为复用 `editStudioDocument`，通过SDK项目文档HTTP、编辑权注册和释放完成编辑，不操作备份JSON。

第一次改为HTTP后，旧测试仅追加四字段asset；SDK `migrations/normalize.ts:isMediaAsset` 要求有效正数 `durationInFrames`，因此该对象在写入时被过滤，未实际测试未批准来源。现在克隆一个有效视频asset，替换为未批准来源，并让视频item引用它；随后直接从SDK读回文档，确认非法引用确实存在。Owner保存及重开仍按原断言返回409，宿主工程字节保持不变。

恢复文档后的成功保存可能因SDK规范化产生新SHA，测试从该成功回执更新下一次保存的 expected SHA。原来的“保存后再次使用旧SHA必须409”断言仍保留。权限、Origin、CSRF、跨账号、路径、关闭会话、重开版本、输入变化警告和替换确认断言均保留。

### workspaceFirstVideo.source：显式选择制作服务

旧测试的 `send` 使用 raw request；本次TTS草稿与视频生成没有传入服务selection，生产边界正确返回400“请选择本次制作服务”。ADR-0018要求每次制作明确选择，不能恢复蓝图工具回退。

测试改为复用夹具已经提供的 `chosenRequest`，显式带入语音与视频选择。原声为实际主声音、未生成的TTS草稿不能替代原声、视频窗口2秒/Provider时长4秒、冻结任务mode=source、narration_target为空、原声轨关联和nativeEditRevision不变等断言均保持。

### blueprintReviewRetirement：真正导入历史policy

旧测试通过普通SQL UPDATE模拟导入带审核关卡的历史policy，但SQL108的 `a_blueprint_creative_write` 在该次写入时已经投影为创作字段，测试未真正保存它所宣称的历史配置。

ADR-0018规定新/current写入只保留创作规则，同时明确被Episode引用的历史蓝图ID、规则和版本保持；#178与ADR-0019继续要求位置与创作归属分离，禁止为目录变化改写冻结历史。因此没有将原“历史policy保持原值”断言改为接受删字段。

修复仅在当前一次性夹具数据库中，以事务暂禁精确的 `a_blueprint_creative_write`，导入pre-108历史policy后立即恢复并COMMIT；异常执行ROLLBACK。不关闭其他验证或修改生产触发器定义。导入后先读回完整policy，证明真实存在历史关卡，再走原Owner脚本确认和成片流程，保留最终完整policy相等、零新审批、旧审核包不变、完成/归档只读等断言。

## 可复核命令与证据

在 `/private/tmp/loop-control-main-e2e-20261101/integration-regression/verification-source` 执行：

```sh
env LOOP_FORMAL_ACCEPTANCE=1 LOOP_EMBEDDED_STUDIO_ACCEPTANCE=1 LOOP_WORKSPACE_ACCEPTANCE=1 \
  LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-main-e2e-20261101/integration-regression/runtime-context.mjs \
  LOOP_TEST_OPENCHATCUT_ROOT=/private/tmp/loop-control-main-e2e-20261101/integration-regression/OpenChatCut \
  OPENCHATCUT_ROOT=/private/tmp/loop-control-main-e2e-20261101/integration-regression/OpenChatCut \
  npx vitest run src/local-app/embeddedStudio.integration.test.ts \
  src/local-app/workspaceFirstVideo.source.integration.test.ts \
  src/local-app/blueprintReviewRetirement.integration.test.ts \
  --maxWorkers=1 --fileParallelism=false
```

- `integration-contracts-before.{log,json}`：原样红复现。
- `integration-contracts-after.{log,json}`：SDK写入过滤旧asset夹具的中间发现。
- `integration-contracts-final.{log,json}`：恢复保存后旧expected SHA的中间发现。
- `integration-contracts-green.{log,json}`：完整最终定向通过。
- `integration-contracts-source-readback.json`：同步main前逐文件确认原来无改动；同步后SHA与已验证源码一致。

最终仅3测试文件变化，37行增加、12行删除，`git diff --check`通过。未自行commit；主Agent负责与其他修复统一验证、提交及最终报告。
