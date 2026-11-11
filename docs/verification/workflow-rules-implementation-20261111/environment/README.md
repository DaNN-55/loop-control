# 48 类流程隔离验收环境

2026-11-11：当前源码迁移与日常库 `139-global-storyboard-planning.sql` 校验和不同。为避免更改日常迁移记录，新建独立 PostgreSQL，不复制业务数据。

- 容器：`loop-workflow-48-ef6c49f91450`
- 镜像：`sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`
- Docker socket：`unix:///Users/dan/.colima/loop-control/docker.sock`
- 网络：`none`；数据库：tmpfs；没有 host 端口或持久卷。
- 基准库：`loop_workflow_baseline`，154 个当前迁移；每个测试另建随机库并自行销毁。
- 环境模块只允许操作带随机后缀的测试库，检查容器镜像、标签、网络和卷身份。
- 未读取部署配置、真实秘密或日常业务数据；无付费请求。

执行：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/docs/verification/workflow-rules-implementation-20261111/environment/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run src/local-app/workspaceCatalog.integration.test.ts --maxWorkers=1 --fileParallelism=false
```

烟测通过：1 文件、1 场景；实际 Owner HTTP + PostgreSQL 目录投影，见 `smoke.log`。测试工作目录与素材目录为独立随机临时目录，随 fixture 清理。

## 旧同步预览验收所需 SDK 环境

`workspaceAudioStorage.integration.test.ts` 的 legacy/registered 同步预览使用实际子进程和 SDK 渲染。`openchatcutRenderer.renderProject` 写入的 `spec.openchatcutRoot` 来自 `process.env.OPENCHATCUT_ROOT`，不会自动使用 HTTP fixture 的 `runtime.root`。未设置此环境值时，通用媒体边界报告失败；本次只增加以上 `OPENCHATCUT_ROOT` 环境值，原两例即通过（2 passed、8 skipped，19.65 秒），见 `sync-preview-diagnosis.log`。没有修改业务代码或 SDK。后续实际渲染验收应显式传入 SDK 路径。

全部验收结束后，由主 Agent 核对 `com.loop-control.test=workflow-48-ef6c49f91450` 再清理本容器：

```sh
DOCKER_HOST=unix:///Users/dan/.colima/loop-control/docker.sock \
docker inspect loop-workflow-48-ef6c49f91450 --format '{{ index .Config.Labels "com.loop-control.test" }}'
DOCKER_HOST=unix:///Users/dan/.colima/loop-control/docker.sock \
docker stop --time 5 loop-workflow-48-ef6c49f91450
```

容器以 `--rm` 创建，停止时自动移除并释放 tmpfs。不要停止 `loop-control-local-postgres`。如后续新增迁移，现有基准的 ledger 不变，fixture 可按请求继续向前应用新增迁移。

最终收尾：主 Agent 已删除本轮专用容器，见 cleanup.json。再次运行需先按 setup.mjs 重建隔离环境。未停止日常 PostgreSQL。
