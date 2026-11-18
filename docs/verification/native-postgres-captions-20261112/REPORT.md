# 原生 PostgreSQL 与字幕工作区交付记录

> 产物清理记录（2026-11-18）：本报告所链接的部分历史截图、视频、日志或导出附件已按用户要求清理；原验收事实保留，已删除附件改为文字标记。生产单、数据库、业务素材及必要测试输入未删除。


> 后续变更：自动校时已按用户新决定移入分镜台，见 [当前交付记录](../caption-preparation-20261112/REPORT.md)。本文保留当时验收结果。

2026-11-12。用户批准执行。已完成隔离验证、日常数据库切换和真实页面检查；保留并行 CSS，不提交、不推送。旧 SQL 基线、埋点与组件迁移继续暂缓。

## 当前结果

- 日常 PostgreSQL 已由 Linux 容器 17.6 迁为 macOS 原生 17.11，固定工具路径 `/opt/homebrew/Cellar/postgresql@17/17.11_1/bin`，数据库 `loop_control`，仅监听 `127.0.0.1:54330`。
- 数据位于 `.loop-control/local/postgres/data`，维护使用其私有 socket。没有启用 Homebrew 全局服务。`npm start/stop` 通过项目运行端口管理 App 和专属 PG，日常不再需要 Docker/Colima/SSH 数据库转发。
- 日常 App `http://127.0.0.1:5174` 已启动，后端、Worker 与准备好的运行版本一致。Owner session/catalog/system-status 均真实返回 200；短期验收会话已删除。全局/数据库并发 2，本机 CPU 重任务与渲染限制仍为 1，自动备份仍关闭。
- 旧 `loop-control-local-postgres` 已正常停止，`loop-control-local-data` 卷保留。Colima 中另有 `loop-production-readiness-20261112`、`loop-live-acceptance-20261112` 两组其他对话的测试，未停止或修改它们。
- WhisperX 以“自动校准字幕时间”呈现在真实 OpenChatCut 字幕工作区，并在宿主剪辑栏提供直接入口。两入口打开同一字幕面板，保留排队、状态、错误恢复、采用、手工编辑及原生保存/重开。SDK、模型和 Python 环境保留。

## 数据与恢复材料

使用逻辑导出跨操作系统迁移，未复制 PG 物理数据目录；角色单独导出，恢复原有 SCRAM 校验值、Owner 凭据和 Keychain 引用。此方式遵循 [PostgreSQL SQL dump](https://www.postgresql.org/docs/17/backup-dump.html) 的跨平台恢复和集群角色边界。

迁移前应用/Studio未运行，旧库没有其他客户端、ready/running 任务或待确认原生产物发布。停写状态下导出前后指纹一致。迁移恢复包位于：

`/Users/dan/Programs/loop-control/.loop-control/local/postgres-migration-20261112/`

该目录为私有 0700，归档、角色 SQL、配置和回执为 0600，不进入 Git。包括 `business.dump`、`roles.sql`、`schema.sql`、`deployment-container.json`、目标身份及各阶段对账回执。恢复包 SHA-256：`b74aa64f54ee7dfc8c35a576fe57d806dae1e6c3e2e26ce6902a9d705e3d1000`。这是本次迁移恢复材料，没有启用周期备份。

切换前 **121 表、362 行**内容指纹完全一致；另核对序列 last_value/is_called、角色/成员关系、有效 ACL、列、函数、约束与验证/延迟状态、索引、触发器、RLS、扩展及数据库设置。初始原始比较的三个表示差异保留在私有材料中，最终按以下逻辑口径核验通过：序列 `log_cnt` 是物理 WAL 预记账计数；NULL ACL 按 PG 的 acldefault 展开；CHECK 用 PG 自身的 pretty SQL 保留运算优先级，消除重新解析造成的多余括号。

启动后再次全库核对：120 表内容不变；`media_root_binding` 仅 `updated_at` 因正常启动重申绑定而更新，Owner、路径、设备、inode、挂载位置全部不变。schema、角色、序列未变。当前外盘媒体根为空，未凭空声称验证了其中的日常 SQLite；真实 SQLite 字幕保存/重开在隔离生产单中完成。历史库、媒体盘、Keychain 和外部文件均未迁移或覆盖。

Linux `en_US.utf8` 对应 macOS `en_US.UTF-8`，均保持 UTF8 和区域意图，但跨 OS 的 libc 排序不承诺逐字符等价；本次逻辑恢复重新建立索引并通过约束和业务验证，未引入 ICU。该差异依据 [PG locale 文档](https://www.postgresql.org/docs/17/locale.html) 记录。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npm run check`、`npm run build`、`npm run runtime:prepare` | 通过，日常实际运行版本 current |
| 默认测试 | 288 文件、2118 项通过 |
| 新数据库运行端口、服务与停止合同 | 定向 8 文件、48 项通过，已包含在默认测试中 |
| 字幕 Host/面板/恢复/bridge | 32 项通过；真实私有 SDK 转换接点集成另 1 项通过 |
| 一次性容器业务演练 | 6 个所选场景最终全部通过 |
| Mac 独立原生实例 | 相同 6 个场景最终全部通过；实际启动/停止/重开通过 |
| 独立字幕浏览器 | 1 项完整端到端通过，1280/390 页面实看 |
| 日常服务 | 真实认证 API 200、页面检查、角色权限及启动后对账通过 |
| Git/CSS | HEAD 未变、暂存区为空，三份并行 CSS 和依赖清单字节未变 |

业务演练包含正文恢复、真实进程中断恢复、图片/语音任务与受控 Worker、成片/字幕确认与交付重开，以及视频候选与原生编辑器双字幕入口。初次测试中的旧错误提示等待与旧按钮标签已按实际回执恢复和无障碍名称修正；早期失败证据保留，不以失败报告冒充通过。最终结果来自原 5 个通过场景及修正后单独重跑的第 6 个场景。

独立字幕用例实际经过 `request → Worker claim/report → prepare → 原生写入 → apply`，再在原生编辑器手工修改正文与 200–1200ms 时序，保存返回和重开后值一致。使用受控本地音频及对齐器结果，**没有重跑真实 WhisperX 模型，也没有付费调用**。它证明入口、HTTP、队列、桥和保存能力，不作为模型识别质量证明。

截图：宿主桌面（历史附件已清理：`caption-host-desktop.png`）、字幕工作区（历史附件已清理：`caption-sdk-desktop.png`）、390px 宿主（历史附件已清理：`caption-host-narrow.png`）、保存后重开（历史附件已清理：`caption-saved-reopened.png`）、原生日常工作台（历史附件已清理：`daily-desktop.png`）。原生 SDK 内部窄屏仍拥挤；宿主入口完整可见，页面无横向溢出，SDK入口同时通过键盘激活验证。细节优化按用户要求后续再看。

## 回退边界

1. 当前唯一写入权威为原生库；不要同时启动新旧数据库的两套 App/Worker。
2. 尚无新业务写入时，可停止日常 App/原生 PG，核验旧容器身份和恢复材料，恢复 `deployment-container.json`，再通过日常入口启动旧库并检查。原生目标仍须保留，不删除数据目录。
3. 原生库已有新业务写入后，旧库就是截止于迁移时的快照。必须先停写，将原生最新状态另做完整逻辑导出，在独立目标恢复并对账后再切；不能只覆盖配置，否则会丢失新增生产记录。没有实施自动回退或覆盖旧卷。
4. 自动备份开关、旧 SQL 重整、埋点、组件迁移及其他暂缓项均未执行。

可复核结果见 verification.json（历史附件已清理：`verification.json`）。诊断日志、隔离运行原始证据及过程说明保留于 `/tmp/loop-native-pg-captions-20261112/` 和其中列出的 `/private/tmp/loop-story-e2e-*/evidence`；私有迁移材料以运行目录中的保留副本为准。

## Modern Web Guidance

采用 `accessibility` 的 “Utilize `aria-expanded` and `aria-pressed` to communicate toggle states for custom controls.”；使用原生按钮、独立 `aria-controls` 和展开状态，不引入新组件库。
