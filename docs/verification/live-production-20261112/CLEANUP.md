# 验收环境保留与清理

本轮不清理成品。分支为 `codex/live-production-acceptance-20261112`，代码与报告在独立 worktree，应用监听 `127.0.0.1:5217`。右侧使用独立验收账号登录；测试登录信息仅保存在忽略目录 `.scratch/live-production/login.json`，不要提交或转发该文件。

## 保留哪些文件

先从已完成生产单下载 ZIP。包内有成片、原图封面、文案、检查报告、清单和工程 JSON；**不包含源素材**。继续编辑时，应保留整个 `/Volumes/Ebuget 1T/Loop-Control-Acceptance-20261112`、隔离数据库以及本 worktree 的私有部署文件。

应用关闭后，挂载外置盘并在本 worktree 执行以下命令可重新启动：

```sh
node docs/verification/live-production-20261112/server.mjs
```

首次代码构建或修改后，先执行 `npm run build` 和 `npm run runtime:prepare`。不要重新运行 `setup.mjs`；它只用于创建新空库，且会拒绝覆盖现有容器。Studio 使用每次会话分配的端口，5218 只是配置初始值。

## 确认不要数据之后

1. 关闭右侧验收页面，退出本轮剪辑会话。用 `lsof -nP -iTCP:5217 -sTCP:LISTEN` 和 `ps -p <PID> -o command=` 核对监听进程属于本 worktree 的 `server.mjs`，再向这个 PID 发送 `TERM`。不要直接使用可能已过期的 `server.pid`。
2. 用以下命令核对容器标签。标签必须是 `live-production-20261112`：

   ```sh
   docker --host unix:///Users/dan/.colima/loop-control/docker.sock inspect loop-live-acceptance-20261112 --format '{{index .Config.Labels "com.loop-control.test"}}'
   ```

3. 停止并删除**该容器**，再删除它的专属卷 `loop-live-acceptance-20261112-data`。数据库名为 `loop_live_acceptance`，映射端口为 55439；不涉及日常库。
4. 只删除本轮媒体根 `/Volumes/Ebuget 1T/Loop-Control-Acceptance-20261112`。确认不需报告中的本机下载后，再处理本 worktree 的 `.scratch/live-production/` 与 `.loop-control/local/`。
5. 本地提交保留后，可从主工作区移除此 worktree，再按需删除验收分支。不要强制移除含有你后续未提交修改的 worktree。

共享的日常 Keychain、模型缓存、原项目 `node_modules`、日常数据库、原始下载图片均不属于清理范围。三个已确认由本轮 MCP 会话产生的本地 token 目录为 `~/.openchatcut/dev-profiles/{e0056e4f-94e4-48ef-a04f-afb21d564603,ad0e29e0-3129-4fab-bf7d-33c3a50062bf,d587e15e-2354-4d0c-a1d3-7c7b2ee25157}`；它们不含供应商 API Key，如清理也仅处理这三个明确目录，不通配整个 dev-profiles。
