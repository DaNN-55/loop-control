# 紧凑设置迁移与四类回执交付

2026-11-11。主Agent实施流程4/5/17/24；子Agent迁移紧凑设置并独立复核48项。发送阶段、原操作恢复与紧凑连接/密钥聚合界面均已正式启用，48类逐项代表性验收完成。

## 流程结果

- **4 未发送/明确拒绝**：新协议将准备、预留、进入发送、收到有效结果、明确拒绝持久化到私有事实表。临时准备故障只在仍未进入发送且冻结输入/租约有效时恢复，跨attempt合计最多2次；参数、权限、输入变化不自动恢复。发送标记回执不明、断线、5xx、坏响应均不按未发送处理。旧submission/reservation没有新事实时继续保守未知。
- **5 本机回执未知**：断线/503后只读查询同一Owner、幂等键和完整请求的已提交回执。命中恢复原成功结果；缺失继续未知，不自动POST。工作台提供重新读取。删除清单复用正常公开投影，不返回私有清理目录/manifest。无持久回执的预览/原清理恢复和运行会话打开入口沿用各自显式恢复协议。
- **17 图片**：共享发送事实与未发恢复预算。完整图片文件经验证并形成fsync私有发布凭据后，才在发布事务中登记received；后续登记、文件发布、COMMIT失败保留hold，只恢复原文件。未知的新生成仍须重新确认费用风险，保留原任务。旧协议曾提前记录received：仅当任务已停止、没有任何新协议事实/发布hold/原供应商任务ID时，允许同样的风险确认替代；新协议received始终优先原文件恢复。
- **24 口播**：共享同一分类、恢复和发布机制。未知后先核对原任务，只有新的风险确认才创建带retryOf的唯一子请求；原记录/预留不变，新结果只成候选。新完成任务不再被旧未知优先投影遮蔽。没有全期默认时，界面回填当前镜头已经保存的模型、音色和语速，不覆盖已有默认或草稿。

供应商明确拒绝包括HTTP 4xx（408除外），以及首个音频之前的已知语音业务错误45000000/45000001；部分音频、未知代码、坏SSE和5xx继续保守未知。参考[供应商官方错误码](https://docs.volcengine.com/docs/doubao-voice/error-code-query-1?lang=zh)。不根据拒绝状态宣称供应商一定未扣费。

## 验证与修正

|证据|结果|
|---|---|
|[发送边界红测](narration-boundary-red.log) → [修复后](narration-boundary-green.log)|4个真实executor受控边界：2种未发送、断线、无效音频；修复前3失败，修复后4通过。|
|[原回执/原产物最终复验](receipt-post-review.log)|10项真实隔离HTTP/PG/files/Worker通过。跨attempt预算2次、旧reserved复用只发1次、旧未知保留、received登记失败、COMMIT回滚/成功但回执丢失均只恢复原产物、明确新口播风险确认、SSE明确拒绝、Owner/hash/CSRF/删除投影。|
|[图片/视频/口播原状态集成](receipt-integration-final.log)|该日志中5项workspaceGenerationState均通过，含图片unknown显式新生成、明确拒绝、视频原ID继续、原产物恢复、口播改输入不重发。该次另一文件的公开投影测试旧预期1失败已在上行最终复验通过，不将原日志标为全绿。|
|[客户端回读单测](receipt-unit.log)、[旧字幕/脚本协议适配](receipt-client-retest.log)、[上传/人工口播/Studio/创建复验](final-failed-client-retest.log)|只读readback，不重复原POST；缺回执跨模块重载仍不自动重发；旧回执不能确认新脚本。各组有重叠，不相加。|
|[SSE分类](speech-rejection-unit.log)|21项通过。已知首音频前拒绝、部分音频/坏SSE/未知代码分类。|
|[实际全应用浏览器](browser.log)、[结果](browser/result.json)|1/1通过。真实Owner/HTTP/PG/UI，受控连接与Worker；先核对原任务、展示两次计费风险、仅确认后新task、旧started保留、不自动采用，Provider POST仍1。首次加载等待及fixture未提供可执行目录的失败见[browser诊断](browser/diagnosis.md)，不作为产品成功。|
|[独立48类复核](acceptance/REPORT.md)|45项保留集成通过，媒体状态/试听65单测通过。逐项证据映射覆盖48类；额外字幕浏览器门控1项未执行，相关HTTP/PG字幕5项已执行，不把门控跳过计通过。|
|[先行完整默认套件](default-tests-final.log)|289文件、2098通过、1既有条件跳过、0失败；初验9个旧交互/协议预期失败已保留在default-tests.log，均修正并复验。|
|[最后触及UI复验](final-touched-unit.log)、[最终兼容与聚合UI复验](final-compatibility-unit.log)|先行49通过；最后7文件91通过，覆盖密钥聚合/共享详情/根设置、口播、图片状态、重试投影。与默认套件有重叠，不相加。|
|[163最终兼容集成](legacy-received-integration.log)、[最终浏览器](browser-final.log)|4文件17集成全部通过，含图片/口播旧received无事实可明确新生成、任一新事实/hold拒绝、原记录保持、重复替代拒绝；真实全应用浏览器再验1/1。|
|[最终构建](build-final.log)、[后台准备](runtime-prepare-final.log)|全项目TypeScript、前端production build、Worker/backend build与产物完整性检查通过；存在既有大chunk提示。|
|[独立实现审查](independent-review.md)|发现并修复跨attempt旧submission不更新、marker误包装、缺回执恢复入口、非回执命令误锁及旧unknown遮蔽新结果。最终无阻塞级发现。|

**48类状态：22项修复并验证，26项验证保留，0项待实施。** 这是已描述规则的逐类代表性验收，不是所有媒体格式、状态笛卡尔积、真实供应商质量或扣费测试。完整矩阵见[48类](../workflow-rules-implementation-20261111/acceptance-48.md)。

## 正式启用

迁移前Git完整检查点：`32514cb623eabc783e2b37e7bfa45fbcd9cec64e`，分支`codex/before-connection-receipts-20261111`；当前分支和正常暂存区未切换。

- 停止前只读确认0个ready/running任务、6张生产单均无活动原生Studio。
- [首批正常迁移](runtime-migrate.log)应用161、162；历史兼容使用[新增前向163](runtime-migrate-final.log)，未改已应用迁移，旧迁移哈希全部一致。Owner已关闭自动备份，正常迁移尊重此设置，未使用`--no-backup`。
- 5174最终正常重载成功，PID74264、运行/准备release `2557fbeb5f3e846ff4b521f91d365ceb532c50d491fbcb36eb2b9f76c24698a2` 一致，见[daily-after](daily-after.json)。匿名session查询401为预期授权拒绝。
- [重载前](daily-before.json)/[重载后](daily-after.json)：均6张生产单、19任务、4回收项；0在途任务，新事实表0行。未重放真实旧未知任务，未创建真实生成或变更真实内容/密钥。
- 两个阶段隔离PostgreSQL均为network-none/tmpfs无业务数据环境，全部fixture关闭后已核对身份并停止本轮容器；日常服务与5210预览保留。

## 设置界面

连接、模型、用量与计费、记录使用同一个固定区域，保存/取消统一在右下。保留实际API、权限、不可变版本、模型/计费分开保存、草稿守卫及错误恢复。敏感读取使用共享固定面板和一次密码验证/30秒清除，不产生嵌套弹窗。细节见[迁移报告](../compact-connection-migration-20261111/REPORT.md)。全局密钥按真实connectionId聚合制作/账务/历史，系统及无连接按用途分组；分页只描述当前返回页，footer总条目不冒充总分组。分组→组内条目→固定详情逐级替换并保留筛选/页码，39定向通过、宽窄中英深浅与axe通过，见[补齐报告](../compact-connection-migration-20261111/secrets/GROUPED-REPORT.md)。主Agent已在正式已登录页面实看连接详情、模型读取、35个真实元数据条目的聚合、制作/账务明细、固定详情与返回，截图[正式密钥分组](../compact-connection-migration-20261111/secrets/production-group.png)。未点击测试连接/读取供应商模型/显示或复制真实密钥。

未知网络/进程故障未来仍可能发生；本次保证有证据时安全恢复、无证据时不冒充未执行，不承诺还原最早那次503的唯一历史原因。

## 后续补测：默认套件零跳过

用户要求补测原唯一legacy条件跳过项，现已改为独立显式旧API环境测试，新版9项也取消条件跳过。另修复创建回执单测的异步提示等待竞态（不改业务代码）。最终默认套件290文件2104项全部通过，0失败、0跳过，类型检查通过；过程、初验失败及最终日志见[补测报告](../runtime-version-legacy-20261111/REPORT.md)。上述2098通过/1条件跳过保留为先行历史证据，最终结果以本段为准。
