# 退役 SQL 入口与旧运行包兼容清理

日期：2026-11-13。结论：12个目标中只删除确认无当前/SQL/旧包消费者的4个，保留8个旧包兼容边界。175已应用日常库；保护不放宽，不提交、不推送。

## 逐项决定

| 处理 | 对象 | 依据 |
| --- | --- | --- |
| 删除 | `local_identity.plan_input_tasks_before_workspace_audio(uuid)` | 有效SQL无调用/目录依赖，当前源码和保存的23个运行包无引用 |
| 删除 | `public.apply_episode_configuration_repair(uuid,jsonb,text,text)` | 同上；旧包调用的是v2版本，不依赖此原始签名 |
| 删除 | `public.generate_shot_tts(uuid,uuid,text,boolean)` | 同上；旧本机请求使用保留的Owner包装函数 |
| 删除 | `public.generate_confirmed_shot_tts_batch(uuid,uuid)` | 同上；不参与当前显式旁白请求和历史回执 |
| 保留 | `local_identity.plan_input_tasks(uuid)` | 16个保存包的Worker数据库模块仍有启动权限检查和规划调用；必须保留签名/ACL及原Worker身份后的0A000拒绝，不能恢复派单 |
| 保留 | `local_identity.script_production_scopes()` | 23个保存包携带仍可调用的旧扫描器，明确查询此函数。继续返回空集合，历史启用记录不会被扫描执行；不能删除或改成发现历史行 |
| 保留 | `local_identity.queue_workspace_planning`、`replan_workspace_planning`、`save_planning_selection` | 各有16个保存包保留相应规划SQL调用；继续先校验Owner再拒绝 |
| 保留 | `local_identity.generate_input_shot_tts` | 21个保存包中的旧旁白命令/工作区模块仍引用；保留Owner隔离及0A000退役拒绝 |
| 保留 | `public.apply_episode_configuration_repair_v2`、`apply_external_connection_repair` | 各有21个保存包保留修复SQL调用；保留Owner隔离和退役拒绝 |

这8个接口在当前产品源码和有效SQL中没有消费者，但不能据此认定旧包契约也已消失。包中包含当前不再挂载的遗留模块；本次验证其可调用API兼容边界，不声称23个包都在日常启动相同扫描器。若以后要继续删除，应先明确退役相应旧包或迁移其调用契约，本轮不改写、不删除任何旧包。

有效函数体及目录依赖已逐项核对，PL/pgSQL调用也按函数体检查，不单凭 `pg_depend` 为空判断。旧包引用文件、SHA-256和包ID见 `runtime-audit.json`；完整包树摘要及被执行模块见 `bundle-inventory.json`。175只含4条明确签名DROP FUNCTION，使用默认RESTRICT；没有CASCADE、权限授予或数据改写。移除3个陈旧公开RPC类型，保留当前业务实现、触发器和全部历史SQL原文。

## 真实旧包兼容验证

将23个实际保存包逐字节复制到私有目录，通过其原JS导出模块访问隔离PostgreSQL；不加载日常部署或秘密，不修改原包。

- 46个Worker数据库模块的实际启动身份/权限检查通过。32个旧规划端口继续收到0A000；其余14个模块的无规划端口返回0。
- 实际执行23个扫描器的 `wake()`，逐次真实查询均成功且返回0行，没有被内部catch掩盖的SQL错误，没有执行回调，也未改写历史启用记录或任务。
- 夹具明确含 `enabled=true` 的历史整期授权，防止用空表掩盖错误派单；所有保留的Owner包装继续0A000，其他Owner仍42501。
- 当前原生Worker的 `plan()` 仍返回0；没有恢复旧定时器到当前应用，也没有授予旧功能执行权。

验证使用实际模块和真实SQL连接；连接观察包装仅记录结果和错误，没有mock数据库。检查了模块副本的原始SHA，并在日常应用前后重新核对23个原包的完整树摘要。

## 迁移与完整验证

非空旧脚本、任务、规划选择及启用授权先按174完整导出恢复，再执行175。对账所有业务表及字段摘要、序列、角色、目录/函数/触发器和ACL；排除明确4个函数后，其余对象精确相等。意外视图依赖以2BP01阻止迁移，中途注入错误整笔回滚；历史ledger不变，新迁移只加1条，重复计划为空。删除后的Owner/Worker SQL调用均为42883且不写历史；空扫描边界仍返回0行。

| 检查 | 实际结果 |
| --- | --- |
| 默认回归 | 单次291文件、2108项通过，0失败/跳过 |
| 迁移、旧包、保留修复/旁白边界 | 4项集成通过，含上述46个Worker模块及23个扫描器 |
| 当前旁白、单次确认、原生编辑 | 19项集成通过；未知提交、显式重试、输入冻结、费用预留、确认消费回滚等保护保持 |
| 交付、发布恢复、旧attempt、预算历史 | 10项集成通过；包含journal/receipt/config/ready四处SIGKILL及真实Owner恢复文件读取 |
| 回收与恢复 | 6项集成的最新结果全部通过；Owner/CSRF、离线/变更文件、未知/运行中阻断、配额、硬链接、并发恢复、原ID/原字节/原归档状态及迁移校验和 |
| 类型与编译 | TypeScript、Worker/backend准备和差异空白检查通过 |
| Schema矩阵 | 空库、083前缀、历史完整升级、旧连接、故障回滚、幂等、数据/序列/保留权限与目录一致通过；120张表，安全对象559个 |

合计39个不同集成用例的最新结果通过；模块执行不额外算成独立测试。默认回归后只调整测试夹具/开关，业务代码和175迁移未变，受影响测试及类型检查重新验证。摘要见 `verification-summary.json`，逐次日志和JSON均保留。

第一轮恢复组因专属回收开关未开启而跳过6项，随后明确开启并执行了全部6项，不能把跳过计为通过。该轮5项行为通过，1项过时断言失败：fresh clean-v2库不应伪造160历史ledger。修正为“旧记录存在则原校验和保持、新clean库不补假记录，并校验归档SQL摘要”，只重跑该项后通过。原整轮失败保留在 `compatRecycle/`，未改写成整轮全绿。

回收测试中旧派单返回空的预期也按170已经生效的拒绝合同改成0A000；产品函数没有改为放行或空成功。其余8个保留函数的定义/ACL、Owner和HTTP 410/404边界、旧快照领取过滤、单次费用、未知提交、租约、产物冻结和发布恢复保护均保持。

复验命令：

```sh
LOOP_TEST_COMPAT_RELEASES_ROOT=<copied-packages> node scripts/e2e/run.mjs src/local-app/retiredSqlRuntimeCompatibility.integration.test.ts src/local-app/retiredLegacyExecution.integration.test.ts src/local-app/retiredNarration.integration.test.ts --exclude '**/storyE2e.integration.test.ts'
LOOP_RECYCLE_ACCEPTANCE=1 node scripts/e2e/run.mjs src/local-app/recycleBin.integration.test.ts --exclude '**/storyE2e.integration.test.ts'
node scripts/e2e/clean-schema.mjs
npm run runtime:prepare
npm run check
npm test -- --maxWorkers=2
```

## 日常应用与恢复

完整私有SQL导出先恢复到同集群独占候选，逐项对账，再演练175；再次核对日常无漂移和原包字节后才执行同一迁移事务。

- 120张非ledger表、203行、全部序列、角色和历史ledger精确保持，ledger从172增至173条。
- 仅删除4个目标函数；其余全部catalog、函数、触发器、RLS/ACL保持，8个兼容接口原定义及权限不变。
- 23个原运行包字节、原冻结旧库、配置和App记录保持；PID51263、HTTP200，未重启或切库。
- 候选确认无客户端后删除。完整导出和前后快照保留于 `.loop-control/local/rejection-entry-cleanup-175-3d1bcc86885e/`，结果见 `daily-result.json`。
- 5个E2E容器及schema容器已移除；确认无关联进程后清理本轮13份源码、SDK、独立依赖及旧包临时副本，保留原运行包、证据与恢复材料，详见 `cleanup.json`。

验证边界：旧包验证针对本次SQL契约涉及的真实模块，未启动整套旧服务或重新开放旧制作；未做真实付费生成和成片质量评估。日常当前无实际任务，当前制作与恢复结论来自隔离HTTP/Worker/SDK集成。原运行包、历史数据及既有恢复材料不清理，不提交、不推送。
