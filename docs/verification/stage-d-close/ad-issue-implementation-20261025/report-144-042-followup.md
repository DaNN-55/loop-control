# #144 首次任务输出归属补验

本报告承接 [040 与发布恢复阶段结果](report-144-final.md) 和 [重新打开说明](issue-144-first-tts-reopen.md)。#142 同单实证发现了先前未覆盖的首次 TTS 与自动对齐路径，因此 #144 已重新打开。当前补修、隔离 PostgreSQL 及最终源码同单接续验证已完成；最终 Spec、凭据/索引核验和关票读回仍由主 Agent 完成，本文不自行宣布已关闭。

## 新发现与修复范围

首次 `generateTts` 在创建 RPC 后才设置 `narration_enabled=true`，真实成功任务未获得 `native_output_namespace`。进一步检查发现，TTS 自动创建的对齐任务也可能早于其 capability 开关。040 将输出归属绑定到 `input_task_allowed` 的领取资格，因此单独移动 TTS 更新顺序不足以覆盖自动任务。

纯 TS 补修将 TTS 启用更新移至同一事务内的创建 RPC 前。042 则仅替换 namespace 触发函数的 INSERT 归属条件：已全局启用的 native Episode、12 类既有支持任务、`ready` 且 attempt 0 的新任务，先冻结独立 task 路径；是否允许领取，仍由原 capability 开关与原函数决定。

042 不修改已应用的 040，不回填历史任务，不改变 UPDATE/claimed 不可变规则、路径验证、租约、预算、领取函数或权限。未管理、全局未启用及其他 legacy 任务保持原行为。039、040、041、042 分别属于已获批准的必要范围；#146/#147 的 SQL 建议继续暂缓。

## 实际验证

| 边界 | 已核验结果 |
| --- | --- |
| 首次 TTS | 真实 Owner HTTP 与 PostgreSQL 先复现 namespace 缺失，再验证新任务输出归属；创建 RPC 失败时启用标记、草稿及任务均回滚 |
| 自动任务早于 capability | 真实 PG 覆盖 12 类支持任务；所有 capability flag 为 false 时，自动对齐和首次 TTS 的新输出仍获得 task namespace |
| 隔离与领取分离 | 同类型两个新任务获得不同 namespace；flag 为 false 时真实 claim 不返回任务，显式开启后才可领取 |
| 原围栏保持 | 创建事务内 UPDATE、task 身份及路径校验保持；已领取输出变更被 `22023` 拒绝；旧任务和非 native/未启用任务未改写 |
| 正式应用 | 042 仅登记于本轮新隔离库；重复应用幂等。旧业务行、先前迁移记录、dispatch/claim/lease 函数字节及 CLI/Provider 账本均不变 |
| 主区 042 复验 | 真实 Owner HTTP/PG 2/2 通过，默认 5000ms；9 个既有业务/迁移表指纹和两份 Provider 账本保持，外层事务与 SAVEPOINT 全回滚 |

042 文件 SHA-256 为 `3354f8f837b2f306d0361f6ec88852d12a7bbef826d2f9590dd28898e295f67c`。真实 PG 的 fixture 验证没有执行器或 Provider 执行，`businessWorkflowAcceptance=false`；TTS HTTP 集成测试仅以 readiness/wake 替身阻止外部执行，关键路由、事务、文件检查与 PostgreSQL 触发器均为真实实现。不能把它们称为普通持久化业务提交或新的在线合成实证。

## 历史证据与接续边界

原自然 30 分钟租约、真实旧执行器晚写、三组 COMMIT/断连/SQL 错误恢复、两次薄 CLI 核对及旧 callback 拒绝证据继续保留；本次没有重跑第二次 30 分钟计时，也没有把旧成功样本改写为新源码全链。

此次已接纳的 TTS 和旧自动对齐任务在 042 前创建，保持原输入、路径和记录，不能据此宣称它们已迁入新 namespace。最终同单链已在最终源码正常重启后读取这些结果，并完成新的本地 clip、preview、review/final 与本机发布包；新 clip `cb4446b0-19ad-4811-b6bb-e18f8c7d8380`、review `f5ed5d41-059a-4f9a-961a-5d1aa322a37e` 和 final `e92bd34a-ddbd-492b-96af-fe57057fc4a7` 的输出均在各自 task namespace。21 个产物的正常 Owner HTTP 与磁盘字节一致，重启后的生产单投影和两个调用账本保持。

最终 [43 项源码清单](source-final-native-local-followthrough.json) 聚合 SHA-256 为 `207c8547fba52862d4e9bf535605f7b41d23c15d343dd4ee701b98abeb1852a8`。这证明最终源码下的可追溯同单接续，不能称整条成功链从开始便运行于该完整 SHA。前段真实外部调用由未变模块和冻结记录继承，受影响的本地路径形成新记录；详见 [同单最终报告](report-142-final.md)。

在所有产品补修之后，主区裸 `npm test` 为 113 文件、894/894，默认超时不变，构建及 TypeScript 通过。本地裁剪预检只允许既有 `media_enabled=true` 的范围走本地检查，并以 `SELECT ... FOR UPDATE` 锁定该行；首次启用仍走原完整门禁。真实 PG 三项回归还验证了过期策略下未启用媒体的 HTTP 409、实际 planner/claim 为 0、零 secret/transport，以及已启用本地调用不改 dispatch flags；两份前序 hard 报告和最终 Standards 通过结论均保留。

文件系统与数据库仍非共同原子事务，回执 SHA 不构成同 UID 恶意进程隔离；原报告中的这些限制仍有效。两段本轮新调试原文的缺失另见 [证据缺口说明](evidence-gaps-current.md)，不得泛称所有失败 raw 均完整保留。

未提交、推送或进入 E/F；原有历史失败和所有尚未验收的门禁继续保留。
