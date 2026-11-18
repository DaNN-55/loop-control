# 六项集成失败诊断与修复


> 产物清理记录（2026-11-18）：本目录的历史测试生成附件已按用户要求清理；本文验收结论保留。源测试输入、恢复资料、生产单和数据库未删除。

日期：2026-11-13。结论：六项原失败均为过时的测试前提或预期，未发现需要修改产品实现的功能缺陷。本轮只修改两份集成测试和验收记录，没有修改业务实现、SQL、权限或保护规则。没有提交、推送或重启日常服务。

## 逐项结论

| 原失败 | 分类与原因 | 修正及保留的保护 |
| --- | --- | --- |
| 冻结路径及发布身份 | 夹具过时：只构造路径就期望有效；插入历史 artifact 后就期望旧前缀被授权 | 使用真实 Owner 冻结登记；登记前拒绝，登记后通过；错误大小、SHA、字面前缀、其他订单路径仍拒绝。无完成迁移证明的旧路径仍拒绝，历史 artifact 原值保留；发布身份不可覆盖及路径检查保留 |
| 新鲜 Studio 任务作用域 | 夹具缺少当前冻结登记，触发 `Frozen Studio task differs` | 先按当前生产流程登记，再作用域化；精确输入、任务输出命名空间、冻结指纹及 producer 绑定通过，错误 SHA/大小仍拒绝 |
| Freesound 准备首次调用 | 预期过时：把整期启用当作必要授权；夹具已自动完成单次确认 | 使用 raw 请求验证未确认调用返回 409 且无任务；经确认请求成功，且不新增整期授权。真实 Worker 失败、重试、来源记录、采用和重启恢复继续验证 |
| 原声短于调整后视频 | 操作前提过时：TTS 采用会静音独立原声，但保留原生联动；直接延长视频先被联动保护拒绝 | 先验证越界 409 且工程 hash 不变；经真实 Studio 项目存储边界显式解除该组联动，再延长视频，继续验证短原声混入 409 且工程不变 |
| 非原生工程自动配乐 | 预期过时：ADR-0049 已退役全部旧自动派单，而非仅原生工作区 | Worker planner 返回 0，旧 SQL 入口按原权限返回 `0A000`；完整任务和历史 review package 保持。删除夹具中禁用蓝图触发器的设置，不恢复旧派单 |
| 非零原声窗口及部分覆盖 | 操作前提过时：删除范围会裁掉完整字幕，当前保护正确拒绝 | 先验证 409 及工程不变；Owner 保留完整字幕正文并显式重校时后删除范围。原始提取窗口、真实音频频率/渲染、覆盖状态和变速后对齐拒绝继续验证 |

依据：生产冻结登记见 `src/local-app/studioCommands.ts`；冻结/位置判定见 `db/current/baseline.sql` 的 `register_owned_studio_freeze`、`owned_studio_frozen_reference`、`episode_current_reference`；音画/字幕边界见 `src/workspaceShots.ts`；授权见 ADR-0024，旧派单退役见 ADR-0049。只读独立复核确认：历史 artifact 存在不等于旧路径获得授权，完成迁移证明不可省略。

## 复现与复验

原命令在独立 PostgreSQL、HTTP、Worker 和临时媒体环境复现 **6 失败、4 未选中**，见 `reproduce/`。使用隔离运行器，不加载日常部署和凭据，不请求付费生成。

```sh
node scripts/e2e/run.mjs src/local-app/nativeStorageSql.integration.test.ts src/local-app/workspaceAudio.integration.test.ts --exclude '**/storyE2e.integration.test.ts' -t 'effective SQL120|fresh Owner Studio scope|Freesound preparation|source mode uses|retains the legacy soundtrack path|nonzero source extraction'
```

最新逐文件结果合计 **19 项不同集成用例通过、0 跳过**，其中原两文件完整 10 项、相邻保护 9 项。不是一次整组全绿运行；完整组合的中间失败及随后修正记录均保留。

| 检查 | 最新结果 | 证据 |
| --- | --- | --- |
| workspaceAudio 完整文件 | 8 通过 | `combined/` |
| 单次调用确认 | 6 通过 | `combined/`：过期/变更确认、重复消费、失败回滚、预留冻结 |
| 音频选择 | 2 通过 | `combined/`：查询/连接冻结、无效选择拒绝、独立采用 |
| nativeStorageSql 完整文件 | 2 通过 | `storageFinal/` |
| 真实目录迁移及旧引用恢复 | 1 通过 | `storageFinal/`：执行目录迁移、旧目录离线、重启和多次收纳后旧引用仍映射到当前位置 |
| workspaceAudio 单测 | 4 通过 | `audio-unit.json` |
| TypeScript | 通过 | `check.log` |

完整组合命令：

```sh
node scripts/e2e/run.mjs src/local-app/nativeStorageSql.integration.test.ts src/local-app/workspaceAudio.integration.test.ts src/local-app/workspaceCallConfirmation.integration.test.ts src/local-app/workspaceAudioSelection.integration.test.ts --exclude '**/storyE2e.integration.test.ts'
```

该次 17 通过、1 失败：新增历史保留断言把 PostgreSQL `bigint` 的字符串结果与 JS 数字比较。修正预期为原始返回字符串后，只重跑受影响存储组及迁移正向组：

```sh
node scripts/e2e/run.mjs src/local-app/nativeStorageSql.integration.test.ts src/local-app/episodeCollectionMove.integration.test.ts --exclude '**/storyE2e.integration.test.ts'
npm run check
npx vitest run src/workspaceAudio.test.ts --maxWorkers=1
```

更早的存储定向复验暴露旧路径正向预期同样过时，见 `storageIntermediate/`；没有修改 lineage 判定来满足旧断言。测试前后和最新隔离副本 SHA-256、各次测试计数及隔离 SQL 摘要见 `summary.json`。

## 状态与边界

日常库只读前后核对：业务行摘要、catalog、安全对象/ACL、序列、ledger、角色均一致；App 记录一致，PID 51263。本轮没有迁移或写入日常库。含私有状态的原始快照保留在 `/private/tmp/loop-six-failures-20261113/`，不进入仓库。

工作区同时出现另一组 172 SQL 清理及退休测试改动；本轮保留其内容，不计为本轮交付，也不将这些改动宣称为已应用日常库。隔离源码包含的 SQL 字节摘要已记录，可区分验证代际。

没有重跑全部默认回归或全部集成；此前 2098 项默认通过是上一轮验收事实。本轮验证边界为上述 19 项集成、4 项单测及类型检查。没有真实供应商生成、付费调用或人工 UI 操作；Studio 使用实际 SDK 项目存储和保存/关闭接口。完成迁移后的历史引用正向覆盖来自真实目录迁移，未额外伪造 lineage 来专测旧冻结文件。

独立只读审查两份测试的前后差异，无阻断问题：未取消保护，未通过 SQL 直写绕过原生编辑边界。额外边界：SQL 夹具的登记和任务写入分属两个事务，本测试未单独覆盖生产同事务回滚；字幕修正验证保留全文的 `independent` 重校时路径，不额外覆盖 `follow_tts`。

各次本轮运行器均已删除自有测试容器；保留日志和测试结果，清理本轮临时源码与 SDK 副本，保留此前回退库及恢复材料。
