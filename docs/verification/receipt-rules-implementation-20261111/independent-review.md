# 回执规则独立审查（实施前）

日期：2026-11-11  
范围：规则 4 / 5 / 17 / 24 的阶段分类、回执持久化与恢复边界。未访问日常数据库、未调用真实供应商、未修改业务代码。

## 当前可复用的边界

- `workspace_*_submissions` 已能保存 `started`、`received`、`rejected`；它是提交账本，不能单独证明产物已登记。
- `native_output_publications` 与 `nativeAttemptOutput` 已提供可靠的**产物发布后半段**：先保留私有发布凭据，再用 attempt/lease fence 把文件和任务结果一起登记；提交结果不明时可只恢复原产物，不会执行供应商调用。
- `useWorkspaceCallConfirmation` / `retryOfTaskId` 已提供“可能重复收费”的显式新请求确认路径；应复用，不能以后台重试替代。

## 必须保持的安全语义

1. `reserve=false`、route 为 `null`、连接/输入/权限校验失败，只有在调用点仍可证明 **尚未进入 transport** 时，才能标为 `not_sent`；旧的 `started` 记录、旧的 `unknown` 或任意非结构化异常不能倒推为未发送。
2. 写入“将要发送/可能已发送”的持久事实后，任何超时、断线、进程退出和 `catch` 都只能进入 `unknown`；先查原任务，绝不自动重发。
3. HTTP 响应或内存中的 bytes 不是可恢复产物。只有冻结 staging 目录中存在完整、校验通过且与 task/attempt/输入指纹绑定的私有 manifest 时，才可承诺“恢复登记原产物”。
4. `received` 后本地登记失败不能新生成；有上述 manifest 时走既有 publication reconciliation，无 manifest 时保留结果未知。
5. 自动恢复最多两次只适用于结构化 `not_sent + transient_local`，并必须保留相同任务输入、连接版本、fence/尝试计数；权限、参数、输入变更和任何可能已外发的情况均不可自动恢复。

## 最小实现建议

优先新增一张按 `(task_id, attempt)` 保存的 Worker 私有阶段记录，而不是把旧 `workspace_*_submissions.outcome` 重新解释为完整状态机。最小字段应包含：阶段、输入/连接指纹、结构化失败原因；对“已外发”还应有不可回退的 armed/unknown 事实。自动恢复次数与下一次时间需要按同一冻结请求跨 attempt 累计。旧 submission 行继续作为兼容证据，缺少新阶段记录的历史任务一律维持保守未知。

阶段建议为：

- `not_sent_transient` / `not_sent_final`：只由发送前的结构化分支写入；
- `dispatch_armed`：紧邻实际 transport 前写入，之后默认可能已外发；
- `dispatching` 后的“可恢复产物”不另设新的业务回执阶段：仅当既有 `publication-receipt-private.json` 已经 fsync、并且存在同一 task/attempt/fence 的 publication hold 时，才可作为恢复 authority；
- `registered`：既有 publication 成功后写入；
- `rejected`：仅明确的供应商拒绝。

`dispatch_armed` 最好由现有 reserve/预留路径在同一受 fencing 保护的数据库操作中写入。若先 reserve、后另写 armed，进程在两者之间退出会产生新协议无法解释的 `started` 空洞；该空洞仍必须按未知处理。

自动恢复计数不能只存于 `(task_id, attempt)` 这一行：一次重新 claim 会改变 attempt，计数会被重置。应按同一冻结请求在 task 维度原子累计（或查询同 task、同 fingerprint 的历史 attempt 后原子增加），并同既有 `max_attempts` / 通用队列恢复协同，确保不会产生第三次自动发送。

应复用 `prepareNativeAttemptOutput` 的 staging 位置和 `nativeAttemptOutput` 的既有私有 publication receipt，而不是另造 response cache/replay。原 executor 先解码并校验最终文件；在 `publish()` 中按既有顺序建 publication hold、验证文件、fsync 私有 receipt，再登记 provider `received`，最后原子登记任务与文件。这样恢复继续使用 `recoverNativeAttemptOutput`，绝不调用网络或 Keychain。

HTTP response 不是可恢复产物：TTS 的 SSE 和图片响应都还需要解析。若在完整 publication receipt 前崩溃或校验失败，维持 `dispatching/unknown`；若 hold 已建立但 receipt 缺失，保留 hold、拒绝恢复，也绝不可解 hold 或重发。`rejected` 仅适用于明确 HTTP 4xx 或已解析的确定供应商业务拒绝。

## 实施前后应检查的风险点

- `createWorkspaceGenerationFetcher` 会在 `authorization.reserve()` 后把 transport 异常统一转为 `ProviderOutcomeUnknownError`；不要在其外层按异常类型把 reserve 失败和发送后断线混为一类。
- narration 目前 `record_workspace_narration_submission` 写失败会转成 generic 错误；image 的 `received` 也早于 bytes 写入。两处都必须保留准确阶段，不能仅修 UI 文案。
- `workspaceVisualCandidates` 当前从任务状态、reservation 和旧 outcome 推导 `submissionUnknown`；新阶段接入时应以新记录优先，旧记录仅作保守 fallback，避免把历史 `started` 误显示为可自动重试。
- 既有 `native_output_publications` 只在 `publish()` 时建立。它不覆盖“供应商结果已拿到、但 worker 在 publication receipt 前退出”的窗口；该窗口必须维持 unknown，不能伪造可恢复证据。

## 建议的独立验证（不需要日常 DB 或真实供应商）

1. 受控 transport：reserve false、route null、输入/权限错误，断言 0 次发送、结构化 `not_sent`；其中历史 `started`/未知数据必须仍为 unknown。
2. transport 已进入后抛错，断言 1 次发送、`dispatch_armed/unknown`、无自动再发。
3. 同一明确未发送的临时故障：仅两次自动恢复；第三次停下；输入/连接版本任一变化后不恢复。
4. 成功响应后在 manifest 写入前/后，以及在 publication DB commit 前分别注入失败：前者不承诺恢复，后两者只允许原任务 publication reconciliation，供应商 POST 数保持 1。
5. owner 明确确认新请求：新 task 含 `retryOfTaskId`，旧回执/预留不被覆盖，供应商 POST 总数恰为 2；不确认时保持 1。

## 第一批实现审查（161 与 Worker 路径）

### 已复核的修复

- 跨 attempt 复用 route 的口播行已补齐：新 wrapper 先走原 lease 校验，随后仅在当前 `(task, attempt, lease)` 仍为 `dispatching` 时更新同一 task 的旧 `started` submission（`db/local/161-provider-dispatch-facts.sql:122-127`）。它不改写旧 attempt，也不会在旧/未知事实下更新；此前报告的这一项已解决。

### Important improvements

1. “自动恢复最多两次”当前只覆盖 `prepare_provider_dispatch` 抛出暂态数据库错误时的同一 Worker run 内循环；`ProviderRequestNotSentError` 进入 `codexRunner` 后显式 `shouldRetry=false`。若已确认未外发的 Keychain/本地文件等暂态准备错误也在已批准范围内，则还没有自动恢复；应明确 ADR 的范围，或用同一持久计数和 fence 扩展该路径。
2. 事实表已经提供 owner-safe observation，但当前 workspace narration/image projection 仍依据旧 submission 和 task result。类别 5/17 接入前不能将新的 `not_sent`/`dispatching` 当成 UI 已完成；旧事实应继续保守 unknown。

### Verified strengths

- 图片、口播均在 transport 前调用 `mark_provider_dispatching`；该写入失败保守转为 unknown。
- 付费同步任务在既有 private publication receipt fsync 后、同一发布事务中才写 `received`；之后的失败会保留 hold 并抛出 `NativePublicationUnknownError`。
- `codexRunner` 对 `NativePublicationUnknownError` 直接上抛，未转换成通用失败结果。

### Verification suggestions

新增隔离 PG/Worker 场景：attempt 0 已 reserve 后进程退出，attempt 1 复用 route 并成功完成；断言供应商 POST 仅一次、provider fact 和旧 narration submission 都为 received、无 unknown blocker。再分别注入 publication receipt 后的 received 写失败及 COMMIT 回执丢失，断言只可 reconciliation、无第二次 POST。

## 第二批实现审查（162、只读 command receipt 与客户端锁）

### Critical issues

无。复核到的 SQL guard 与只读查询均维持“缺失回执即 unknown，不重发”的边界。

### Important improvements

1. 已持久化的客户端不确定锁没有接入制作工作台的“重新读取已保存工程”提示。`localCommand` 在读不到回执时明确抛出 `LOCAL_COMMAND_OUTCOME_UNKNOWN` 并保留 sessionStorage 锁（`src/local-app/client.ts:24-40`），但 `ProductionWorkspacePanel` 只把旧的 `local_service_unavailable` 识别为需核对状态（`src/local-app/ProductionWorkspacePanel.tsx:126`）。因此 `episode-commands` 的断线场景只显示普通错误，用户没有同页的“重新读取”入口。把这两个 code 归为同一不确定状态；不要据此清除锁或重 POST。
2. 回收站的 `planRecyclePurge` 和生命周期的 `retryDeletionCleanup` 不会写入其本次 `idempotencyKey` 的 `command_receipts`（`src/local-app/recycleBin.ts:81-83`、`src/local-app/episodeLifecycle.ts:100-103`），但客户端按整个 endpoint 把它们列为可回读命令（`src/local-app/client.ts:24`）。若响应在服务端执行后丢失，后续同参数点击会永远只得到 unknown。这不会造成重复写入，但会造成无意义的锁死。最小修复是在客户端 recoverable 白名单中排除这两个非回执命令（它们本身可安全重新读取/恢复），或让服务端也为本次意图持久回执；不能在“查不到”时重放其他写命令。
3. `commandReceipt` 手写了删除回执的字段剥离（`src/local-app/commandReceipt.ts:18-21`），与 `LocalEpisodeLifecycle.publicResult()` 的正式公开投影已出现两份规则。当前它会返回正常接口特意仅在清理 pending 时才返回的 `message`，未来私有删除字段新增时也容易漏掉。应提取/复用同一个公开投影函数；保持 `recycleInventory`、cleanup targets/root、history scan/removed paths 永不经 readback 返回。

### Verified strengths

- 162 要求新口播请求同时具备当前 call confirmation、同一原 task 的 `retryOfTaskId`、同一 clip，并以唯一索引限制每个原 task 只有一条替代请求（`db/local/162-confirmed-narration-unknown-retry.sql:10-27,45`）。UI confirmation 也明确说明“可能两次计费”（`src/local-app/useWorkspaceCallConfirmation.tsx:74`）。这满足“先核对，明确确认后才新生成”，不是自动重发。
- `provider_request_not_sent` 只认可至少一条新协议事实、且所有事实仍是 `preparing/reserved`（`db/local/161-provider-dispatch-facts.sql:147-151`）。旧任务、已 `dispatching/received/rejected` 仍不会被反推为未发送；162 的口播和图片 guard 已使用它（`db/local/162-confirmed-narration-unknown-retry.sql:18,34,41`）。
- command receipt 查询仅按当前 session owner 查询，且返回前重新比对 canonical payload hash（`src/local-app/commandReceipt.ts:13-17`）；不存在按 idempotency key 跨 owner 读取。查询路径不执行原命令，也不访问 Provider/Keychain。
- 收到回执但未写入敏感 publication evidence 的情形仍由 `native_output_publications` / private receipt authority 决定恢复；本批代码没有把完整 HTTP response 当作可发布产物。

### Verification suggestions

1. 浏览器/组件：让 `episode-commands` 先返回 503 且 `/command-receipt` 返回 unknown，断言工作台显示“重新读取已保存工程”，再次点击只发生 receipt readback、不会产生第二个 POST。
2. receipt 覆盖表：为 configuration、episode-commands、episode-lifecycle、recycle-bin 各各验证一次 hash 相符/不符、跨 owner、敏感删除回执；对 `planRecyclePurge`、`retryDeletionCleanup` 验证所选择的“非回读”或“已持久化”策略。
3. 隔离 PG：两个并发、已确认的同一 narration replacement，只允许一个 child；原 task 的 `dispatching/received`、publication hold、旧记录，以及无 `retryOfTaskId` 的调用都必须拒绝第二次 Provider POST。

## 最终补丁复核

### Critical issues

无阻塞级缺口。

### Verified fixes

- `ProductionWorkspacePanel` 已把 `LOCAL_COMMAND_OUTCOME_UNKNOWN` 与旧服务不可用统一到“重新读取已保存工程”的保守核对入口；它没有清除浏览器锁或发起第二个 POST（`src/local-app/ProductionWorkspacePanel.tsx:126`）。
- client 只把确实持久回执的命令纳入只读 readback；`planRecyclePurge`、`retryDeletionCleanup` 和原本由用户显式恢复运行时的目录/Studio 操作已排除（`src/local-app/client.ts:24`）。这不会让未知写入自动重发。
- `publicDeletionResult` 已抽为生命周期与 receipt readback 共用的投影（`src/local-app/episodeLifecycle.ts:18`、`src/local-app/commandReceipt.ts:19`）；私有清理清单/根目录/历史扫描信息不再由新接口单独维护一份字段名单。
- `createWorkspaceGenerationFetcher` 的 `reserve()` 在 transport try/catch 之外；`ProviderRequestNotSentError` 原样向上传递，而 transport 后任何其它异常仍转 unknown（`src/local-app/providerNetwork.ts:183-215`）。符合“不能通过网络 catch 推断未外发”。
- 火山 TTS 仅在第一段可用音频前，将文档明确的 `45000000/45000001` 归为 typed rejection；部分音频、畸形 SSE、其它业务码和 5xx 仍留在 unknown 路径（`src/worker/mediaProviders.ts:91-102`、`src/local-app/narrationWorker.ts:62-69`）。拒绝回执写失败也会转 unknown。
- 口播视图会跳过已有 child replacement 的原未知任务，选择当前 child；并继续要求 UI confirmation 中的重复计费提示（`src/local-app/workspaceNarration.ts:56`、`src/local-app/useWorkspaceCallConfirmation.tsx:74`）。161/162 的 `provider_request_not_sent` 仅放行全程停在 preparing/reserved 的新协议事实，旧/已 dispatch 的记录不会被放行（`db/local/161-provider-dispatch-facts.sql:147-151`）。

### Remaining verification

未运行全量构建、日常数据库或真实 Provider；由主 Agent 正在执行的隔离 PG/HTTP/浏览器验证应覆盖最终结论。
