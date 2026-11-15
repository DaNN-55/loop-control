# ADR-0055：按旧运行包依赖清理退役 SQL 入口

状态：Accepted。日期：2026-11-13。用户授权检查11个退役拒绝入口及 `script_production_scopes()`，只清理当前功能、旧运行包和历史恢复都不依赖的对象，不放宽保护，不提交、不推送。

当前有效SQL中12个目标无函数调用者或目录依赖，当前产品源码也无执行调用。继续检查保存的23个运行包发现，8个目标仍被旧包中的SQL端口或可调用扫描器引用。不能以当前源码没有调用为由删除旧包兼容边界。

175只删除4个无上述消费者的明确签名：`local_identity.plan_input_tasks_before_workspace_audio(uuid)`、`public.apply_episode_configuration_repair(uuid,jsonb,text,text)`、`public.generate_shot_tts(uuid,uuid,text,boolean)`、`public.generate_confirmed_shot_tts_batch(uuid,uuid)`；移除3个陈旧公开RPC类型。使用默认RESTRICT，不使用CASCADE、数据改写或新增权限；不修改不可变历史SQL或任何旧运行包。

保留8个接口的原定义及ACL：

- `local_identity.plan_input_tasks`：部分旧Worker的启动权限检查和规划端口仍查询此签名；继续按原Worker身份边界以0A000拒绝，不恢复派单。
- `local_identity.script_production_scopes`：旧包扫描器仍调用；继续返回空集合，使历史整期启用记录不被再次发现，不删除历史表。
- `local_identity.queue_workspace_planning`、`replan_workspace_planning`、`save_planning_selection`：旧包规划命令仍保留这些SQL调用，继续先校验Owner再明确退役拒绝。
- `local_identity.generate_input_shot_tts`：旧包旁白请求仍调用它，保留Owner隔离及退役拒绝。
- `public.apply_episode_configuration_repair_v2`、`apply_external_connection_repair`：旧包修复命令仍调用，保留Owner隔离及退役拒绝。

保留是本次旧包兼容条件下的决定，不表示这些入口永不可删除；进一步删除须先明确退役相关运行包或迁移它们的调用契约，本轮不扩大范围。

验收须使用真实保存包的Worker启动/规划和扫描器导出模块连接隔离数据库，验证启动检查仍可完成、旧派单仍拒绝、扫描为空且不执行动作或改写历史；不能仅以文本匹配代替执行。非空历史先完整导出恢复再迁移，比较所有业务行、序列、角色及保留定义/触发器/ACL，覆盖意外依赖、事务回滚和幂等。当前单次确认、费用/未知结果、领取、冻结产物、当前制作和恢复保持。

日常应用前保留完整私有导出并恢复候选演练，再核对无漂移后执行175；不重启、不切库、不删除原冻结库或既有恢复材料。逐项证据和实际结果见 `docs/verification/retired-sql-runtime-compat-20261113/REPORT.md`。
