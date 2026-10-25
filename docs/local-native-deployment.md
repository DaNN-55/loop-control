# 已批准隔离范围的原生部署入口

本说明适用于优化 worktree 的 stage-d 隔离 PostgreSQL，不是生产部署或新主机安装指南。应用默认不启用 Worker、Keychain、在线验证或 Studio；缺配置不读取旧环境文件，也不回落远端。

## 正常启动与能力配置

使用同一私有部署文件启动、停止：

```sh
npm start -- --deployment /absolute/private/deployment.json --offline-test
npm stop -- --deployment /absolute/private/deployment.json
```

部署文件必须是本 worktree 的 `.loop-control/stage-d/state/t24-*/` 或 `t25-*/` 直属私有文件；应用 55189、PG `127.0.0.1:55472`，应用角色 `loop_app`，Worker 为同库的 `loop_worker`。T25 仍限 `loop_t25`；恢复目标限 `loop_t24_restore*`，并核对实际恢复回执和数据库媒体绑定。默认无 `--deployment` 时仍使用原 `loop_imported` 的既有安全配置（未提供 Worker 时相关执行明确不可用）；未创建默认 `native-worker.json`。

可以通过可选的 `.loop-control/stage-d/default-deployment.json` 将无参入口指向一个已批准的独立部署。没有该文件时保留上段行为；有文件时每次重新执行完整的部署/恢复回执校验，错误指针明确失败，不回落旧库。指针和目标均私有，不进入 Git。停止服务后才能首次设置；历史已死亡的服务记录保留，不因记录文件存在就当作活服务。

## 本地已有资产的离线准备

先按目标平台准备 Node 24、完整 lockfile 依赖（启动仍需要 Vite/TypeScript）、数据库与角色/媒体、FFmpeg/FFprobe、OpenChatCut，以及专用 Python/WhisperX 和指定中文模型。此命令不安装依赖、不下载文件，也不代替新主机安装器。Python 应使用限制出网的执行封套；HF offline 标志不能代替 OS 网络限制。

在目标部署文件旁放置私有 `offline-assets.json`：`version:1`、`python` 精确版本、`model` 为 `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`、`packages` 为 `{name,version}` 数组、`files` 为 `{path,bytes,sha256}` 数组。文件必须在本 worktree 内且不经符号链接。清单覆盖模型实际加载的配置/权重及缓存引用、NLTK 分句数据、Python 包元数据与执行封套；HF 快照可准备为实体文件。模型 revision 与来源摘要另行保存，包元数据摘要不等于全部 wheel 内容锁定。

```sh
npm run local:prepare-offline -- --deployment /absolute/private/state/t24-TARGET/deployment.json --set-default
npm start -- --offline-test
npm stop
```

准备命令核对本地文件 SHA、编译运行程序，显式初始化 Python 依赖（120 秒安全上限，仅导入模块，不加载模型），然后调用实际 Worker 的原 **30 秒**模型 probe。两段耗时分别记录在私有 `offline-preparation.json`；失败不发布 ready 回执或新默认指针。已有指针不自动覆盖；对同一目标重新准备时省略 `--set-default`。

选中的默认部署或标记 `offlinePreparationRequired:true` 的显式部署，在正式启动监听前核对准备回执、文件 SHA、部署/脚本身份和 Node 版本；失效时要求重新准备。该检查不重新加载模型，实际任务仍保留原 30 秒 preflight。缺少 Python 包、模型或冷初始化未完成都不能由“页面已监听”推定可用。验收仍须覆盖正式入口的真实任务与产物。

本命令不改变宿主网络。`--offline-test` 对本轮 Node 进程树施加现有本机端口 guard；渲染需要临时 loopback 端口时可在单独阶段用 OS loopback 策略验证，模型进程继续需要独立全断网策略。不得把测试封套当作通用主机防火墙。

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
