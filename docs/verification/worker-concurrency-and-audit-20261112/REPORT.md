# Worker 并发与工具链去留核查

2026-11-12。只执行获准的并发调整与无使用方独立仓库清理；其余均为只读核查或待决定建议。未提交、未推送，保留前轮所有未提交成果及三份并行 CSS。没有启用数据库/媒体自动备份、迁移数据库或启动日常服务。

## 1. Codex CLI：仍有项目联系，保留

当前默认正文/v2 准备流程不调用 CLI，但以下连接仍真实存在：

- `scripts/runtime/application.mjs:70` 将部署中的 `visualCommand` 转入准备好的运行包。
- `scripts/runtime/codex.mjs:5` 对视觉/分镜能力执行 `codex exec`。
- `src/local-app/productionWorkspaceCommands.ts:142` 保留 `retryWorkspacePlanning`，后续分支支持指定旧规划任务重排。
- `src/local-app/localWorkerCli.ts:48` 仍接受 Codex 的视觉/分镜任务；`registeredAdapters.ts:164` 仍注册该能力。

当前数据库核查没有发现 Codex/旧规划任务，但这不能替代上述调用关系。用户授权条件为“无联系才清理”，因此本轮不删除包装器、兼容入口或全局 CLI。彻底退役将是另一次行为变更，需一起处理入口、注册、任务边界和配置，不能只删二进制。

## 2. 独立 OpenChatCut：已清理

独立目录 `/Users/dan/Programs/OpenChatCut` 与小写别名是同一 inode。版本 0.2.14，HEAD `cbe20ddda5b5be1c6decd72cef5eedf3627681b1`。

核查当前项目/用户相关配置、引用、LaunchAgents、常见 bin、运行进程与打开文件，未发现当前使用方；历史文档/验收日志命中不视为活动使用。Loop-Control 部署、Studio 夹具、原生工作区夹具及 e2e 默认路径已经指向项目内 0.2.17。并行验收进程来自另一个 worktree 的 SDK，加载依赖来自项目内安装，不依赖独立目录，未向它发送信号。

清理前确认：

- Git 已跟踪修改与未跟踪文件均为零；忽略项只有 `.DS_Store` 和可重装的 `node_modules/`。
- 只有一个 worktree；相对本地 `origin/main` ahead/behind 为 0/0；本轮未 fetch 或改远端。
- 两次 `lsof +D` 均无打开文件；目录不是符号链接，项目内 SDK 和两者依赖目录独立。
- 已创建全部 refs 的 Git bundle，核对 HEAD、SHA-256 并通过 `git bundle verify`。

已删除独立目录，大小写两个路径均不存在；清理前分配占用 2,456,236 KiB（约 2.34 GiB），不是整个系统空闲空间增加量的实测。项目内 `.loop-control/local/OpenChatCut` 的 inode 与 HEAD `72ddb33` 保持。恢复包：`/tmp/loop-worker2-audit-20261112/OpenChatCut-cbe20dd.bundle`；原 origin 为 `https://github.com/0xsline/OpenChatCut.git`。可从 bundle clone、恢复 origin，再按锁文件安装依赖。

最初一条清理核查辅助命令有 Python 语法错误，解析前已退出，未发生文件操作；修正后重做完整校验再删除。具体收据见 [independent-cleanup-receipt.json](independent-cleanup-receipt.json)。

## 3. WhisperX：位置预览，未改变功能

实际入口：生产单 → 剪辑工作台 → 字幕 → 字幕对齐。真实宿主在 `EmbeddedStudioHost.tsx:146` 展开字幕面板，由 `ProductionWorkspacePanel.tsx:238` 挂载 `WorkspaceCaptionsPanel` 的 alignmentOnly 模式。按钮显示“声学对齐”；有对齐任务后才出现“采用对齐”。WhisperX 是背后的执行工具，前端不以这个英文工具名作为按钮名称。

右侧打开请求已发送给 Codex 面板；工具回执为 queued。浏览器已实际核验 [只读位置预览](http://127.0.0.1:5298/__whisperx)，复用真实组件和示例镜头，按钮捕获后只显示说明，不调用业务 API 或模型。1280px 和 420px 均可见，无横向溢出、业务请求或页面运行错误。[截图](whisperx-preview.png)。

为用户查看保留 5298 独立预览，未启动 5174/5175 日常程序。自动验收使用的独立浏览器会话收尾关闭；右侧面板打开请求保持。

## 4. 原生 PostgreSQL 与容器：只读建议

建议：眼下保留现有部署；若确定长期做单机桌面产品，后续可将**日常 PG 改为原生，容器留作按需隔离验收**。不要直接卸载 Docker/Colima，因为当前迁移、备份/恢复与多个隔离测试直接使用 docker exec/psql/pg_dump。

| 比较项 | 原生 PG | Docker + Colima |
| --- | --- | --- |
| 常驻资源 | 不需要 Linux VM；PG 进程本身仍占资源 | PG 之外还有 VM/容器运行时 |
| 启动与排障 | 少一层 VM/socket/容器状态，可直查本机进程和日志 | 当前工具已集成，但需同时核查 VM、容器、端口与卷 |
| 隔离和版本 | 需单独管理版本、服务名、端口、权限和数据目录 | 镜像可固定版本，独立容器/卷便于隔离 |
| 机器迁移 | Mac 与 Windows 分别安装/管理本机服务 | 运行环境更一致，Mac/Windows 仍需相应虚拟化运行时 |
| 升级与恢复 | 需自己维护升级/回退与逻辑导出流程 | 固定镜像方便重建；镜像并不代替数据恢复流程 |
| 当前项目改造成本 | 需改容器身份断言、服务生命周期、命令适配与测试 | 保持现状改动少 |

本机 `loop-control` Colima profile 配置为 2 CPU、2 GiB 内存、20 GiB 虚拟盘。这是配置预算，不是实时内存/磁盘实占。改原生能减少 VM 自身开销与启动环节，不意味着释放完整 2 GiB，也不直接提高外部视频 API 速度。

来源：[PG macOS 原生安装](https://www.postgresql.org/download/macosx/)、[Colima VM 配置](https://github.com/abiosoft/colima#customizing-the-vm)。本轮没有迁移、停止 VM、删除容器或更改备份设置。

## 5. 旧名称具体在哪些 SQL/验收里

当前命中 **12 个 SQL 文件 + 1 个冻结蓝图验收文件**。这包含仍参与初始化/迁移的 SQL。当前库已应用下表 11 个编号迁移，`scripts/runtime/migrate.mjs:5` 按已记录 SHA-256 验证原文件，直接删改会使后续迁移拒绝继续。

| 文件 | 旧名称的作用 | 建议与实际影响 |
| --- | --- | --- |
| [c-baseline.sql](../../../db/local/c-baseline.sql:43) | 冻结导入基线，含旧 `supabase_migrations` schema/table、旧 Provider 约束和当时的函数分支 | 保留；直接删改会改变旧库导入与从空库重建的依据 |
| [009-episode-input.sql](../../../db/local/009-episode-input.sql:70)、[010-input-scheduler-turn.sql](../../../db/local/010-input-scheduler-turn.sql:35)、[013-storyboard.sql](../../../db/local/013-storyboard.sql:64) | 历史任务规划/领取能力枚举含旧服务 | 保留已应用迁移；不能只删枚举字符串或整个迁移 |
| [014-narration.sql](../../../db/local/014-narration.sql:14)、[015-narration-retry.sql](../../../db/local/015-narration-retry.sql:65) | 当时 Google TTS 的旁白和重试规则 | 保留迁移历史；整体移除也会丢失其他 SQL 行为 |
| [016-media.sql](../../../db/local/016-media.sql:18)、[017-media-fences.sql](../../../db/local/017-media-fences.sql:15) | 当时 Cloudflare 媒体执行及任务边界 | 同上，保留迁移链和现有函数演进顺序 |
| [050-historical-connection-metadata.sql](../../../db/local/050-historical-connection-metadata.sql:3) | 历史连接的 Provider/adapter 组合 | 保留，避免把旧连接元数据当作任意文本放行 |
| [052-native-wan.sql](../../../db/local/052-native-wan.sql:4)、[063-official-video-providers.sql](../../../db/local/063-official-video-providers.sql:5) | 引入新服务时扩展约束/端点映射，仍保留当时兼容组合 | 保留已应用原文；删除整份会连带影响当前视频服务 |
| [066-retire-cloudflare-google-tts.sql](../../../db/local/066-retire-cloudflare-google-tts.sql:18) | 阻止新蓝图使用两项旧服务，允许只移除旧能力并保留旧 Episode 的精确冻结版本 | 建议保留，这是退役保护；删掉会丢失明确拒绝和冻结语义 |
| [providerRetirement.integration.test.ts](../../../src/local-app/providerRetirement.integration.test.ts:9) | 合成旧 Google TTS 蓝图和连接，验证退役后新引用被拒绝、旧快照仍逐字段保持、当前配置可清理 | 建议保留；删除不会立即改运行行为，但失去这组保护验收 |

典型内容分别是 `CREATE SCHEMA supabase_migrations`、旧服务能力枚举，以及 066 的 `IN('cloudflare','google_tts')` 拒绝条件。验收中的旧名称属于合成测试输入，不是对旧 API 发请求。

只读数据盘点：含两项旧服务的蓝图为 0 条，旧服务连接为 1 条。连接记录不属于源码，本轮没有删除或修改。精确行号清单见 [sql-name-inventory.json](sql-name-inventory.json)，当前库数量及迁移清单见 [history-sql-current-counts.json](history-sql-current-counts.json)。

若目标是让活跃 SQL 也完全没有旧名称，建议单独做“当前干净基线 + 历史迁移归档 + 前向升级兼容”。代价是重做空库初始化、当前库继续升级和旧备份恢复验收；简单搜索替换达不到这个目标。本轮全部保持。

## 6. Dan UI 替代候选（未安装/替换）

建议优先比较“直接使用现有 React Aria + 精简样式”和 shadcn/ui。易辨认取决于状态、对比、焦点、控件边界和排版，不是换名称就自动获得。轻量化需要用同样组件实测打包与渲染，未做体积排名。

| 候选 | 特点与适配成本 |
| --- | --- |
| [React Aria + 自有薄样式](https://react-aria.adobe.com/) | 当前已有底层；保留高质量键盘、焦点和无障碍行为，逐步减少 Dan UI 包装/样式，迁移成本相对最低；外观需自己维护 |
| [shadcn/ui](https://ui.shadcn.com/docs) | 提供可复制、可修改的组件代码和现成视觉，便于先挑样式；仍有对应的交互原语和依赖，不是零依赖方案 |
| [Base UI](https://base-ui.com/react/overview/quick-start) | 无预设视觉、可 tree-shake，适合简洁自有设计；组件 API 与现有 React Aria 不同，需要重新适配行为 |
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | 可渐进采用的底层可访问组件；需要样式与组件契约迁移，不保证比当前组合更小 |

可先在独立比较页看 Button、Input、Select、Menu、Dialog、Table 的普通/禁用/错误/焦点和深浅色状态，再决定整套方案。本轮没有安装依赖、改 CSS 或迁移组件。

## 7. 统计埋点建议（未实施）

现有 `episodeMetrics.ts` 已从任务/运行记录汇总生成数量、失败、费用和运行时段，应先复用这些事实再补缺口。

| 建议记录 | 回答什么问题 |
| --- | --- |
| 生产单创建、脚本确认、各阶段进入/退出、实际交付完成 | 每天/月产量、端到端时长、人工等待与阶段瓶颈 |
| 任务入队、领取、开始、结束；attempt、状态、错误码、重试原因 | 队列等待、P50/P95 时长、成功率、重试率 |
| 外部请求提交/完成与供应商请求 ID | API 等待和本地执行的占比，避免把每次轮询算成新生成 |
| 候选生成、明确采用、明确放弃及返工原因 | 每条成片需要多少次生成，哪些环节返工；未采用不自动推断为拒绝 |
| 费用预留、确认结算、释放、未知账单状态 | 每条/每秒/每档质量成本；预计、预留与实际分别统计，未知不能当零 |
| 导出开始/结束、时长、尺寸、帧率、编码和技术验收结果 | 导出性能、技术通过率、质量分档与实际产物 |
| Worker 活跃槽位、队列深度、本机重任务、资源压力 | 并发 2 的实际收益与下一步瓶颈；采样或状态变化记录，不逐轮刷日志 |

共同维度：eventId、schemaVersion、UTC 事件时间、account/episode/shot/task/request/attempt ID、provider/model、项目定义的质量档（与供应商 quality 参数分开）、资源类别。保留关联 ID 做幂等，不记录 API Key 或为统计重复复制正文。

并发后要同时保留“墙钟耗时”和“累计槽位耗时”：两个任务重叠的十分钟，前者是十分钟，后者是二十槽位分钟。现有 `workerRunSeconds` 合并重叠时段，不能直接当作累计槽位消耗来推算最大产能。月报还应统一时区与完成口径，当前项目可按 Asia/Shanghai 的实际交付完成时间归属月份。

## 8. 并发调整及验收

- `.loop-control/local/deployment.json` 唯一语义变化：`worker.concurrency: 1 → 2`；原字段值比较、原字节恢复包、原子写入、正式 `readSettings/validateSettings` 和回读均完成。
- 数据库 scheduler capacity 已为 2，未写数据库。读取当前 `worker_resource_limits(...,2)`，FFmpeg/OpenChatCut/WhisperX 均有 `host:cpu=1`，FFmpeg/OpenChatCut 另有 `host:render=1`；不额外写一份重复限制。
- 3 文件 5 项相关测试通过，包含真实调度器同时保持两个任务、唤醒合并与停止行为。测试未执行真实视频或付费 API，不能据此承诺日产量。
- 日常 5174/5175 均未运行；未启停日常服务，配置将在下次启动时加载。5298 仅为上述只读预览，不承载 Worker。
- 最终三份 CSS 字节与补丁、HEAD、空暂存区及其他配置保持；资源读取与保护摘要见 [verification.json](verification.json)。
