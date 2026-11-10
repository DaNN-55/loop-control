# 状态机专项复查第 1、2 项验收

2026-11-10。仅实施剩余状态机专项复查建议中的 M26 样音归属、M24 模型发现与编辑基线。保留现有业务规则与恢复限制；本批未暂存、提交或推送。

## 实施结果

- 样音按音色、模型、连接版本等来源分配播放器、请求和确认状态。切换后停止旧播放、取消客户端等待；迟到回包、错误和 finally 不影响新访问，包括 A→B→A。仅调整语速继续复用同一来源样音；首次合成仍需明确确认。
- 模型弹窗区分最新目录与编辑基线。无编辑刷新跟随服务端启用值；有编辑时保留勾选，仅在服务端启用基线未变时接入发现产生的新 revision。并发启用变化时显示冲突并禁止保存，保留原 revision 与勾选，避免旧草稿配新 CAS。
- 保存被服务端拒绝时保留输入，不自动重试。关闭保留的草稿使用原编辑基线；重开仍按原 version／revision 规则恢复，不跨版本移植或强制覆盖。

仅修改两个产品模块及对应测试，新增 12 条回归；决定见 [ADR-0038](../../adr/0038-speech-sample-and-model-edit-ownership.md)。未实施本轮建议第 3–5 项。

## 验证结果

| 检查 | 结果与证据 |
| --- | --- |
| 先复现 | 样音缓存串用、干净模型刷新、并发启用基线各有红测试，见 `sample-red.log`、`models-red.log`、`models-conflict-red.log` |
| 定向回归 | 6 文件、64 条通过；`targeted.log` |
| 类型检查 | `npm run check` 通过；`check-review.log`。早期新增测试的未使用 import 已修正，保留初始失败日志 |
| 构建 | `npm run build`、随后 `npm run backend:build` 通过；`build.log`、`backend-build.log` |
| 浏览器 | 7 条受控流程通过，真实组件与本地 MP3 实际播放；`browser-summary.json`、`browser-results.json`、`verify-browser.py`。1280px／390px 冲突弹窗已人工检查截图，无横向溢出 |
| Standards 审查 | 独立只读审查无发现 |
| Spec 审查 | 独立只读审查无发现 |
| 最终全量一次 | 256 文件：1915 通过、1 跳过、2 失败；`full-tests.log`，全量未全部通过 |

浏览器覆盖来源切换与语速复用、首次合成确认、旧回复隔离、无编辑刷新、并发冲突与草稿原 CAS、仅发现 revision 前进、保存拒绝保留输入。样音通过实际客户端 HTTP／CSRF 请求，模型通过实际弹窗的外部回调和受控 HTTP；均未替换新增私有实现。

### 全量失败的归因与边界

两条失败均位于 `src/local-app/ProductionWorkspacePanel.test.tsx:38`、`:51`，仍查找「本期素材 · 3／1」heading。另一会话的提交 `62885252` 删除了素材栏 h3，将计数留在原按钮上；测试断言未同步。

该文件单独复跑：36 通过、相同 2 失败（`full-failure-recheck.log`）。隔离复制当前源码，仅把本批 `WorkspaceSpeechSample.tsx` 和 `ConnectionModelsDialog.tsx` 换回修改前版本，仍为 36 通过、相同 2 失败（`prechange-failure.log`）。因此这两条失败不由本批两个产品改动引起；按项目范围约束仅报告，未修改旧断言。未重复运行整套测试。

测试日志保留既有 jsdom 媒体方法未实现、React act 警告，前端构建保留大 chunk 警告；这些不计作检查失败。

## 范围与清理

初始 HEAD `951a368e`，执行期间另一会话独立完成两笔视觉提交，当前 HEAD `62885252`；本批保留其结果，未操作 Git 暂存或提交。`batch.diff` 仅包含本批两个模块、两份测试、ADR 与计划段；验证夹具另存于本目录。

211 个先前变更文件的保护清单中，206 个字节不变；`PLAN.md`、ADR 索引为共享文档限域编辑；两份 CSS 的外部更新与当前 HEAD 一致；原 `final-desktop.png` 由另一会话已归档的清理移除，见 `../interaction-refinement-20261110/cleanup.json`，本批未删除或还原。详情见 `protection-result.json`。

本轮浏览器和 5195 隔离预览已关闭；仅清理本轮 scratch。保留日常 5174、其他会话改动和验证文件。没有新增依赖、SQL、真实业务写入或供应商调用。

真实业务数据库及供应商集成未运行。客户端取消不能撤回已经发出的供应商合成请求；现有付费确认、Owner／连接版本校验、服务端 CAS 与草稿恢复限制保持不变。
