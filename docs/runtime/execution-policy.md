# 当前运行包的执行协议

D阶段实施中；此门槛不代表旧计划迁移、旧SQL退役或完整A–G已经完成。权威检查为`src/orchestration/runtimeBuild.ts`，依据ADR-0066。

新准备包采用manifest v5和`production-workspace/v1`，协议与manifest版本一起进入版本身份哈希。当前应用工厂、Worker服务／CLI和prepared入口复用检查；完整v4包明确返回`runtime_release_retired`，损坏或身份不符仍是`runtime_release_invalid`。显式prepare建立新的完整目录并原子发布新指针，不覆盖已保存运行包。

原23包保留原字节，只用于历史及冻结来源证据。16个v4清单还登记了`scripts/runtime/codex.mjs`，归档验证会核对该已登记文件的安全实际路径和哈希；不会执行，也不复制入v5。输出集合按准确路径和哈希逐项比较，字典插入顺序不影响文件一致性，原身份哈希仍核对原清单编码。

验证范围包括：有效v4的实际CLI拒绝且未进入Worker模块、完整性与退役的区分、不能仅改标签冒充当前版本、显式prepare新包成功且旧包不变、实际应用工厂在读取DB配置前拒绝旧包，以及23个真实原包逐包拒绝和文件树前后哈希保持。最终固定副本T1smBE已完成全类型、21项定向单元／原包检查及3文件5项实际HTTP／Worker／正式交付／原生恢复联验，均通过且无skip；旧flag遗漏批次不计通过。证据见`docs/verification/current-workflow-replacement-20261113/evidence-d-runtime/`。

此门槛控制当前受支持入口，不终止已在运行的进程，也不是对Owner任意手动执行旧文件的OS权限隔离。日常尚未prepare、部署、重启或切换；撤SQL合同前须在授权的日常切换中核对并停止旧消费者。后续再撤下执行合同时必须提升执行协议，确保早期过渡包不会永久获得执行权。历史工程和未知／在途请求通过当前恢复器接入，不靠重新运行原包或自动重发供应商恢复。
