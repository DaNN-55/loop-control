# 已批准隔离范围的原生部署入口

本说明适用于优化 worktree 的 stage-d 隔离 PostgreSQL，不是生产部署或新主机安装指南。应用默认不启用 Worker、Keychain、在线验证或 Studio；缺配置不读取旧环境文件，也不回落远端。

## 正常启动与能力配置

使用同一私有部署文件启动、停止：

```sh
npm start -- --deployment /absolute/private/deployment.json --offline-test
npm stop -- --deployment /absolute/private/deployment.json
```

部署文件必须是本 worktree 的 `.loop-control/stage-d/state/t24-*/` 或 `t25-*/` 直属私有文件；应用 55189、PG `127.0.0.1:55472`，应用角色 `loop_app`，Worker 为同库的 `loop_worker`。T25 仍限 `loop_t25`；恢复目标限 `loop_t24_restore*`，并核对实际恢复回执和数据库媒体绑定。默认无 `--deployment` 时仍使用原 `loop_imported` 的既有安全配置（未提供 Worker 时相关执行明确不可用）；未创建默认 `native-worker.json`。

部署配置可显式提供以下非秘密能力字段。数据库密码只在既有私有配置中，不复制到文档。

- `connections.keychain`：`approved`、本 worktree 的 stage-d `runtimeRoot`、已固定 helper 的 `helperSha256`。仅限现有专用合成测试 Keychain；没有配置时禁用，不访问登录/系统 Keychain。
- `connections.verification`：省略或 `disabled` 时禁用；`pexels-offline` 装配实际 probe，但请求预留恒为 false，返回可重试结果，`externalReady:false`，不能产生 live verified 资格。在线策略配置会被拒绝；此入口没有在线预算开关。
- `openChatCut`：`root` 固定为本 worktree 的 `.loop-control/stage-b/verified/OpenChatCut`，`node` 必须是当前 Node 的规范路径，`port:55190`。同时需明确的 `worker.studio:true` 和本机媒体配置 `worker.media:{"mode":"local"}`。该模式允许本机媒体工具和 Studio，冻结任务需要外部连接时在 CLI 前置检查中阻塞。
- Worker 的执行命令、媒体挂载点和运行约束继续显式提供。正常启动负责准备与核对 runtime；前端构建会清理 `dist`，构建完成后应重新正常启动，不在构建过程中验收 Worker。

55190 是本次隔离部署的单 Studio 端口。不能据单工程打开证明并行编辑器容量、完整渲染或通用部署能力。

## 从恢复回执生成正常配置

先使用现有 `scripts/local/native-restore.mjs` 恢复到新批准库及独立媒体。该命令拒绝覆盖已有目标；原始对账、权限及媒体检查成功才发布 ready 回执。失败目标保留。

将下面四个绝对路径写入一个私有输入 JSON：`sourceFile` 为已批准的源部署文件，`receiptFile` 为目标媒体旁的 `restore-receipt.json`，`outputFile` 位于目标 `state/t24-*/` 私有目录，`mountPath` 为同目录内包含该媒体的独立挂载点。

```sh
node scripts/local/deployment-restore.mjs < /absolute/private/restore-deployment-input.json
```

工具只继承同一隔离实例的应用/Worker 配置，将二者同时绑定到回执的新库，并生成新的 home、运维状态和服务记录位置；不改变默认部署、不接受任意库/目录。随后使用保留的 Owner UUID：

```sh
node scripts/local/owner.mjs OWNER_UUID --initialize-restored loop_t24_restore_TARGET
```

密码只经 stdin 输入。仅允许对尚未初始化的恢复库设置新密码；原密码、原会话不会导入，账号成员关系和业务 ID 不重建。

使用新部署文件正常启动后，Owner 必须对缺失秘密引用显式 `rebind`。资格在恢复时全部清零，旧验证历史保留，不能用备份里的 verified 标记、模拟结果或离线 probe 恢复在线资格。HTTP 与 Worker 均保留 pending/failed 和媒体根绑定围栏；ready 队列可以续跑，有效的 30 分钟 Worker 租约不因此立即转移。

本次完整证据及未关闭门禁见 [D 收尾报告](verification/stage-d-close/README.md)。
