# P2：重复注销与迟到失败回调

2026-10-25，Asia/Shanghai。仅修复本轮复查发现的并发注销 P2，沿用优化 worktree、`codex/local-first-stage-a` 和 HEAD `49e2538`。不提交、不新增在线请求、不进入 E/F；SQL 一致性建议暂不处理。

## 行为与范围

首次 P2 修复在每个注销请求的 `finally` 无条件清理工作区。重复点击产生两个请求时，先完成的失败可以显示登录表单；重新登录后，另一旧失败仍会清掉新目录及组件 CSRF。另一完成顺序下，旧失败还会在最新注销尚未结束时过早清屏。

现在每次注销捕获推进后的会话代次，`catch` 和 `finally` 仅在该代次仍为当前代次时更新状态。重复请求由最新代次负责收尾；旧失败不显示错误，也不清理新状态。请求开始时推进请求/会话代次、关闭目录读取的顺序保持不变。此修复没有新增请求去重或取消机制，没有改客户端或服务端鉴权。

业务源码只改 `LocalCatalogApp.tsx` 的注销回调；测试只追加到同名组件测试。`client.ts`、SQL、依赖、迁移、其他 D 实现、根 PLAN 及无关文件保持本轮前字节。

## 验证

| 检查 | 结果与证据 |
| --- | --- |
| 原实现红测 | network reject、HTTP 503 × 两种完成顺序，共 4 项新增测试全部失败，原 7 项通过。失败分别落在「最新请求尚未结束却显示登录」和「重新登录后旧回调清掉新目录」。[原始红测](evidence/logout-concurrency-p2/focused-red-01.txt) |
| 最终组件/实际客户端 | 11/11。两请求 pending 时手动刷新、visibility 事件不新读；旧失败先到不清屏；最新失败要求重新登录；旧失败晚到不影响新目录/错误；旧目录响应不回填；新登录仍可刷新，实际 `localCommand` 使用新 CSRF，下一次注销也携带新组件 CSRF。[最终绿测](evidence/logout-concurrency-p2/focused-green-02.txt) |
| 完整默认回归 | 默认 5000ms，102 文件、766/766 通过，无超时覆盖、无旧断言变更。测试进程只允许本机 Socket。[最终完整日志](evidence/logout-concurrency-p2/full-default-5s-02.txt) |
| 类型与构建 | `npm run build` 的 `tsc -b` 与 Vite 构建通过；约 586.67KB chunk 告警保留。正常 npm 启动另编译本地应用并准备 runtime。[构建](evidence/logout-concurrency-p2/build-01.txt)、[正常启动](evidence/logout-concurrency-p2/start-02.txt) |
| 实际 Chrome | 既有恢复隔离库、正常应用入口；仅浏览器 fetch 的两个注销 Promise 被可控拒绝。确认 pending 刷新不新读，较新失败转登录，同一文档真实重新登录，随后旧失败回调不能清空界面或注入旧错误。[浏览器结果](evidence/logout-concurrency-p2/browser-result.json)、[失败转登录](evidence/logout-concurrency-p2/newer-failure-login.png)、[旧失败后界面](evidence/logout-concurrency-p2/late-failure-keeps-session.png) |
| 真实 CSRF 与收尾 | 解除两次故障后，下一次正常注销真实 POST 200，携带重新登录取得的组件 CSRF。没有新增配置写入。删除本轮认证项、关闭独立 Chrome，正常 npm 停止自有服务。[最终浏览器核对](evidence/logout-concurrency-p2/browser-final-audit-01.txt)、[停止](evidence/logout-concurrency-p2/stop-01.txt)、[范围](evidence/logout-concurrency-p2/scope-result.json) |

浏览器证据证明真实 React/客户端在可控回调时序下的表现；两次注销失败由页面内 fetch 测试探针产生，不是真实服务端 503、网络包迟到或 Cookie 乱序验收。HTTP 503 与旧目录迟到由实际组件/客户端边界的可控异步测试覆盖。最后一次浏览器刷新已触发，未把其后立即正常注销前的未完成读取称为完整刷新验收。

## 本轮失败、告警与历史保留

- 首次完整回归也是 766/766，但新增测试出现两处 `LocalDeletionRecovery` 的 act 告警。补齐异步交互等待后重新运行组件与完整回归，新测试告警消失；[首次完整日志](evidence/logout-concurrency-p2/full-default-5s-01.txt)和[首次绿测](evidence/logout-concurrency-p2/focused-green-01.txt)保留。既有审核组件 act 告警和受控导出 503 输出不修改。
- 首次 npm 启动使用相对部署路径，被入口拒绝；[原错误](evidence/logout-concurrency-p2/start-01.txt)保留，改为绝对私有路径后才正常启动。
- 浏览器首次 `dblclick` 实际只登记一个挂起注销，导致[两个请求前提检查](evidence/logout-concurrency-p2/browser-pending-01.txt)、[依赖该前提的读围栏检查](evidence/logout-concurrency-p2/browser-pending-audit-01.txt)、[释放第二回调](evidence/logout-concurrency-p2/browser-release-newer-01.txt)失败。读取实际状态后补一次明确点击，登记两个请求再接续；没有放宽产品断言或超时。后续[前提](evidence/logout-concurrency-p2/browser-pending-02.txt)、[读围栏](evidence/logout-concurrency-p2/browser-pending-audit-02.txt)均通过。
- 网络证据审计首次按整行匹配 `http`，误把 SVG data URL 内的 XML 命名空间识别成外部请求；[审计错误](evidence/logout-concurrency-p2/browser-network-audit-01-result.json)保留。改为解析请求 URL 字段后，实际 HTTP 均为本机 55189，登录 2 次、真实注销 1 次、配置写入 0 次。[正确审计](evidence/logout-concurrency-p2/browser-network-audit-02-result.json)

原 D 收尾 331 项公开、397 项私有文件全部保持原字节。首次 P2 的原始成功/失败日志、截图、私有材料和 `logout-p2.md` 也保持原字节。当前 README、review 是已索引的活动报告，本次更新前的[README 原件](README-before-concurrency-p2.md)、[review 原件](review-before-concurrency-p2.md)与私有旧索引另存快照；索引仅刷新这两条活动报告记录，其余旧条目不变，再追加本轮证据与源码快照。[保留核验](evidence/logout-concurrency-p2/evidence-retention-result.json)记录原 SHA 与快照映射。旧索引的 379 项公开、488 项私有均可按原 SHA 追溯，不将活动报告更新伪称所有旧路径字节不变。

原 `760/760`、`758/759`、首次 P2 `762/762`、T21 `740/745`，以及首次 P2 两次浏览器驱动失败全部保留。本轮 `766/766` 不替代历史结果。

**历史默认 5 秒失败及未解决根因继续保留。30 分钟 Worker 租约与立即故障切换、真实 WhisperX 成功推理、默认/新主机完整部署、在线生成、其他 Provider、完整多能力 Worker，以及 E/F 全链路、容量、性能、切换回退均未由本次修复关闭。** 模拟资格、历史 SecretStore 替身、T17 日志覆盖说明和 Pexels 已用尽的两次在线预算不变。

[本轮摘要](evidence/logout-concurrency-p2/verification-result.json)、[总证据索引](evidence-index.json)。原始网络、快照、认证材料及部署配置留私有，不公开 HAR。此报告是主 Agent 收尾记录，不是独立评审。
