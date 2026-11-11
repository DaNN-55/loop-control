# 48 类流程优化与三页紧凑 Demo 验收

日期：2026-11-11。主 Agent 顺序实施业务修复，子 Agent 按场景独立审查和测试。用户认可原 48 类建议；发送阶段回执分类暂缓，三页设置继续隔离 Demo，确认方案后才迁移。

## 结果

真实咖啡生产单 `2aefed78-4f22-472e-9e5f-2f64796bb017` 已通过新运行版本只读回查：`actionStatus=running`、`blockerCount=0`、`backgroundTaskCount=1`。关闭的口播不再挡住当前作品，原未知请求仍保留为后台记录。没有修改该生产单的任务、工程、费用或采用记录来制造结果。

[48 项逐项验收矩阵](acceptance-48.md)完整无缺号：17 项修复并验证、26 项验证保留、4 项发送分类部分暂缓、1 项隔离 Demo。这里的“通过”指各项列出的实际门槛和代表场景，不表示穷举所有供应商或输入组合。

[交互规则清单](http://127.0.0.1:5210/docs/reviews/workflow-rules-20261111/index.html)已保留“修复前实现”，新增“本次验收”，不把原先审计文字继续当作当前行为。

## 实施内容

- 口播开关与 `mode=none/tts/manual` 入口统一；待准备数和自动刷新排除停用口播。关闭窗口仍只是收起界面。
- 原始工程保留媒体、音量、候选及历史。显式停用的口播/配乐/音效从临时执行图移除，来源检查、原生渲染与时长检查使用同一图。普通音量为零不等同放弃文件依赖。
- 目录按当前实际用途关联任务，未采用、已替换、删除目标和停用内容的失败/未知记录单独提醒。当前仍需口播且无主声时，旧未知请求即使换正文仍要求核对。用户记录的成片问题和当前交付失败仍阻塞。
- 持久任务的退避时间、自动尝试耗尽和失效证据进入显示。Owner 重新明确确认与无限自动重试分开；已失效目标/原声窗口不能继续旧请求。
- 明确停用/删除后，尚未开始、没有发送/费用/未知/hold 证据的 `ready` 任务才标记 `superseded`，保留冻结快照和原结果。正在执行或已经发送的请求不被假称取消；迟到口播结果只能进入候选，不自动恢复用途或采用。
- 旧 QC 合成/结构修订新增受控运行冲突锁。冻结文件先经过真实字节和来源检查，再在同一 Owner 事务登记、排队、绑定任务，修复原先“要求先登记但登记在排队之后”的死结。没有给 `loop_app` 扩大任务 UPDATE 权限。
- 过期导出提示补充导出 `vX → 当前 vY`，保留旧下载与确认失效规则。

设计决定见 [ADR-0041](../../adr/0041-current-workspace-dependencies.md)。目录只验证筛选范围内、有未结任务的活动原生工程，不在每次列表刷新重新哈希整片媒体。实际采用、编辑、导出、确认和交付仍在文件边界核对；列表不是实时文件完整性保证。

## 独立验证

| 检查 | 结果与证据 |
| --- | --- |
| 默认全量套件 | 284 文件，2061 通过、1 既有跳过：[full-tests-green.log](full-tests-green.log) |
| 最终界面版本提示与后台提醒 | 33 定向通过：[last-ui-retest.log](last-ui-retest.log) |
| 类型检查、前端构建、后台准备 | [check.log](check.log)、[build.log](build.log)、[runtime-prepare.log](runtime-prepare.log) 均通过；构建保留既有大 chunk 提示 |
| 语言键/占位 | 3251 字典键、2420 静态调用键，缺失 0，占位不一致 0：[i18n-copy-check.json](i18n-copy-check.json) |
| 主 Agent 新增连续操作 | 4/4：关闭未知口播与重开限制、缺失停用媒体和长尾实际导出、替换/删目标/未用音频目录、真正已发送迟到口播不自动采用：[workflow-rules-complete.log](workflow-rules-complete.log) |
| 子 Agent 退避/失效独立 HTTP 测试 | 1/1，真实 Worker 失败和文件恢复、窗口/目标变化 409，见 [第三批报告](batch3-independent-review.md) |
| 子 Agent 队列/权限独立 HTTP 测试 | 4/4，ready/running/unknown/hold、删除目标、作用域/只读/旧基准、同输入停用重开重新明确确认，见 [独立日志](batch3-queue-stop-independent-accepted.log) |
| 旧流程与保留门槛 | 环境 Agent 171 单测、40 个独立集成场景通过，含 4/4 旧 QC 三路径与安全边界：[retained-rules-verification.md](retained-rules-verification.md) |
| 视觉候选完整复验 | 23/23：[batch2-visual-protocol-retest.log](batch2-visual-protocol-retest.log) |
| 目录独立 SQL 合约 | 6/6，显式用途投影及筛选/分页：[catalog-filter-contract-final.log](catalog-filter-contract-final.log) |
| 全应用真实浏览器 | 实际 Owner HTTP + 隔离 PostgreSQL + 受控 Worker；关闭后待准备数减少、刷新仍关闭、目录制作中/后台提醒，375px 无横溢出：[browser/result.json](browser/result.json)、[browser/final-run.log](browser/final-run.log) |

上述结果不简单相加，避免复验和重叠文件重复计数。门控或定向非目标跳过没有算通过。没有真实供应商请求、真实密钥读取/轮换或真实付费生成。

初验失败如实保留：默认界面旧用例把任何后台失败都期待为 danger，已区分当前阻塞与独立提醒；旧视觉用例仍读 `media.wan_video`，已对齐当前协议 `media.video`；旧候选全轨道不变断言与 `follow_tts` 冲突，现只允许目标正文/时序跟随，其他轨道、样式、位置与 lane 仍完整比较。同步预览两例因验收命令缺 SDK 路径失败，补明确 `OPENCHATCUT_ROOT` 后通过。新场景捕获的真实文件依赖、队列、权限和冻结登记问题均修根因后独立复验。原始日志未隐藏或删除。

## 正式运行与历史迁移校验

启用新函数时，正常迁移工具因既有 139 文件校验记录不符拒绝执行。首次尝试后先恢复已验证旧固定后台，未跳过校验。只读比对证明日常与全新隔离迁移链的规划函数、表字段、约束、权限及策略完全一致，见 [schema 比对](migration139-schema-comparison.json)。

用户明确回复“修复历史校验并启用新流程（推荐）”后，先在隔离事务测试并回滚，再执行带实时结构/旧校验双重前置检查的修复。只修正 139 的技术校验记录，保留原值及批准证据：[修复前后记录](migration139-repair-applied.json)。不修改规划函数、规划设置、业务内容或其他旧迁移记录。

随后正常 `npm run runtime:migrate` 应用 158、159，[迁移回执](runtime-migrate-final.log)通过；正常启动 5174 新进程 PID24988。运行记录与 prepared release 一致，真实生产单只读结果见 [live-readback.json](live-readback.json)。首次回滚与失败日志保留，不把中途启动当最终启用成功。

## 三页设置 Demo

[验收报告](../settings-layout-v3/REPORT.md)。三页均统一行尾动作与详情底部操作栏，81 个布局场景无横向溢出、18 项合成交互通过，18 个 axe 场景无 violations；不确定对比度项另行核算，最低 4.58:1。

- [A 对齐列表（推荐）](http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page=connections&variant=rows)：保持表格直觉，详情贴近当前行。
- [B 主从分栏](http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page=connections&variant=split)：紧凑列表与单对象详情并列。
- [C 用途分组](http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page=connections&variant=groups)：按能力、用途和删除时间组织。

左侧切连接、密钥、回收站，底部切方案、语言和主题。A 的密钥展开区域为 101px。回收站只操作合成内存数据，不是正式软删除或自动清理交付；三套方案尚未迁移正式界面。

## 保留边界

4/5/17/24 中未发送、已发送未知和结果登记失败的底层分类继续暂缓，仍无法唯一还原旧 503。真实回收站、容量自动永久删除和恢复未启用。新业务代码与本轮测试未提交/推送，原基线 `dc810e1f` 保留；5210 保留供选择。

收尾：隔离测试容器已按镜像/标签/无活动连接检查后删除，自有测试浏览器、5226 服务和预览缓存已关闭/清理；正式 5174 和供选择的 5210 保留。
