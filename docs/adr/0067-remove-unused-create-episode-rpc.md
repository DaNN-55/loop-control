# ADR-0067：退役无消费者的旧建单 RPC

状态：Accepted，日常未应用。日期：2026-11-13。

Owner 批准全面替换方案后，先移除已核查无当前消费者、保存包引用和恢复依赖的 `public.create_episode(uuid,uuid,uuid,text,boolean)`。当前创建通过 `createEpisodeDirectory → local_identity.create_episode_from_intent` 完成 Owner 校验、稳定目录与持久意图，不再提供第二个只插入业务行的旧入口。

186 使用明确签名、默认 RESTRICT 删除该函数，并移除陈旧的生成 RPC 类型；不删除业务或历史行，不改其他函数、角色、序列和 ACL，不修改基线或已采用迁移。意外依赖阻止迁移，失败回滚；隔离验证当前 HTTP 建单、同键重放的目录 inode、跨 Owner、非空完整恢复及新旧 schema 收敛。日常仍使用原版本，未因新增迁移文件而自动应用、部署或重启。
