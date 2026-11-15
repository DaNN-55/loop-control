# ADR-0056：移除无消费者的旧云端连接 RPC

状态：Accepted。日期：2026-11-13。

## 背景与决定

用户授权检查剩余 5 个旧云端连接 RPC，只删除当前功能、保存运行包及历史恢复均不依赖的入口，不放宽保护，不提交、不推送。

有效目录中的 5 个签名都只抛 `0A000`，仅 postgres 有执行权限；无有效 SQL 函数调用者或传入目录依赖。当前源码只有陈旧 RPC 类型，23 个保存运行包的完整文件扫描均无引用。

以新增迁移 176 明确删除 `public.create_external_connection(text,text,text,text)`、`public.rotate_external_connection(uuid,text,text,text)`、`public.delete_external_connection_version(uuid)`、`public.resolve_external_connection_secret(uuid)` 及 `public.resolve_external_connection_secret(uuid,uuid)`。使用默认 RESTRICT，不使用 CASCADE；移除相应 4 个类型条目，不修改历史 SQL、schema 导入器、旧运行包或其他函数。

当前连接命令经 Owner HTTP、会话/CSRF、`LocalConnections`、不可变秘密引用与 `local_identity.apply_connection_intent` 完成创建、轮换及重新绑定。Worker 经 `connection_version` 解析绑定，由 SecretStore 读取秘密；这些路径不调用旧云端 RPC。保留连接与版本、binding/intent/qualification、历史冻结引用、撤销及验证函数，保留恢复后重新绑定要求，不迁移或重新公开秘密。

## 验证与影响

验证非空连接版本、旧冻结引用、绑定和 intent 的完整导出恢复，再迁移；比较所有业务行、序列、角色、其余目录/ACL 和旧 ledger，覆盖依赖阻断、注入失败回滚及幂等。实际保存包的连接模块在隔离 PostgreSQL 上执行本地命令，验证原包契约；当前 Owner HTTP、SecretStore 边界、生成确认、Worker 与恢复另行回归。

仅删除无权限且无消费者的退役接口；旧 SQL 文本仍可用于历史恢复，恢复到当前版本时由同一前向迁移移除。日常应用前完整备份、候选恢复演练及无漂移核对，原冻结旧库、恢复材料、运行包和服务保持。实际证据见 `docs/verification/retired-cloud-rpc-20261113/REPORT.md`。
