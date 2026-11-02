# 原生产物发布结果核对与恢复

本说明处理文件已经开始发布、但数据库提交结果无法确认的本地 Worker 尝试。它与 Provider 提交未知的恢复机制分别处理不同边界。恢复只核对和登记已有产物，不调用 Provider，也不自动采用候选。

## 前置条件

目标环境已按正常更新流程应用 `133-native-output-publication-fences.sql`，并完成对应源码的 `runtime:prepare`。本轮开发只在隔离数据库和隔离编译目录验证，未迁移或重启日常环境。更新日常环境仍须遵守现有服务更新授权。

## 查询待核对任务

在目标项目根目录运行：

```sh
node scripts/runtime/recover-native-output.mjs
```

命令只读取发布保护登记，输出任务 ID、Episode ID、零起始尝试序号和 `pending_reconciliation`。不输出数据库认证材料、租约或文件路径。普通页面中的任务状态仍为 `running`，没有新增状态按钮。

该列表只包含数据库尚未完成的受保护尝试。若实际提交已经完成但确认丢失，任务可能不在列表中；可根据本次 Worker 的 `native_output_publication_unknown` 消息或 `worker-publication-unknown` 事件，使用原任务 ID 和尝试序号执行核对。

## 显式恢复

确认目标任务和尝试后运行；将示例 UUID 与序号替换为实际值：

```sh
node scripts/runtime/recover-native-output.mjs --recover --task 10000000-0000-4000-8000-000000000001 --attempt 0
```

命令自行从数据库查找当前租约和存储位置，不接受手工文件路径。它验证私有发布凭据、冻结输入、目录身份、数据库结果及候选和旧文件指纹。成功返回 `status: completed`；`registered: true` 表示补登记原结果，`false` 表示结果已经登记。再次核对保持同一任务和尝试，不重复生成。

## 拒绝恢复时

保留本次尝试的 staging、私有发布凭据、旧文件备份及数据库登记，依据具体错误核对原目录和输入。不要手工将任务改为 `ready` 或删除发布保护记录来重试。

保护登记后、私有发布凭据落盘前强制退出，可能留下没有完整凭据的受保护任务。凭据损坏、已取消或失效、目录身份变化，以及目标文件出现无法识别的字节，也会阻止自动恢复。这些情况需要针对原现场调查，当前命令不会猜测结果或解除保护。

设计依据见 [ADR-0023](../adr/0023-native-output-publication-reconciliation.md)。
