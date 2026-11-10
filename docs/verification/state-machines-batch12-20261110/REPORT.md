# 状态机第 1、2 项实施与验证

日期：2026-11-10。初始 HEAD：`491a123a`。本批开始时已有前轮确认 hook／状态机文档及另一会话部署研究的未提交文件；本批按快照比较，不覆盖或提交它们。

## 改动

1. 新增 `src/workspaceTaskPresentation.ts`，仅解释已有任务证据，集中完整状态标签、紧凑摘要和既有恢复入口条件。图片／视频任务详情、图片普通重试判断、口播与音效摘要复用。音效未知提交从「失败」改为「结果待核对」，详情仍明确「提交结果未知」；发布 hold（包括 attempt 0）优先。已加入、已采用、实际时长和本地素材可用性独立保留。
2. `WorkspaceDeliveryPanel` 直接复用现有 `useWorkspaceReading/useWorkspacePolling`，归属绑定 episode／workspace／delivery／是否仍在轮询。保留原 GET 地址、2500ms 节奏、交付命令与导出绑定。接收本组件命令结果使用同一读取入口发布，以阻止尚未返回的旧读取覆盖新结果。

业务数据库、任务状态、供应商提交、未知结果限制、费用确认、原任务恢复、publication hold 协议均未修改。普通音频准备重试继续依据准备记录的 status 加原 hold／unknown 条件；展示优先解释真实 generationTask，不把输入的 pending 当作原任务停止。图片未知重试例外仍由原上层入口选择，仍需再次确认费用。

实际产品差异为 5 个原有组件和 1 个新增纯投影模块；新增／修改两个公开组件测试文件。没有 SQL、依赖或 CSS 变更，第 3–5 项建议未实施。设计依据见 [ADR-0034](../../adr/0034-workspace-task-presentation-and-delivery-reading.md)。

## 失败复现与回归

- 音效 `status=failed`、`submissionUnknown=true`：原摘要显示「失败」，详情显示「提交结果未知」。新增公开组件用例先失败，修复后通过。
- 交付读取 revision 7 延迟返回，期间父组件已提供 revision 8：原实现仍调用 `onChange` 发布旧版本。新增用例先失败，复用真实读取 hook 后通过。
- Spec 审查发现口播准备状态 pending 与原任务 running 可以合法并存。新增用例先复现摘要「待准备」、详情「口播生成中」不一致，再改为优先真实任务状态；保留音频准备重试的原判断依据，避免扩大资格。

定向最终 5 文件／101 条通过，见 [targeted-final.log](targeted-final.log)。覆盖正常排队／生成、明确拒绝、未发送、提交未知、收到结果待核对、发布 hold、原任务恢复、替代任务隐藏、图片显式未知重试、已加入音效、口播时长，以及原任务与准备状态不同的情况。

交付覆盖旧 revision、同 revision 后收到新状态、旧错误、workspace／delivery 切换、停止轮询、卸载、当前读取失败与下次恢复、回调替换、2500ms 节奏及同一归属不重叠。HTTP 是受控边界，`useWorkspaceReading/useWorkspacePolling` 使用真实实现，没有 mock 内部读取 hook。

## 类型、构建与全量测试

- `npm run check` 通过；最终 `npm run build` 再次包含完整类型检查及前端构建，见 [build-final.log](build-final.log)。新增测试中的 fetch spy 曾产生类型错误，已修正，未放宽类型约束。
- 前端构建完成后顺序执行 `npm run backend:build`，通过，见 [backend-build-final.log](backend-build-final.log)。本批没有并行清空 `dist` 与运行依赖构建产物的测试。
- 仅执行一次默认全量测试：251 文件通过、1 文件失败；1849 条通过、1 条失败、1 条跳过，见 [full-tests.log](full-tests.log)。失败为未修改的 `LocalDeletionRecovery.test.tsx` 中目标焦点断言，页面内容已出现但断言时焦点仍为 body。
- 随后只重跑该文件，6/6 通过，见 [deletion-focus-recheck.log](deletion-focus-recheck.log)。未修改删除流程或其测试，也未把首轮全量描述为全绿。合计 1850 条已通过，1 条跳过；焦点断言的全量偶发性仍是本轮实际观察到的限制。

## 浏览器

独立 Chrome 会话、loopback `5191`，使用真实任务／音效／确认／交付组件及正式样式。`serve.mjs` 提供隔离 HTTP 响应，不连接业务数据库、不代理供应商。核对结果：

- 未知音效摘要与详情语义一致，详情无普通重试；已加入音效和时长／增益保留。
- 发布恢复真实请求为 `episodeId=audio-fixture, taskId=task-held, attempt=0`；随后读回恢复后的本次状态，没有生成请求。
- 视频恢复回调保留 `remote-original`；图片未知重试打开真实逐次费用确认，保留可能分别计费提示；取消后未发确认提交。
- 真实延迟 HTTP 的 revision 7 被忽略，父视图保留 revision 8；下一次 revision 9 正常发布，revision 10 完成后轮询停止。3 次交付读取，无在途重叠。
- 1280px／390px 核对；390px 文档宽度为 390px，费用确认框在视口内。任务详情 Escape 关闭。结果与 HTTP 记录见 [browser-results.json](browser-results.json)。截图：[桌面任务](tasks-desktop.png)、[窄屏任务](tasks-mobile.png)、[图片再次确认](image-retry-mobile.png)、[交付完成](delivery-completed-desktop.png)。

这些证据验证 UI 与本地 HTTP 边界，不代表真实供应商或真实生产交付验收；未运行 PostgreSQL／Owner HTTP 集成套件。

## Standards

独立只读规范审查：无硬违规、无值得报告的 possible smell。共享投影有四处实际复用；交付轮询沿用既有读取边界，没有新增状态库或依赖。规范轴 0 项发现。

## Spec

独立只读范围审查：初次 1 项 P2，指出口播 `n.status` 覆盖原任务状态造成摘要／详情不一致。已补失败回归并修复；复核通过，未发现新增问题。交付读取与恢复限制未发现其他明确问题。范围轴 1 项已修复，0 项未解决。

## 收尾

本轮 Chrome 会话与 `5191` 预览已关闭，日常 `5174` 原 PID 3988 保留、首页 HTTP 200。未更新运行包、重启日常服务、写业务数据、付费调用、提交、暂存或推送。前轮确认 hook／测试、ADR-0033 与两份并行部署研究文件的 [SHA 核对清单](protected-sha256.json) 保持。仅清理本轮 `.scratch` 临时缓存，保留本目录报告、[准确差异](batch.diff)与失败／通过证据。
