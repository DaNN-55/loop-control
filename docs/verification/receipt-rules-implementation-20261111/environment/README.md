# 回执规则隔离验收环境

2026-11-11：从仓库 schema 创建全新 PostgreSQL。未加载日常部署配置、日常数据库数据或 Keychain，未调用真实供应商，付费调用为 0。

- 容器：`loop-receipt-5a18fd183ee2`
- 身份标签：`com.loop-control.test=receipt-5a18fd183ee2`
- 镜像：`sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`
- Docker socket：`unix:///Users/dan/.colima/loop-control/docker.sock`
- 网络：`none`；数据目录：tmpfs；无主机端口、bind mount 或持久 volume。
- 基准库：`loop_receipt_baseline`，共 157 项迁移，最新为 `160-episode-recycle-bin.sql`。
- 环境模块：本目录 `runtime-context.mjs`，供 `LOOP_TEST_CONTEXT_MODULE` 加载。

`setup.mjs` 固定只应用编号不大于 160 的迁移，生成随机容器名及标签并核对镜像身份。每次 fixture 在独立随机数据库导入 schema 和迁移账本，不复制业务数据。新迁移 161+ 应由 fixture 的 `migrations` 显式前向声明，基准库与账本保持不变。

环境模块在每次 Docker exec 前检查镜像、标签、网络、端口、tmpfs 和挂载；仅允许本容器 exec 和测试数据库名称。它不会加载 `scripts/runtime/environment.mjs` 或访问日常容器。

## 创建与烟测

在仓库根目录执行创建命令；已有活动容器时先完成本轮验收并清理，避免覆盖 context：

```sh
node docs/verification/receipt-rules-implementation-20261111/environment/setup.mjs
```

实际烟测命令：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/docs/verification/receipt-rules-implementation-20261111/environment/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run src/local-app/workspaceCatalog.integration.test.ts --maxWorkers=1 --fileParallelism=false --reporter=verbose
```

`setup.log` 保存成功创建记录；`smoke.log` 保存真实 HTTP + PostgreSQL 的 workspaceCatalog 集成烟测输出。`baseline.json` 保存迁移账本摘要与隔离身份检查结果。

本次烟测通过 1/1，用时 2.10 秒。烟测完成后运行 `cleanup.mjs` 的只检查模式，结果为测试库 0 个、其他客户端 0 个；活动容器保留给主 Agent 继续验收。未运行全量测试、构建或在线生成。

首次创建时将 Docker tmpfs 的空选项字符串误认为缺失，身份检查因此拒绝继续；改为检测该属性是否存在，并逐项核对身份后销毁首次空容器 `loop-receipt-6918ce4b723b`。`setup-initial-failed.log` 保留这次错误，不作为通过回执。

## 安全清理

本目录不自动销毁活动环境，最终由主 Agent 执行。停止前必须等所有 fixture 关闭；以下脚本检查镜像、任务标签、网络、端口、tmpfs、无宿主挂载，并拒绝在还有测试库或其他客户端时停止。

只检查：

```sh
node docs/verification/receipt-rules-implementation-20261111/environment/cleanup.mjs
```

本轮验收完成后停止：

```sh
node docs/verification/receipt-rules-implementation-20261111/environment/cleanup.mjs --stop
```

容器以 `--rm` 创建，停止后容器和 tmpfs 自动移除。旧回收站验收目录与其已停止容器不属于本环境，本轮没有修改它们。
