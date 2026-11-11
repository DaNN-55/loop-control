# 回收站迁移隔离验收环境

2026-11-11：从仓库 schema 创建全新独立 PostgreSQL，未复制日常业务数据或部署配置。

- 容器：`loop-recycle-6e4db3d68f47`
- 标签：`com.loop-control.test=recycle-6e4db3d68f47`
- 镜像：`sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`
- Docker socket：`unix:///Users/dan/.colima/loop-control/docker.sock`
- 网络：`none`；PostgreSQL 数据为 tmpfs；没有 host 端口或持久卷。
- 基准库：`loop_recycle_baseline`，初始化应用当前 156 个迁移（最新159）。每个测试另建随机库并自行销毁。
- 环境模块：`runtime-context.mjs`。只允许本容器 exec 和带随机后缀的测试库，检查镜像、标签、网络和卷身份。
- 没有访问日常数据库、真实秘密或真实供应商；付费调用为0。

执行实际 HTTP + PostgreSQL 烟测：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/docs/verification/recycle-bin-migration-20261111/environment/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run src/local-app/workspaceCatalog.integration.test.ts --maxWorkers=1 --fileParallelism=false
```

后续新增160等前向迁移时，业务fixture须在自身migrations清单中声明；`copyFixtureSchema`会验证原基准迁移账本再在随机测试库应用新迁移，不应修改基准已应用校验值。

执行回收站真实 HTTP、PostgreSQL、文件集成验收：

```sh
LOOP_RECYCLE_ACCEPTANCE=1 \
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/docs/verification/recycle-bin-migration-20261111/environment/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run src/local-app/recycleBin.integration.test.ts --maxWorkers=1 --fileParallelism=false --reporter=verbose
```

这组验收覆盖以下 6 项。每项包含多个断言；它们不是前一轮的 48 项流程验收。

| 验收项 | 关键检查 |
| --- | --- |
| 容量策略 | 实际写入并登记 45 MB 文件 3 份；超过 100 MB 后按安全 FIFO 删除最早项。保留刚入站项和单项 101 MB 的超限项；GET 和重启不触发清理。 |
| 保护与恢复 | 运行任务、供应商提交结果未知拒绝入站；离线、内容变化和未结删除意图拒绝恢复；旧删除恢复记录仍可见；未知手工文件保留。 |
| 去重与并发 | 同一 inode 的真实硬链接只计一次；共享文件受保护；账号不能留下孤立回收站记录；并发恢复仅一个请求成功。 |
| 完整恢复 | 列表隐藏、后台重启、原 ID、脚本、任务冻结证据、素材、原归档状态恢复；已完成生产单恢复后仍只读。真实 Worker 规划入口不为回收站生产单创建任务。 |
| 权限与永久删除 | Owner、CSRF、版本冲突、持久幂等回执、容量范围；永久删除要求正确标题、路径和精确版本。 |
| 前向迁移 | 基准 156 项迁移校验值保持不变；新增 160 项校验值、RLS 和空回收站成员符合预期。 |

最终完整运行通过 6/6，耗时 240.19 秒。`final-integration.log` 保存完整回执。`core-retest.log` 和 `protection-retest.log` 保存定向复测结果。`integration.log` 保留实现期间排错记录，包含已修复的问题，不能作为最终通过回执。

需要媒体渲染的旧同步预览/SDK验收必须显式传入上述 `OPENCHATCUT_ROOT`。它不会自动继承 HTTP fixture 的 runtime.root。

## 最终清理

本轮已结束：主 Agent 核实仅剩基准库、无其他客户端连接并核对标签后，停止本容器；`--rm` 自动移除容器及 tmpfs。日常 PostgreSQL 与5174服务保留。下列命令仅为清理记录；复跑需先按文末步骤重建，不要把已退出容器当活动环境。

仅当本轮验收结束、各测试fixture关闭后，由主 Agent 核对标签后停止本容器：

```sh
DOCKER_HOST=unix:///Users/dan/.colima/loop-control/docker.sock \
docker inspect loop-recycle-6e4db3d68f47 --format '{{ index .Config.Labels "com.loop-control.test" }}'
DOCKER_HOST=unix:///Users/dan/.colima/loop-control/docker.sock \
docker stop --time 5 loop-recycle-6e4db3d68f47
```

容器以 `--rm` 创建，停止时自动移除并释放 tmpfs。不要停止 `loop-control-local-postgres`。重建时运行 `node docs/verification/recycle-bin-migration-20261111/environment/setup.mjs`，脚本会生成新UUID和context，更新本文件的运行标识后再验收。
