# 清理与 Worker 镜头协议：已迁移

2026-11-10。用户条件授权：复测通过后迁移已核对部分，然后仅隔离实施3.5。本轮未提交、推送或产生付费请求。

## 当前结果

- 已迁移90个文件：59修改、12新增、19删除。包含已核对的旧六节点清理、现用组件独立、统一当前镜头语义、Worker协议与顶部工具区修复，以及本轮数据库断线保护和已过时测试校准。
- 新视频任务使用 `generate_shot_video / shot_video_generation`；检索和预览为 `search_shot_video / shot_video_search` 与 `preview_shot_video / shot_video_preview`。Worker继续支持历史任务名、payload、产物和Provider提交恢复。现用素材用途为visual_reference。
- 仅新增并应用156。此前152条迁移版本及SHA完全保持，未重写历史139；156已在实际有效schema克隆中预演通过后事务应用。
- 日常5174为PID99148，固定运行包 `72280b51d5139b8acba9d2c92febda09c696fcc8a2fc6be9106c721c42988fa6`。HTTP200，运行包源码及输出完整性通过，90文件逐项SHA与核对内容一致。
- tasks18、episodes6、artifacts33、audit_events113、production_material_revisions42：应用156前、应用后、日常重启后指纹全部一致，没有待运行任务。

## 复测

- 最新全量：252测试文件，1808通过、1跳过。类型、Worker／后端运行包构建及完整性通过。
- 35条真实隔离集成：15条当前语义／并发锁／防重恢复／Pexels全流程、17条模型及实际Worker参数矩阵、1条155→156真实升级、2条应用／Worker真实PostgreSQL断线恢复。Provider响应受控、文件／SQL／HTTP／Worker／媒体探测真实执行，费用0。
- 旧任务在155时提交，升级156后原行和冻结输入保持，恢复只轮询原Provider ID，不重复POST；随后新任务采用新协议完成。新旧混合并发与原生输出不可变保护通过。
- 原有8组宽窄页面和Owner API／服务目录等价核对保留，见[迁移前协议报告](../shot-protocol-cleanup-20261110/REPORT.md)。正常日常使用的供应商画质与网络不作为受控测试的已验证结论。

## 本轮发现和处理

全量首轮16条失败在主源码基线同样存在：7条因构建物被前端构建清空，9条为控件改版后测试仍引用旧菜单／位置。顺序准备运行包，并校准4个现有测试文件至当前真实控件；不删除关键保留、竞态和采用断言。最终1808项通过。

并行运行3个隔离PostgreSQL时，2GiB Colima发生内存压力，日常数据库checkpointer被SIGKILL并自行恢复。旧应用checked-out pg Client未处理error事件而退出；本轮已在应用与Worker Pool补事件处理，查询仍按Promise拒绝，不自动重复写入。通过真实隔离终止连接验证应用仍存活、后续连接恢复、普通SQL错误仍返回。测试改为串行，临时容器限512MiB、shared_buffers32MiB；已停止本次旧5192／5194预览及其自有容器，其他会话服务保留。日常重新启动后未观察到未处理异常；仍有既有pg并发查询弃用提示，不宣称已解决该提示或性能已提升。

## 恢复边界

精确文件清单及前后SHA见[migration-manifest.json](migration-manifest.json)，运行及数据证据见[runtime-and-data-after.json](runtime-and-data-after.json)。原始代码备份、schema-only备份、9个有效函数、原迁移账本、旧运行包及受保护的156回滚SQL位于 `.loop-control/maintenance/shot-protocol-migration-20261110` 与原runtime-releases。所有源文件恢复字节已逐项校验。未执行回滚；产生新镜头任务后回滚SQL会拒绝退回不兼容schema。

3.5为独立快照，仅有1个产品CSS文件变更，尚未迁移，见[3.5核对说明](../narrow-window-review-20261110/REPORT.md)。
