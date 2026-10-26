# 日常本地运行

适用目录：`/Users/dan/.codex/worktrees/local-first-optimization/loop-control`。本机日常资源已准备；本说明不代表任意新主机安装器或原生产数据已切换。

## 启动与停止

在当前 worktree、Node 24 环境下执行：

```sh
npm start
```

打开 `http://127.0.0.1:5174/`。界面沿用原侧栏、账号蓝图、系列、生产单表格、审核队列、运营视图和详情抽屉；登录与操作通过本地 API 完成。

```sh
npm stop
```

停止只处理身份匹配的日常应用及其 Worker/Studio，保留数据库、媒体和证据。重启时应用自动准备编译产物，确认专用 PostgreSQL 与媒体挂载，并解锁本应用专用 Keychain；不会启动 Supabase 或 n8n，不读取旧 `.env.local` 或 `n8n/worker.env.local`。

已有待应用的前向迁移时，停止应用后执行：

```sh
npm run runtime:migrate
npm start
```

迁移命令先核验所有已应用文件 SHA，生成完整备份后再逐项事务应用，不能覆盖或修改旧迁移。`npm run build` 会清理 `dist`；构建后应重新正常启动，避免旧 Worker 使用失效编译产物。

## 资源位置

| 内容 | 位置 |
| --- | --- |
| 私有配置 | `.loop-control/local/deployment.json` |
| 应用 | `127.0.0.1:5174` |
| Studio | `127.0.0.1:5175`，资源副本 `.loop-control/local/OpenChatCut` |
| PostgreSQL | Colima `loop-control`，容器 `loop-control-local-postgres`，数据库 `loop_control`，端口 `127.0.0.1:54329` |
| 持久数据 | Docker 卷 `loop-control-local-data`；容器内 `/var/lib/postgresql/data`，不是 SQLite 文件 |
| 媒体 | `.loop-control/local/volume/media`，由本应用 `media.sparseimage` 挂载 |
| Python | `.loop-control/local/python/venv`；模型缓存位于日常媒体中的 `whisperx-models` |
| 连接秘密 | 本应用独立 Keychain：`.loop-control/local/keychain/loop-control.keychain-db` |
| 完整备份 | `.loop-control/local/backups/loop_control` |
| 私有日志/服务记录 | `.loop-control/local/app-private.log`、`app.json`、`state/` |

配置、密码、Keychain、媒体和备份均留在 Git 忽略的运行目录，不放进前端或聊天。首次本机 Owner 登录材料保存在 `.loop-control/local/owner-login-private.json`；登录后可通过“所有者设置”修改密码，该文件不会自动跟随密码修改。密码变更撤销其他会话，保留当前会话。

## 已有数据与外部能力

日常库由此前完成生产的验收库完整备份恢复，51 表、29,060 行、974 个媒体文件先完成原始对账，再增加本次日常检查数据和前向迁移。原验收库、媒体、账本和公开证据保留，不作为日常服务的数据源。

历史蓝图和任务里的旧逻辑路径保持原字节，运行时映射到日常媒体副本。本次恢复保留历史能力开关；启动前核对原可执行历史队列为空，没有重放旧任务。新生产单由本地界面显式启动。

恢复不会携带旧 Owner 密码、登录会话或 Keychain 明文。旧 Provider 验证历史保留，部署资格清零；连接必须在日常环境重新绑定并验证。当前日常网络预算策略关闭、零调用；原先已耗尽或结果未知的验收账本没有重置或复用。4 家 Provider 豁免继续不计技术通过。CLI 规划使用本机既有 Codex 登录，任务由 Owner 操作触发，本次验收不新增模型调用。

Worker、通知、健康检查与完整备份由应用内调度负责，不依赖 n8n。旧 Supabase/n8n 代码仅通过显式 legacy 入口使用；`scripts/local/` 与旧 `--deployment` 入口保留供历史验收复现，无参启动不会回落这些验收配置。

本轮实际验证及限制见[日常主程序验收](verification/local-daily-runtime-20261026/README.md)，架构边界见[ADR-0009](adr/0009-daily-native-workspace.md)。
