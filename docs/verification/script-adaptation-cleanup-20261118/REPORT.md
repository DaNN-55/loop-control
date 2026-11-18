# 脚本内容修订命名与旧配置清理（2026-11-18）

## 变化

- 当前方案校验与包含内容变化的人工回执改为 `revision`；保留 `optimize` 的原文约束、合法时长和逐镜开关。人工画面／运镜修改若未改变原文内容，仍可记录 `optimize`，语义沿用原合同。
- 人工修改口播／字幕、删除镜头不再写入旧独立改编模式；仍只创建新的待采用回执，保留原文、原回执、父链及固定时长，不请求 Provider。
- 新模型请求只允许调整拍法／仅讨论；Provider 层也拒绝内部 `revision`，不能借新命名放宽 AI 内容改写权限。当前校验器拒绝未经历史边界转换的旧模式和未知模式。
- 旧草稿形状、旧请求识别与历史回执模式读取集中到 `src/scriptStudioLegacy.ts`。UI 本身不再声明旧开关，旧草稿仅恢复文字与交流方式。
- 删除英文词典中5条无调用的旧按钮／帮助翻译；删除模型指令里重复的退役入口介绍。保留原文不可擅自改写的要求。

## 历史兼容边界

生产代码中旧 wire 字面值 `adapt` 和旧草稿同名字段仅保留在 `src/scriptStudioLegacy.ts` 的两处识别点。它们是历史输入格式，不能清除后再假装仍兼容旧数据。

历史回执读取及采用时只在内存转换为 `revision`，不修改数据库行、原结果、模型归属、request ID、快照和父链。旧独立改编新请求继续返回410；旧草稿开关丢弃，未发送文字保留。测试中故意保留旧值作为兼容样本，ADR中保留历史说明。无关上游供应商文件中的通用 adaptation 词不属于此功能。

`script-studio/v1`、方向合同版本和 payload hash 算法未改变。同一人工请求重放、默认模型请求复用、处理中／未知结果只核对不重发的合同不变。手动删除仍至少保留一镜，按比例重分总时长。对话的Owner／生产单／脚本版本／原文／时长隔离不变。

## 验证

| 检查 | 结果 |
| --- | --- |
| RED | 首轮3文件45测试中3项预期失败：旧模式仍外泄、当前revision恢复不正确、Provider未拒绝revision。 |
| 定向 | 8文件81项通过，覆盖历史只读映射、当前修订、旧草稿恢复、人工修改删除、Provider约束与对话隔离。 |
| 语言 | 3文件7项通过；5条删除的旧翻译无当前调用点。 |
| 类型／构建 | `npm run build -- --emptyOutDir=false`通过（包含tsc -b），`npm run backend:build`通过；保留既有大chunk提示。 |
| 隔离HTTP／PostgreSQL | 现有scriptStudioRequests集成24通过，1既有browserhold保持用例按开关跳过。私有PG17 Unix socket，实际验证旧adapt回执读成revision且仍可采用、数据库旧值仍为adapt；新人工口播／字幕及删除回执写revision，实际工作区生成保持内容／时长；幂等、CSRF、Owner、未知恢复等继续通过。 |
| 全量首轮 | 335文件2459项中2457通过、2项异步fixture断言失败：MediaRootSettingsDialog.recovery的finish尚未赋值；ProductionWorkspacePanel.operations的postMessage记录尚未到达。不是两项超时错误。 |
| 失败项复核 | 两个原文件独跑27项全部通过；未改断言、未跳过、未更改无关业务源码。 |
| 完整复跑 | `npm test -- --maxWorkers=2`：335文件／2459项全部通过，152.59秒；降低runner并发，不跳过用例、不降断言。 |

隔离测试的Provider为本地替身，不使用收费连接，不等于真实供应商验证。私有数据库测试exit0，集群已停止，临时根已删除，日常PostgreSQL未触及。本轮临时日志、runner均在 `.scratch/script-adaptation-cleanup-20261118`，按用户要求仅保留本Markdown验收记录。

## 差异审查及交付边界

正确性：新旧模式映射在读取／采用边界统一，修改／删除通过真实HTTP和工程准备回归；内容变化列表和原文约束未移除。可读性：当前类型和回执不再借旧功能名表达人工操作。架构：无新增数据库表／迁移／依赖，历史输入解释集中在单个边界模块。安全：模型入口不接受revision，历史结果不会扩大后续AI权限，认证和回执范围不变。性能：只有常数级模式归一化与额外模式合法性检查，无新增查询或轮询。

日常应用准备包、重启和正式生产单只读复核由主agent统一执行；本子任务未重启服务、未写正式生产单或旧对话。没有制作启动、真实付费调用或新增功能。第3项新对话／附件需求未实现。


## 主agent最终核查

- 独立审查新兼容模块、读取／采用、Provider入口、人工修订／删除及草稿路径；活动源码仅历史兼容模块保留旧wire/字段两处识别，测试和历史说明保留旧值。
- 全部历史产物清理后再次执行前端build通过，当前应用直接引用的两张图片参与构建且保留；runtime:prepare通过，已准备与运行包完整性核验通过。只重启app，未停止日常PostgreSQL。
- 当前应用PID54959／端口5174，运行release `80f345ce233a5893671db6d1c7ded8f59d03b19db74bd7efe521fc70e7686265`；HTTP根页200。
- 使用上述实际运行包的编译后 `readStudioConversation`，通过Owner只读事务恢复正式两张测试单。B旧库mode仍为adapt、读取为revision、7条对话、3镜24秒；A旧库mode仍为adapt、读取为revision、8条对话、3镜30秒。两个完整plan逐字段与原回执一致，人工镜头标记均为[0,1,2]；没有发送Provider、修改原文、采用或启动制作。
- 正式浏览器刷新检查未完成：原生Chrome未能取得可操作窗口，内置浏览器刷新中断。实际打开曾显示重启期间的Failed to fetch，因此本项不能算通过；未把只读函数验证冒充完整UI刷新验证。UI旧草稿恢复等有组件回归，完整业务边界由私有HTTP／PG覆盖。
- 本轮原始日志／runner在主agent核对结果后清理，只保留本报告；8张正式业务／设置表前后数量和SHA完全相同，见下表。

| 表 | 前后行数 | 前后相同SHA256 |
| --- | ---: | --- |
| `public.episodes` | 10 | `e6f730d8c2746d107383ca0f771fff6ca9fdfc93cd4ffc90cb5e392ad93acd15` |
| `public.production_material_revisions` | 83 | `51da79631b3f9dabed8cabe2dd73109a91ed8b2d1a7486cc367d7075ed0579f7` |
| `public.tasks` | 73 | `e9fa2240a7ec4e6945f1c6fb73dd06f6923b45e3a77fdb8fc43432015835b1df` |
| `public.artifacts` | 77 | `f44b650aea3fd1628b9fb2bd32560e45b66cae7cdd5e380c4a46d95430ed8874` |
| `public.review_packages` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `local_identity.script_format_requests` | 28 | `ed802d230c479244e458f4a53f79905ec2765ba09f5132d7726e35f235b474e1` |
| `local_identity.script_studio_confirmations` | 1 | `50d44ca4978b47bc091af8ccdda033e42c64b8a41bcab4163cf6a2905300dc7a` |
| `local_identity.connection_model_settings` | 5 | `b35413843ec8b0bc08ee9f99261e356e32313f2ee390cb42eb71869a05bda14a` |
