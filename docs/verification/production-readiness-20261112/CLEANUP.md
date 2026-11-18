> 2026-11-12 清理回执：本轮隔离运行环境和测试数据已清理，报告与修复代码保留。详见 [`acceptance-cleanup-20261112/REPORT.md`](../acceptance-cleanup-20261112/REPORT.md)。以下内容保留为历史资源清单，不再表示环境仍在运行。

# 本轮隔离环境与清理范围


> 产物清理记录（2026-11-18）：本目录的历史测试生成附件已按用户要求清理；本文验收结论保留。源测试输入、恢复资料、生产单和数据库未删除。

当前保留，未自动删除。确认不再审看后，仅清理本轮拥有的资源；先停应用和本轮Studio，再备份所需视频与ZIP。

| 对象 | 本轮位置/身份 |
| --- | --- |
| 分支 | `codex/live-production-acceptance-20261112`，不合并/推送 |
| 当前应用 | `http://127.0.0.1:5227`，入口 `docs/verification/production-readiness-20261112/server.mjs` |
| 进程 | 当前PID在 `.scratch/production-readiness/server.pid`；停止前用 `ps -p PID -o command=` 核对精确入口，不能按通用node/端口批量杀进程 |
| Studio | 本轮应用按需启动的独立OpenChatCut；关闭本轮应用前保存并退出本轮Studio |
| PostgreSQL | 容器 `loop-production-readiness-20261112`；标签 `com.loop-control.test=production-readiness-20261112`；仅55440 loopback |
| Docker卷 | `loop-production-readiness-20261112-data`；删除容器后单独确认再删该卷 |
| 数据库 | 容器内 `loop_t24_restore_daily`、`loop_t24_restore_sample`，不是日常库 |
| 全部私有素材/恢复/日志 | 当前工作树 `.scratch/production-readiness/`（含真实成片和本轮备份） |
| 最终视频/ZIP | 上述目录 `R02-final.mp4` 至 `R05-final.mp4`（视频是本轮真实注册文件的符号链接）及 `R02-delivery.zip` 至 `R05-delivery.zip` |
| 独立所有者登录 | `.scratch/production-readiness/login.json`，0600，仅本轮克隆；不得提交或在报告贴出密码 |
| 浏览器 | agent-browser会话 `loop-live-acceptance-20261112` 与本轮vault `loop-readiness-20261112`；前轮vault/会话含旧样片，按需保留，不批量清空 |
| 精确锁定依赖副本 | `/tmp/loop-production-readiness-20261112-dependencies/node_modules`；当前工作树 `node_modules` 指向此处。仍要运行分支就保留，删除前检查符号链接目标；未向日常node_modules安装依赖 |
| 本轮验证文档 | `docs/verification/production-readiness-20261112/`，已提交的可复核记录，通常保留 |

不要删除/重启日常 `/Users/dan/Programs/loop-control` 的数据库、媒体根、服务、Keychain、模型、依赖或并行改动。不要顺手清理前轮 `.scratch/live-production/`、旧验收容器 `loop-live-acceptance-20261112`、其Docker卷与外盘素材 `/Volumes/Ebuget 1T/Loop-Control-Acceptance-20261112`；它们属于前轮样片和48项证据，清理需另按前轮清单核对。

代码复验：`npm run check`、`npm run build`、`npm test -- --maxWorkers=2`。真实集成使用 `LOOP_WORKSPACE_ACCEPTANCE=1` 与 `LOOP_TEST_CONTEXT_MODULE=$PWD/docs/verification/live-production-20261112/test-context.mjs`；该夹具先检查精确容器标签/卷，仅操作随机临时库。OpenChatCut集成另将 `OPENCHATCUT_ROOT`、`LOOP_TEST_OPENCHATCUT_ROOT` 指向私有 `.scratch/live-production/IntegrationOpenChatCut`。故障卷集成会自行创建/卸载本轮私有APFS磁盘镜像，不能替换为日常磁盘。

`01-daily-upgrade.mjs`、`prepare-daily-copy-app.mjs` 和真实SIGKILL脚本是有状态复现入口，不应在现有已交付副本上随意重复。审计脚本只读数据库、核对现存文件并输出证据；真实付费制作仅从前端明确确认，不能把诊断脚本当作自动批量生成器。
