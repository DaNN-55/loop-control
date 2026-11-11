# 回执与日志底层调查

日期：2026-11-11。本轮只修改可观测性和日志／系统状态界面语言，不改变任务状态、重试资格、口播开关、费用预留或未知提交的处理规则。真实数据仅执行只读查询，未发送供应商请求。

## 核心结论

存在两类不同的「结果暂未确认」，此前的解释需要纠正。

1. 本机 HTTP 503 是服务端已经返回的错误响应。它表示本机处理抛出了未分类异常，不能证明「请求没有回到浏览器」，也不能单凭这个状态判断事务是否已经提交。
2. `provider_result_unknown` 也不都表示「本次请求已经发到供应商，但没有收到响应」。当前口播代码在未通过发送前的预留检查时，也抛出同一异常；真正的传输中断被另一个 catch 包成相同文案，原始原因丢失。
3. 咖啡生产单的口播关闭事实与目录投影确实不一致：原生工程已保存关闭标志，`workspace_narrations` 仍保留 TTS 任务引用，目录继续把这条 unknown 任务算成阻塞。这不是仅补说明文案就能解决的业务规则问题，留待本轮规则审阅后处理。

## 咖啡生产单：可以确认的事实

本轮 17:17（北京时间）的只读检查，保存于 `native-current-evidence.json`：

- 当前保存工程文件的 SHA-256 与数据库一致。
- `shot-02` 的 `loopControlNarrationEnabled=false`，但 `workspace_narrations` 仍为 `mode=tts`，仍引用任务 `0836c8fc-2a80-4ac4-b34b-34db62c16118`。
- `shot-01` 没有显式口播开关标志。
- 目录源查询实跑仍返回该生产单 `actionStatus=blocked`、`blockerCount=1`、`workflowStep=editing`，见 `catalog-current-evidence.json`。查询使用当前 `catalogQuery.ts` 源 SQL，Owner 范围内执行，事务为 READ ONLY。

`task-metadata.jsonl` 记录了该任务在 11 月 9 日的状态：从领取到完成 blocked 记录约 6 毫秒；不存在对应 `workspace_narration_submissions`，也不存在对应 `paid_generation_reservations`。任务的 `retry.shouldRetry=false`，没有自动重发。

这些证据不足以证明当时确实发出了口播请求，更不能据此断言供应商已收费。没有旧运行版本、发送阶段和关联日志，不能精确还原当时哪个预留条件没有通过。

当前数据库实际的预留函数使用 `workspace_production_authorizations` 视图，不能用旧的 `script_productions` 表无记录推断授权缺失。只读核对后，当前有有效且匹配原请求的授权记录；当前工程 SHA 与旧请求快照不匹配。当前条件不代表 11 月 9 日的条件，见 `current-narration-guards.json`。

## 已复现的口播分类问题

`narrationReceiptBoundary.test.ts` 驱动实际 `executeNativeNarration`、实际请求构造及受控传输端口，不修改生产实现，不调用在线供应商。

| 故障注入 | 真实传输端口次数 | 当前返回 | 结论 |
| --- | ---: | --- | --- |
| legacy 预留返回 false | 0 | `ProviderOutcomeUnknownError` | 发送前停止也被标记为结果未知 |
| confirmed route 返回 null | 0 | `ProviderOutcomeUnknownError` | 没有取得发送路径也被标记为结果未知 |
| transport 断开 | 1 | `ProviderOutcomeUnknownError` | 真正可能外发的中断，与前两种文案相同 |
| 已收到响应，数据库登记回执失败 | 1 | 普通「口播生成或音频验证失败」 | 已收到响应后的登记失败又被归到普通生成错误 |

关键代码：`src/local-app/narrationWorker.ts:49` 的 route 预留、`:59` 的 legacy 预留、`:62` 的 transport catch、`:66` 的回执登记以及 `:69` 的外层泛化错误。预留函数在工作版本、授权、脚本依据、旧提交未核对等条件不满足时均可能返回 false，当前布尔协议没有返回停止原因。

`providerNetwork.ts` 还有另一种发送前停止：旧网络账本的末条 outcome 为 `reserved`／`unknown` 时，在调用传输端口之前直接抛出 unknown。已有测试覆盖这一行为。但当前本机叙述网络账本末条是 completed，不能据此说咖啡那次一定被旧账本拦截。

视频路径取得供应商任务 ID 后会先持久登记，然后轮询和下载；恢复沿用原 ID，不重发生成。`videoTaskExecution.test.ts` 的故障注入覆盖提交、登记、轮询、保存、下载各阶段和恢复后的 POST 总数。同步 TTS 主要依赖本机提交记录与收到的音频流，不能假设存在可供事后查询的供应商任务 ID。

## 本机 503 为什么无法追溯

`localRoute.ts` 原有最外层 catch 把未归类异常统一转成 `local_service_unavailable`。同一文本可能来自：

- 鉴权后的数据库连接或事务错误；
- 本机文件、原生工程或运行模块异常；
- 保存或事务已经产生结果，但随后的读取、通知或响应步骤失败；
- 流式响应开始后连接中断。

原实现既没有请求编号，也没有把此 catch 的结构化诊断写进日志。已有旧日志里有 PostgreSQL 连接中断、构建导入失败和 Vite 语法错误，但它们没有关联请求和生产单；不能以时间接近认定它们就是最初截图的 503 根因。

本轮真实 HTTP 测试让一个写入端口先产生可见的受控副作用，然后抛出错误，实际边界仍返回相同 503。这个测试证明「503 不等于没有执行」的边界，不将受控内存副作用当作真实数据库提交证明。

## 为什么日志只剩错误

`runtime-log-stats.json` 是实际固定日志源在 17:04 的脱敏统计：最近 200 条中 INFO=0、WARN=0、ERROR=200；requestId=0、operationId=0。UI 的「只看错误」默认没有勾选。

日志读取器原本就支持结构化 INFO／WARN／ERROR。问题在采集端：正常本机请求没有写出同等结构化记录；Worker 的 stdout 主要承载任务返回协议，并未自动成为这份运行日志中的成功事件。旧文件里的明确错误和堆栈因此占满最近 200 条。读取器还保留单文件 1 MiB 和总计 200 条上限，不是完整历史事件库。

## 已修改的可观测性

- 新增 `runtimeRequestLog.ts`，本机请求返回 `X-Request-Id`。同一 HTTP 请求的 started／responded／interrupted 共用 requestId 和 operationId；本轮不宣称该编号已贯通 Worker、供应商和数据库业务回执。
- 来源校验通过后的写入记录开始与响应完成；2xx 为 INFO，4xx 为 WARN，5xx／响应连接提前关闭为 ERROR。正常 GET 不逐次采集，避免状态轮询撑满日志；异常 GET 会保留诊断。
- 记录时间、有限路径模板、生产单 ID（路径明确包含时）、HTTP 状态、耗时、白名单错误码和调用函数名。禁止记录请求／响应 body、query、header、密码、密钥、任意异常消息和完整堆栈路径。未知路径片段被模板化，日志写入异常不会改变业务返回。
- 原异常的任意 message 不直接落盘；只保留有限诊断码和调用函数名，兼顾定位与敏感信息边界。运行装配附带固定 runtime release ID。
- 日志读取器保留新增安全字段，并明确区分「请求已进入处理」「HTTP 成功返回」「连接提前关闭」。HTTP 成功不表示后台任务或整次制作完成。
- 对只有 ERROR 的当前摘录，界面说明「没有普通日志不代表没有成功操作」。不补造历史成功、不隐藏或删除旧错误。
- 日志、系统状态和本机运维界面支持显式 English 文案及日期／数字 locale。真实生产单名、目录与原始日志保持原文。新增系统抽屉将不适用于 dialog role 的 aside 换成 section，不改变交互。

新日志采集与语言 schema 属于后台运行版本。日常服务本轮未准备或重载，因此新采集不会凭前端热更新立即生效；需要在保存并退出活动 Studio 后正常准备／重载。旧错误不会被清空，后续只有发生真实请求才会出现对应正常记录。

## 未来是否还会遇到

仍可能遇到。网络断开、进程中断、供应商返回不完整，以及「外部已执行、本机未能持久登记」无法仅凭一次 HTTP 响应完全排除。当前避免重复付费的预留、原任务 ID 恢复和未知提交不自动重放规则仍有必要。

需要审阅的改进是将「未发送／已发送待确认／已收到但未登记／本地完成但前端未收到」分开，绑定阶段回执与可查询的操作编号；关闭或舍弃内容时，把制作阻塞与保留核对提醒分别处理。本轮不提前实施这些业务语义。

## 验证与运行边界

- `runtimeRequestLog.test.ts` 对缺失请求编号和记录先红，观测补丁后通过；真实 HTTP＋临时日志文件覆盖成功、异常、脱敏与无写入重放。
- `narrationReceiptBoundary.test.ts`：4 种当前边界全部复现通过。
- 12 个相关文件 178 条测试通过，见 `targeted-final.log`。日志白名单末次改动后 3 文件 10 条通过；抽屉语义标签末次改动后 5 文件 32 条通过。这些集合重叠，不相加为独立总数。
- 日志语言切换测试另 1 条通过，确认显式标签和日期格式改变、中文作品名保留；原始日志保留另经浏览器确认。
- 相关源码和测试独立严格 TypeScript 检查通过，见 `typecheck.log`。
- 日志／系统状态 × 中英文 × 深浅色 × 1440／375／320px，共 24 个实际浏览器场景，无页面或面板横向溢出；4 个资源圆环在两种语言中保留。英文日志详情保留中文作品名称和原始日志。
- 最终英文窄窗日志与系统状态 axe 均 0 违规，见 `axe-logs.json`、`axe-system.json`。
- 本轮未运行全仓构建、未重启 5174、未修改真实任务／生产单／口播设置／密钥或数据库函数。隔离 5214 预览使用合成响应，不转发 API。

17:17 只读忙闲检查：ready=0、running=0、active running lease=0、active task run=0；但咖啡生产单存在活着的原生 Studio 进程标记，PID 53799，经 ps 确认为原生编辑器形态。不能仅因无 Worker 任务就直接重启后台；此结论只对检查时间成立。

复跑：`npx vitest run src/local-app/runtimeRequestLog.test.ts src/local-app/narrationReceiptBoundary.test.ts src/local-app/runtimeLogs.test.ts src/local-app/localRoute.test.ts src/local-app/RuntimeLogsDialog.test.tsx src/local-app/SystemStatusMotion.test.tsx src/local-app/LocalSystemStatus.embedded.test.tsx src/local-app/LocalSystemStatus.test.tsx src/local-app/SystemStatusResources.test.tsx src/local-app/SystemStatusVersion.test.tsx src/local-app/providerNetwork.test.ts src/worker/videoTaskExecution.test.ts`。

界面夹具：从仓库根运行 `node docs/verification/settings-comments-20261111/receipt-logs/serve-fixture.mjs`，打开 `http://127.0.0.1:5214/__receipt-ui?lang=en` 或追加 `&page=system&theme=dark`。运行 `check-ui.py` 可复跑 24 场景。收尾仅关闭本轮 5214 和 receipt-logs-v2 浏览器会话，不关闭 5212 或任何日常／其他 Agent 服务。

## 主任务后续运行状态

主任务在用户明确确认已保存退出 Studio 后，完成最终构建及运行版本准备，正常重载了 5174（PID77719）。当前 running release 与 prepared release 匹配；本报告早期「未重载」是子任务交付时的状态。新请求日志采集和 en-US 偏好协议现已启用；未改变本报告的口播分类/阻塞语义。详见上级 `REPORT.md` 与 `runtime-reload.json`。
