> 当前状态：本项已复测并迁移至日常5174。本文以下为迁移前隔离记录；5192／5194已停止。以[迁移完成报告](../shot-protocol-migration-20261110/REPORT.md)为准；[3.5](../narrow-window-review-20261110/REPORT.md)仍仅隔离。

# Worker 镜头协议与清理等价核对

2026-11-10。已在隔离空间实现，尚未迁移。主项目程序文件和日常运行版本保持，费用 0。

[本轮新预览](http://127.0.0.1:5194/__current_cleanup?view=episodes&episode=828df426-f047-4714-b71a-a160b702f9cc&step=preparation&tab=sound)。5194 使用当前隔离源码与 156 隔离数据库；5192 保留上一轮核对实例；主程序仍为 5174。产品变更在 `/Users/dan/Programs/loop-control/.scratch/current-flow-cleanup-20261110/pending`。

## 修改内容

| 当前操作 | 新 task_type | 新 capability | 持久结果 |
| --- | --- | --- | --- |
| 生成镜头视频 | generate_shot_video | shot_video_generation | shot_video |
| 检索镜头视频 | search_shot_video | shot_video_search | pexels_search_results |
| 预览检索视频 | preview_shot_video | shot_video_preview | pexels_video_preview |

- 当前任务视频输入统一保存为 media.video；生成任务的 shot 不再写 A/B 分类。检索与预览保留实际操作语义，不冒充生成。
- 156 仅新增前向协议扩展。任务在 INSERT、原生不可变身份生成之前确定新名称；已有 task_id 的排队请求不转换，历史数据不批量重写。
- Worker、Adapter 注册、媒体执行、产物读取、任务标签和统计支持新名，并继续读取旧任务名、capability、wan_video／b_roll payload 和旧产物。旧蓝图／storyboard/v1／历史 RPC 留在兼容边界。
- 共用同一 Owner／连接版本校验、租约、文件哈希、原生输出命名空间、费用预留、并发资源锁、未知提交防重和已保存 Provider ID 恢复。未为重命名放宽不可变身份或已领取输出的保护。
- 新生成素材登记 visual_reference；统计上新旧视频操作的成本、预留与工时口径等价，检索及预览未因此改变原统计口径。
- 修复顶部工具区：上轮删除 production-nodes.css 时误删了现用抽屉共用的 5 条规则，导致工具容器变为 block、超出顶栏，关闭按钮落到下一行。共享规则已迁至现用 workspace-topbar.css，恢复主项目原布局。
- 新增 ADR-0032 并补入口索引，明确当前新写、旧读和恢复边界。此前 19 个旧文件清理继续保留，完整迁移清单含前后两轮变更，尚未应用到主目录。

本轮增量 28 个文件，见 [protocol-delta.json](protocol-delta.json)。合并清单：{'modify': 59, 'add': 12, 'delete': 19}；见 [完整差异](cleanup.patch)和[逐文件前后 SHA](migration-manifest.json)。预览 fixture、runner、构建物、缓存不在迁移清单。后续迁移前必须重新验证 mainBeforeSha256。

## 实际验证

- 28 文件 264 项相关回归通过，包含原清理后的当前四步、字幕／画面／音频／交付、共享抽屉、Worker 合同、Adapter、任务统计和标签。前端（含类型检查）、后端、Worker 构建退出码均为 0；保留既有大 chunk 提示，不宣称性能提升。
- 33 条真实隔离集成通过：当前脚本及新任务链 3、新旧混合并发与不可变输出 3、未知提交及新旧 Provider 恢复 3、Pexels 全流程／失败恢复／轮换／预览／采用／导出 6、模型与实际 Worker 参数矩阵 17、155→156 实际升级 1。
- 155→156：先在旧 schema 经真实 Owner HTTP 创建并提交旧 generate_b_roll，模拟轮询中断；应用 156 后原行和冻结快照完全相同。不能绕过该旧提交新建付费任务；恢复只轮询原 Provider ID，旧任务只有一次 POST。随后新镜头任务为 generate_shot_video，Worker 完成且产物为 shot_video。见 [升级证明](shot-protocol-upgrade-proof.json)。
- 并发：当前／混合／旧协议两任务共用同一连接，Worker capacity=4 时仍仅允许 1 个执行；释放后第二个才可领取。已领取输出改写被原不可变约束拒绝。
- Pexels 搜索／预览失败仍可按原专用入口重新请求，不进入付费 Provider 恢复，不自动导入或采用；实际编辑、保存重开、导出通过。
- 所有 Provider 网络为受控响应，实际文件、SQL、HTTP、Worker 和媒体探测真实执行；未发起付费请求，不代表真实供应商画质验收。

## 与主项目的对照

- 基线使用开始时的主项目源码快照和同一隔离样例，不操作日常数据。
- 1398／640 各检查音频、画面、脚本与旧成片，共 8 组页面。59 个布局实例的边界／排版／颜色／间距等计算样式两侧一致，无横向溢出；顶部桌面与窄屏全部工具均在 56px 顶栏内。旧视频真实加载并可读取。见 [测量](ui-parity-measurements.json)、[差异结果](ui-parity-differences.json)和对应截图。
- ⌘K 可以聚焦工作区搜索，关闭搜索按钮可操作；当前核对页面错误列表为空。
- 实际 Owner API 的账号规则、系列版本绑定、生产单状态／计数、四步 workspace、镜头文本／来源、准备授权、画面就绪、口播、音频开关、候选及导出数量业务投影一致。仅排除生成的 UUID、时间、哈希、磁盘路径及已明确退役的 preparation.shots.shotType。关系按账号、系列名称和冻结版本比较，见 [API 对照](api-parity.json)。
- 模型目录的 Provider／Adapter、模型、预设与约束不变；原 5 类 legacy Adapter choice 完全一致。只增加当前协议的兼容声明，见 [目录对照](catalog-parity.json)。
- 开始时记录的主程序 src／scripts／SQL／ADR 及包文件共 1174 个指纹一致，其中 src 909 个与上轮开始也一致；暂存区未改。日常 PID 78102、端口 5174、固定运行包 2b3b75f8fb71599e7790dc0238a4d6911a3d44ca932c295c6120a3347d0a2335 未变。未重启日常服务、应用日常 SQL、修改日常媒体或提交推送。计划与核对证据属于本轮记录变更，不属于程序迁移。

## 如何核对

1. 打开 5194 新预览，先看原来标出的顶部搜索、⌘K、通知及关闭按钮：应同排、靠右、完整位于顶栏；缩窄窗口也不掉行、不遮挡。
2. 在“统一镜头清理核对”切换脚本、画面、字幕与口播、配乐与声音，确认布局与主项目原样一致；再打开“隔离 Studio153 验收”的检查与交付，核对旧视频。
3. 协议与恢复不是靠界面文字判断：查看升级证明 JSON 和 33 条集成日志，可核对旧 task_type 未变、新 task_type／capability／artifactType 和实际提交次数。需要复跑时，先进入 pending；使用 run-current-cleanup.mjs 运行当前集成，run-shot-protocol-upgrade.mjs 单独运行 shotVideoProtocolUpgrade.integration.test.ts。两者均创建带标签、无网络的临时 PostgreSQL，不读取日常部署和秘密。

预览仅允许系列设置、本地创建／导入脚本／确认和建立分镜，在线制作拒绝 409。fixture 的系统状态不可用不代表日常状态。若要手动付费生成，需要另行接入测试连接；本轮不依赖该操作验收。

## 已定位并解决的验证问题

SQL 转换初版暴露 jsonb 运算符优先级错误，已修正并以最终 migration SHA 再跑全部当前集成和真实升级；未绕过身份不可变检查。旧 unknown-submission 测试在主源码基线即把 blocked 误写为 failed，已对齐当前真实状态并保留防重断言。旧 Pexels 全流程在两侧均因隔离 SDK／挂载配置失败；为两侧测试显式指定真实 SDK 根与正确系统挂载点后均通过，未改产品错误处理掩盖失败。正常领取时允许原有 runtime_constraints 资源元数据变化，创作与执行协议冻结字段仍逐项相同。

## 恢复与保留

完整原始源码备份及上轮清理差异仍在 `.scratch/current-flow-cleanup-20261110`；本轮开始状态的差异、指纹保留在 `shot-protocol/before-*` 与 `pending-before.json`。没有改写已应用的 001–155 SQL 字节。5194 保留供核对，5192 保留用户旧核对实例；临时比较用 5193 完成后停止。主程序没有迁移。
