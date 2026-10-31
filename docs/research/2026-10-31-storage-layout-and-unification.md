# 数据保存位置与统一建议

日期：2026-10-31。范围：Loop Control 当前本机部署、内容与工程持久化、历史、配置、秘密、浏览器草稿和备份。依据为本轮只读部署检查、实际挂载、数据库目录与源码；没有迁移、移动或删除现行数据。本轮还单独验证并修复了剪辑恢复问题，见[实际验证报告](../verification/storage-layout-sqlite-20261031/REPORT.md)。

## 结论

目前保存方式分为 PostgreSQL、OpenChatCut SQLite、文件、Keychain 和浏览器存储。多种格式各有明确用途；主要需要统一的是数据根目录、分类、路径映射和备份口径，以及避免同一份可编辑工程有两个权威来源。

当前活跃文件大部分已经集中在 `/Users/dan/Programs/loop-control/.loop-control/local/`。主要例外是 PostgreSQL 所在的 Colima 虚拟磁盘、操作系统 Keychain 和浏览器配置目录。界面或旧蓝图里出现的外盘路径不一定是当前实际 I/O 路径；媒体恢复映射会把它们转换到当前媒体卷。

## 当前完整分类

下表的 `R` 指 `/Users/dan/Programs/loop-control/.loop-control/local`；`A` 指 `R/volume/media/<账号目录>`；`E` 指 `A/episodes/<Episode ID>`。这些缩写只用于阅读说明，不是新配置。

| 信息 | 类型与权威来源 | 当前位置与保存方式 |
| --- | --- | --- |
| 所有者、登录口令摘要、会话、个人偏好 | PostgreSQL | `loop_control` 数据库，主要在 `local_identity`；口令摘要不是明文密码，正式偏好不只在浏览器里 |
| 内容账号、蓝图与版本、系列、Prompt 配置 | PostgreSQL / JSONB | `public` 的账号、版本及配置表；跨版本引用保留在主库 |
| Episode、材料登记、脚本版本、镜头输入、素材和音轨候选 | PostgreSQL / JSONB | 主库保存关系、版本 ID、来源、路径、SHA、大小、选择与采用记录；正文和媒体字节另外保存为文件 |
| 任务、尝试、租约、重试、预算、审批、审计、通知与自动化记录 | PostgreSQL | 主库是事务权威；不能用本地 JSON 日志或编辑器 SQLite 替代审批和账务记录 |
| 剪辑时间线、轨道、片段、字幕、转场、混音、原生工程相关记录 | OpenChatCut SQLite | `E/openchatcut-work/current/runtime/project-store-v1.sqlite3`，及运行中的 `-wal` / `-shm`。编辑器当前工程以这里为准 |
| Loop Control 已保存的工程版本、导出和交付绑定 | 不可变 JSON + PostgreSQL 索引 | `E/production-workspace/versions/<SHA>.json`；主库记录当前版本、SHA、来源和历史。它是保存版本与审核依据，不是与 SQLite 并行编辑的第二份时间线 |
| 编辑器与宿主交换快照、来源映射及旧工程兼容文件 | JSON 文件 | `E/openchatcut-work/current/project.json`、`workspace.json`、`generated-project.json`；SQLite 迁移前的 JSON 可能保留为 `.migrated`、按条目目录和迁移回执，不能当成最新工程 |
| 上传原稿、主脚本正文、原视频、图片、录音、生成结果、分镜和字幕证据、审核成片、导出和交付包 | Markdown / JSON / 音视频图片等文件 | 都在 `E` 下，按 `materials/`、`input/`、`audio/`、`approved-plan/`、`review-render/`、`wan/`、工作台导出与交付目录分类；主库保存指纹与引用。导出到 Owner 另选目录的副本不成为主库存储权威 |
| 独立 OpenChatCut（侧栏入口） | 单独的 SQLite / 媒体 / 缓存 | 当前代码使用 `R/volume/media/openchatcut/standalone/<Owner ID>/`，与某一期嵌入工程分开。另有旧目录 `/Users/dan/Programs/loop-control/.loop-control/openchatcut/standalone/`，本轮未移动或清理 |
| 历史来源、旧版本及历史文件 | PostgreSQL 历史表 + 内容寻址文件 | 主库 `history_*` 表保存目录、归属与版本；文件保存在 `R/history/content/<SHA>`，另有整合结果 JSON。这是历史资料区，不能按缓存删除 |
| Provider API Key、数据库连接秘密及解锁材料 | macOS Keychain | 应用 Keychain 文件在 `R/keychain/loop-control.keychain-db`，解锁辅助材料由系统 Keychain 管理；主库、`deployment.json`、`secret-index.json` 保存受保护引用和映射，普通配置不回显秘密 |
| 部署、端口、数据库/媒体绑定、进程、日志、健康检查与限额状态 | JSON / JSONL / 日志 | `R/deployment.json`、`R/app.json`、`R/app-private.log`、`R/state/`。其中网络额度和去重状态可能参与运行行为，不能把整个 `state` 目录都当可随意删除的缓存 |
| 原生编辑器的本期设置 | `settings.env` 等 SDK 配置文件 | 各自 SDK 数据目录下；本轮只读检查当前真实工程的该文件，敏感字段为空，未显示任何配置值。SDK 设置仍应纳入配置盘点，不能假定所有文件均只是界面偏好 |
| 界面外观、侧栏、分栏比例、未提交的审核/操作文字 | 浏览器 localStorage | 按当前浏览器配置和网站 origin 保存；正式个人偏好另由 PostgreSQL 保存。换浏览器、换端口或清站点数据可能丢失仅在本地的草稿 |
| 未提交的生成表单、插入镜头文字、请求防重标识 | 浏览器 sessionStorage | 同一网站的标签页会话内；不在服务器数据库或正式业务备份里 |
| 尚未上传完成的文件草稿 | 浏览器 IndexedDB | `loop-control-material-imports` / `episode-drafts`。某些 OpenChatCut 媒体缓存和界面连续性设置也使用浏览器存储；服务端 SQLite 并不接管这些全部缓存 |
| OpenChatCut、Python、模型、构建与预览缓存 | 安装依赖 / 可重建缓存 | `R/OpenChatCut/`、`R/python/`、`R/volume/media/whisperx-models/`、`R/state/vite-cache/`、各工程 SDK runtime 中的预览/Vite 缓存，以及仓库的 `node_modules/`、`dist/`。SDK 旧版完整回滚副本另在 `R/OpenChatCut-v0.2.14-backup-20261030/` |
| 本项目代码、SQL 迁移、ADR、验证证据 | Git 文件 | `/Users/dan/Programs/loop-control/`；`db/local/` 原始迁移和 SHA 属于历史契约，`docs/verification/` 是验证证据，不是实际业务数据库 |
| 本轮之前清理的源码/临时材料恢复包 | 私有压缩归档 | `/Users/dan/Programs/loop-control/.loop-control/archives/local-main-batches-20261030/`。它保留当时未提交文件和临时材料，不等于包含真实数据库、全部媒体及 Keychain 的完整业务备份 |

浏览器存储的物理目录取决于使用 Chrome、内置浏览器及其配置。本轮确认了代码中的存储名与用途，没有读取用户 Cookie、草稿正文或猜测其物理配置目录。

## 物理上究竟在哪里

1. **主 PostgreSQL**：Colima profile `loop-control` → 容器 `loop-control-local-postgres` → Docker volume `loop-control-local-data`，容器内为 `/var/lib/postgresql/data`，虚拟机内部实际卷路径为 `/var/lib/docker/volumes/loop-control-local-data/_data`。宿主机承载它的虚拟磁盘是 `/Users/dan/.colima/_lima/colima-loop-control/disk`；不能把容器内路径当成 macOS 普通目录搬走。
2. **活跃媒体与嵌入工程**：`R/volume` 是已挂载的本地 APFS 磁盘映像，文件是 `R/media.sparseimage`；媒体位于挂载后的 `R/volume/media`。它目前在 Mac 本地，不是直接写到外接盘。映像文件和挂载目录是同一套内容的不同表示，统计大小时不要重复相加。
3. **外盘逻辑路径**：本轮查询到蓝图中有 `/Volumes/Ebuget 1T/loop-control/rizhao-jinshan` 和 `/Volumes/Ebuget 1T/Media/accounts/doubao/`。恢复配置将相应来源根映射到 `R/volume/media/rizhao-jinshan` 和 `R/volume/media/doubao`。原外盘上仍可能保留独立旧副本；本轮未做外盘全量重复文件审计，不能据此删除。
4. **历史资料**：`R/history` 在主仓库所在磁盘，和媒体磁盘映像是不同的数据区。

只读用量快照约为：活跃媒体树 3.7 GiB、历史区 3.9 GiB、当前 SDK 2.4 GiB、Python 环境 952 MiB、运行状态/缓存 16 MiB、上一轮私有归档 30 MiB；Colima 虚拟磁盘的实际分配约 1.3 GiB。它们不是迁移成本、清理收益或完整备份大小的估计。

## 备份现状

配置中的正式备份根为 `R/backups/loop_control`，但本轮检查到 `automaticBackups=false`，该目录不存在，因此不能声称当前每天都有完整备份。

[备份实现](../../scripts/storage/backup.mjs) 会导出 PostgreSQL 的一致性快照、复制媒体树并检查源文件未变化，保存 `business.dump`、`manifest.json` 和媒体文件；它明确排除 Owner 口令摘要、会话和 Keychain。历史内容区不在当前媒体根中，该函数没有显式归档整个 `R/history/content`；需要单独验证历史文件是否完整覆盖。原生 SQLite 正在写入时也需要验证备份/恢复的一致性，不能仅把运行中的主 `.sqlite3` 文件当成完整备份。

业务备份、Keychain 恢复与重新绑定、历史内容区、浏览器未提交草稿必须分别说明。Git 和上轮临时材料压缩包不能替代业务备份。

## 建议如何统一

**建议先统一数据管理和位置，保留现有格式的职责。** 将 SQLite 用作编辑器当前工程、PostgreSQL 用作业务记录、文件用作媒体与不可变版本、Keychain 用作秘密。一个对象只有一个可编辑权威，其他形式明确标记为快照、缓存或备份。

先采用不迁移数据的整理方案：

- 建立一个可查看的存储清单：当前数据根、真实挂载、媒体映射、PostgreSQL 卷、Keychain、备份上次成功时间和是否启用。
- 区分 `data`（正式内容）、`config`、`runtime`、`cache`、`history`、`backups`，为已有目录声明用途和保留规则。不要用“全是 JSON”或“全是 SQLite”代替职责划分。
- 正式内容与编辑器工程按账号/Episode 归档，数据库引用尽量使用受控的根标识和相对路径；历史根别名保留映射，迁移时不改写不可变历史。
- 让备份覆盖主库、媒体、最新 SQLite 工程、历史内容，并明确排除项和恢复操作；启用自动备份需要单独确认目的盘、容量与恢复演练。
- 重要未提交草稿若要跨设备/浏览器保存，应改为由应用管理的草稿；浏览器只保留临时界面状态。这是后续行为改动，本轮未实现。

若以后实施物理位置统一，可将一个可配置的 `dataRoot` 放在本机稳定位置（例如 `~/Library/Application Support/LoopControl/`），代码仓库只保留代码。正式媒体、工程、历史与配置归到这个根下，备份放到另一块盘。现阶段路径校验、部署身份、媒体恢复回执、秘密引用和历史映射都绑定当前目录，必须通过迁移/校验和回滚完成，不能直接 Finder 拖动或批量替换字符串。

保留 Colima 时，PostgreSQL 底层仍由其虚拟磁盘管理；可以统一管理入口和备份，但不能声称它已变成同一个普通文件夹。若必须实现完整的宿主机单根目录，可另评估原生 PostgreSQL 部署，保持现有 SQL 语义，作为与整体更换 SQLite 不同的部署选项。

本轮只提出方案，没有移动数据、启用备份、修改秘密或切换数据库。

## 源码依据

- [部署与路径校验](../../scripts/runtime/environment.mjs)、[挂载与服务](../../scripts/runtime/services.mjs)、[应用装配](../../scripts/runtime/application.mjs)
- [媒体逻辑路径映射](../../src/local-app/mediaPaths.ts)、[实际文件与指纹](../../src/local-app/localFiles.ts)、[媒体部署](../../src/local-app/mediaDeployment.ts)
- [编辑器工程读写](../../src/worker/openchatcutStudio.ts)、[工程版本与保存命令](../../src/local-app/productionWorkspaceCommands.ts)
- [Keychain 适配](../../src/local-app/keychainStore.ts)、[系统引导与引用](../../scripts/runtime/keychain.mjs)
- [历史目录与归属](../../src/local-app/history.ts)、[正式偏好](../../src/local-app/ownerPreferences.ts)
- [操作草稿](../../src/operationDraft.ts)、[上传草稿](../../src/reviews/materialImportDraftStore.ts)、[请求会话状态](../../src/local-app/client.ts)
