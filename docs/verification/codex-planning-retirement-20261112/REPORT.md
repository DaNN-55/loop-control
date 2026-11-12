# Codex CLI 旧规划链路退役验收

日期：2026-11-12。范围为Loop-Control内旧视觉/分镜规划；不卸载系统Codex，不重置历史记录，不执行原生PG或SQL新基线转换。保留前轮未提交成果及三份并行CSS，不提交、不推送。

## 已执行

- 全局/每期规划设置、纯旧审核/批注/规划/重试/结构修订和带planningTaskId的旧重排，在原Owner、CSRF及归属边界后明确410拒绝，且在旧幂等回执读取前拒绝，防止回放成功回执复活旧入口。
- 保留当前 `WorkspaceScriptPanel → start → prepareWorkspace`：start只确认已保存主脚本及素材，并关闭旧隐式规划；正文/v2在本地准备。普通replanWorkspace保留。
- 删除孤立规划组件、Stores、专属类型/原型区和CLI包装器；移除Codex注册及启动visualCommand。清理旧Prompt生成、输出schema、确定性旧规划执行及规划后批量视觉生成分支。
- 保留 `storyboardFromScript`、历史分镜纯验证，以及共享媒体Worker协议。`codexRunner.ts/runCodexWorker` 是历史名称，当前仍承载图片、视频、TTS、WhisperX、Studio/交付的通用验证与结果回写，不能整文件删除。
- Native Worker的plan不再调用旧输入SQL自动补任务；保留当前明确提交的媒体入队与领取。移除旧规划修复表单/依赖状态卡，旧自动continuation在规划阶段等待明确退役说明。
- 旧正向CLI规划成功验收按case完整归档；当前媒体、目录、未知结果和历史保护用例保留，归档清单见 [historical-tests](historical-tests/README.md)。

## 164 前向退役过滤

独立审查发现，仅关闭planner不能阻止已有旧ready任务被领取；领取失败和过期恢复都会改历史记录。因此新增并应用 `db/local/164-retired-planning-claim-fence.sql`，不改写原迁移。

该迁移的纯字段谓词同时排除旧Provider、任务类型、能力及快照Provider；收紧private领取候选、全局/资源/公平计数、租约恢复与旧public领取。Worker仅获得新谓词EXECUTE，不获得tasks表SELECT。启动检查要求此门槛存在，避免代码先更新、数据库保护缺失时静默运行。

应用前：5174/5175未运行，没有本项目旧Worker/CLI包装器进程；不会把实际仍运行的旧任务排除容量后并发启动新任务。事务仅更新函数/权限和schema_migrations一条记录，未启停日常服务。任务、运行、蓝图、生产单、审计和连接六表内容摘要前后一致。[应用收据](daily-migration-receipt.json)。恢复SQL和原函数定义保存在 `/tmp/loop-codex-chain-retirement-20261112/`，未执行回退。

## 验证

- 最终默认回归：286个文件、2094项通过。定向Worker合同/注册/preflight 55项、原生产发布安全与输入preflight 22项，以及入口/界面49项均已复验；不把这些重叠计数相加。
- 类型、前端构建、Worker/后端运行包准备通过；已核对已准备运行包的source/output完整性。
- 一次性无网络PG、受控Owner HTTP：当前正文/v2 start与prepare成功、旧规划重试410且来源不变、零旧规划任务；旧ready和过期running任务在NULL全局领取及指定领取后，完整task/task_runs记录不变。独立校验真实PG谓词对任务类型、capability及快照Provider错配的拒绝。
- 最终选定集成6项通过：上述4项，加两份原集成中的旧规划设置/重试拒绝与历史行不变。其余31项因本次选择器跳过，不计为通过。
- 另3项当前故事用例通过：实际受控图片Worker、语音Worker子进程，以及目录创建中断恢复。它们使用本次164和恢复的start合同；没有请求真实供应商或花费。
- 另1项当前恢复用例通过：直接导入历史冻结行及其原阶段后，实际Owner本地准备可替代未完成旧模型任务；该setup不再调用已退役API。上述选定实际PG验收共10项，分批运行，不代表完整集成套件。
- 实际Chrome验证真实App空状态、新建账号弹窗、旧规划修复只读返回、状态面板不再要求Codex，Escape后焦点恢复；390px修复面板无横向溢出，页面无运行错误。使用合成数据，没有启动日常服务或真实生产单。
- 独立只读审查确认两项阻断已闭合：误退役当前start、旧任务仍会被领取改写。

## 失败记录与修正

早期集成捕获了对start的错误归类；已追到真实前端调用并恢复当前确认合同，沿相同真实HTTP流程复验。初次默认回归24项失败来自保留通用测试仍使用已退役规划夹具，已将发布、上下文和preflight测试迁到当前媒体任务，保留全部20项产物发布安全测试。

新历史任务种子先后触发了当前已有的Harness冻结、输出路径、单个活动规划唯一性、显式图片请求和缺少调度容量校验。已检查相应约束后完善隔离夹具：合法脚本格式、完整旧冻结输入、独立ready/running生产单、仅持久化合法旧任务、错配值通过真实SQL谓词检查、明确隔离容量2。生产校验、索引、触发器和权限均未绕过或放宽。所有初始日志和诊断仍保留，不把失败尝试写成成功。

## 后续方案与保留项

[原生PG、干净SQL与埋点计划](../../plans/native-postgres-and-clean-schema-20261112.md)已记录用户认可方向与顺序：原生PG适配/演练→保持schema切换日常库→干净SQL在VM验收→原生库新基线→统一埋点；shadcn/ui后置。迁移方向与埋点认可不等于本轮执行了安装、切库或埋点。

WhisperX只核查代码：入口在可写Studio的OpenChatCut字幕库，默认隐藏面板，需要启用字幕与可写桥。未在具体真实生产单复现其缺失，未运行模型/手工保存或改位置。建议保留可选自动校时，在字幕工具区直接呈现；没有它仍可原生手工校时后保存并满足交付。

所有旧SQL、冻结记录、历史数据与原有退役保护验收保持；164为新增前向过滤。共享类型/通用协议中的旧字段和历史名称不代表CLI仍可执行。全局Codex安装、Python/模型、备份设置和Worker并发2/重任务1保持。

本轮5299和自动验收浏览器收尾关闭；此前用户查看的WhisperX位置预览5298保留。恢复和完整日志：`/tmp/loop-codex-chain-retirement-20261112/`。截图：[旧规划修复390px](retired-repair-390.png)、[状态面板](status-after-retirement.png)。

最终保护与各用例证据见 [verification.json](verification.json)。本轮一次性PG容器均由runner校验身份后清理，完成的源码/SDK隔离副本已释放，失败和成功日志保留。
