# 清理后前后端接口、调用链与命名复核

日期：2026-11-15。范围为当前未提交工作树，SQL 已到 205，日常固定执行合同为 `production-workspace/v3`。保留无关改动，不提交或推送。

## 结论

静态清单和逐项语义核对未发现前端调用了不存在的后端接口、命令或 SQL 函数；当前制作、历史来源显式接入及旧结果核对的边界保持。发现并修复了写入与读取错误耦合、旧读取覆盖新操作，以及会话准备／命令恢复的边界问题。

本轮不改 SQL、HTTP wire 名称或日常固定后端，不新增依赖。仍有旧词命名，但承担当前功能的函数不能直接删除。命名与消费者详见 [NAMING.md](NAMING.md)，审查结论见 [subagent-review.md](subagent-review.md)。

## 已修复

| 问题 | 修复与实际影响 | 验证证据 |
| --- | --- | --- |
| 操作已写入仍串行等待详情、目录或连接 GET；慢读使上传后续登记和界面 pending 无法结束 | `LocalEpisodeDetail`、`useConnectionActions`、`LocalCatalogApp`、回收站及删除恢复在写入成功后返回，独立刷新。新账号先按成功回执导航，再读取目录；刷新失败提示“操作已保存” | `write-refresh-before.*`、`episode-refresh-before.*` 红测；`write-refresh-final.json` 71 项及详情相关最终 20 项通过 |
| 旧读取的成功／失败污染新的操作或 Owner 访问 | 按 Owner、生产单、命令代次限制发布；连接读取错误与写入错误分开。详情增量 reader 按 epoch 分离 in-flight 和缓存发布，保留已接受 hashes；中止被替代的读取，旧 poll 取消不会误报；过期排队刷新不再重新发请求，StrictMode 重连不再误取消首次读取 | `manual-read-race-confirmed.*`、`stale-success-before.*`、`poll-abort-before.*`、`queued-strict-before.*`；`queued-strict-after.json` 20 项通过 |
| CSRF session bootstrap 失败被误判为已发送写入，造成永久未确认恢复 | 在真实 mutation fetch 前明确标记 `requestSent:false`，未发送时不保留写入意图。已经可能写入的操作仍保留未知状态，session／回执暂不可用也不重发 | `csrf-before.*`；`client-complete.json` 18 项及真实 HTTP／DB 两项客户端恢复验证通过 |
| Owner A 未确认意图阻断 Owner B 同内容写入；旧无 Owner nonce 的非恢复类命令可能重发 | `localCommand` 用真实 session/login Owner 分区 nonce 和 in-flight，A→B→A 保留各自恢复；所有旧无 Owner key 只读回执，未知继续保留，含 `retryDeletionCleanup`，不会自动执行 | `owner-before.*`、`legacy-cleanup-before.*`；Owner reload、旧 committed／unknown 及清理命令零重发回归通过 |

必要的读后写、revision 校验、逐次确认、供应商结果核对、恢复和交付顺序继续保留，没有为并行化绕过它们。`localConnectionCommand` 和 billing 的后端幂等模型不同，本轮没有把它们改为 `localCommand` 的回执恢复协议。

## 调用链检查范围

[contract-inventory.json](contract-inventory.json) 按当前 AST 和当前固定后端字段合同生成：

- 439 个产品源文件、80 处前端请求调用点；人工核对 endpoint、命令分派、字段、结果消费及加载／失败关系。
- 65 个工作区命令字段合同（包括需由后端拒绝的兼容输入合同，数量不代表全部可执行入口）。
- 297 处静态 SQL 函数调用，涉及 134 个不同函数，缺失为 0；进一步核对实际角色、参数及返回消费者。
- 最终 catalog 298 个函数、105 个 trigger、166 个可调用合同；本轮未改变迁移和数据库类型。202–205 删除的 78 个不同名称／79 个签名未在最终函数体调用中出现。
- 唯一动态函数名选择为 `record_workspace_narration_submission`／`record_workspace_visual_submission`，封闭二选一、四参数、仅 Worker 可调用。

以上计数是检查清单，不等于每个运行分支均已 E2E 执行。保留的租约终态核对／历史投影不会给予旧任务领取、执行或凭据读取权限。

## 最终验证

- `npm run check`：通过，见 `check-final-accepted.log`。
- 默认测试：305 文件、2245 项通过，无跳过，见 `unit-final-accepted.json`。
- 真实 Owner HTTP／原生 PostgreSQL：3 文件、7 项通过，无跳过，见 `http-frozen.json`。覆盖实际客户端首次 session 失败零 POST／零 DB 写入、成功重试一次，以及实际已提交写入丢响应、跨模块重载和 session 失败后只读回执恢复；另覆盖 Owner／完整 payload／CSRF、私有删除清单及旧命令和 Worker 边界。
- 完整 T12：series／unassigned **2/2 通过，无跳过**，见 [t12-accepted/2026-11-15T13-56-47-766Z-2d12cfd6/run.json](t12-accepted/2026-11-15T13-56-47-766Z-2d12cfd6/run.json)。实际创建、原生编辑保存／重启、导出、四种文件下载与 SHA／播放、editable／complete 恢复及精确删除通过，历史树和冻结行保持；宽／窄交付页可见 alert 为空，主 Agent 已亲看两张最终窄屏截图。
- 子 Agent 最终复审无剩余 P1／P2；新增发现已按真实失败回归关闭。

修复过程中保留红测和中间全套记录：`unit-complete.json`、`unit-accepted.json` 分别包含补入后尚未修复的 poll 取消／legacy cleanup 回归，不是最终通过证据。`unit-frozen.json` 当时 2242 项通过，但随后截图复查发现取消错误，补了排队／StrictMode 回归。最终全套以 `unit-final-accepted.json` 为准；此前 T12 虽 2/2，尚未断言交付页无错误提示，不能作为最终关闭该缺陷的证据。

前端性能检查使用 `modern-web-guidance` 的 performance 指南，关注消除无关等待及重复读取。没有引入新的浏览器缓存、后台调度 API 或平台兼容策略。浏览器验收沿用 `agent-browser`，T12 使用独立 session、源代码快照和 SDK 副本；驱动新增宽／窄交付页可见 `role="alert"` 必须为空的断言，以捕获截图中实际发现的错误。

## 保留与收尾

`worktree-preservation.json` 核对 13,177 个基线路径：只有本轮 17 个已有代码／测试／T12 驱动文件改变，新增 3 个测试文件，无其他产品变化；原 SQL、依赖、根 PLAN／DESIGN 及无关已有修改保持。HEAD 未变，最终 staged diff 为空；index 文件字节 hash 发生变化，未还原 index，也不将其误称为逐字节保持。

日常 PID 13273 与 release `3eb52fbc3b9ca3b37f468474cb6b4973c5647f1cf4736258ec0ab0d64b6160a7` 保持，prepared/source 完整性检查通过，见 `runtime-preservation-final.json`。本轮修改由前端源码使用，不需要替换固定后端包。自有 HTTP 验证集群已停止并删除，见 `cluster-cleanup.json`；最终 T12 集群、源码快照、SDK 副本、浏览器输入和自有媒体卷均已回收，cleanupErrors 为空，见最终运行回执；原 SDK git status 为空。

验证盲区：真实供应商返回使用受控媒体端口，未调用付费 Provider；Owner A→B→A 的前端恢复测试使用受控 fetch，服务端隔离另有真实 HTTP 验证；不把静态清单或默认单元测试当作所有 API 分支的实际业务验收。
