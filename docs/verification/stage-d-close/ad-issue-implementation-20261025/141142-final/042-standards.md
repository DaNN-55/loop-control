# #144 / 042 native output ownership Standards 审查

审查对象：`042-native-output-ownership.patch`（SHA-256 `0481e969f217270d49561500686559ebbb6d00b0ee5ebc8e1a56c9b739c58fc6`）、manifest 与 `042-after-green-result.json`。主区三文件 SHA 均与 manifest 新值一致。未执行 SQL、服务、网络或测试。

## Critical issues

无。

## Important improvements

`042-native-output-ownership.sql:7-10` 只替换 INSERT 早退条件：受全局 `input_episodes.enabled` 管理的未来 ready、attempt 0、12 种本机任务会先拥有 task namespace；具体 capability flag 仍只由未改动的 `input_task_allowed` 决定 claim、lease refresh、结果回写与恢复。因此自动 alignment/首次 TTS 可在 flag 打开前冻结输出身份，但不能被领取或实际执行。

新函数的 UPDATE、claimed-output 不可变、路径验证和 task-id namespace 逻辑与 040 对应函数逐字一致；042 没有重建 trigger、改变授予权限或修改历史 task/run/预算/失败行。`CREATE OR REPLACE` 保留 040 已撤销的 PUBLIC 权限和现有 trigger 绑定。

`scripts/local/migrate.mjs:7` 与 `scripts/local/native-restore.mjs:41` 都将 042 排在 040/041 之后；迁移记录 SHA 检查和 restore 的前向/原子登记仍保留。每次 INSERT 仅增加按 `episode_id` 判断管理归属的 EXISTS，较原先 `input_task_allowed` 的同类查询更窄，不见锁顺序、CLAIM 权限或预算性能回退。

读取的绿证据声明真实 PostgreSQL 覆盖 12 类型、flag 前 output ownership、flag 前 claim 拒绝、flag 后实际 claim、已领取不可变、同类型隔离、旧未管理 task 不改，以及回滚/零 Provider 请求；其 `businessWorkflowAcceptance:false` 正确保留，且 migration 尚未持久登记。未在本审查中重跑。

## Optional notes

无可报告的新增 smell 或范围扩大；146/147 未涉及。

## Verification suggestions

在获准的隔离库持久应用后，再记录 migrate 与 restore 各一次的 schema_migrations SHA、trigger 指向和相同 claim/flag 不变量；这是一项落库验收门禁，不是当前代码缺陷。
