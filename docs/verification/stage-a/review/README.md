# A 阶段子 Agent 复审

> 此为修复前的历史复审。四项修复、最新验证及再次复审见 [修复报告](../fixes/README.md)；本报告保留原发现及当时结论。

日期：2026-10-23。范围为 `cf450d9` 后的全部 A 阶段未提交改动和验证证据；没有修改业务代码、提交、推送、合并或修改云端 Issue。

两名独立 code-reviewer 分别审查 Standards / 隔离实现，以及 Spec / 三票验收。主 Agent 核对关键结论、补充真实验证。复审结论替代原报告中“A 已全部完成”的表述。

## Standards：隔离与实现

按此审查轴原始顺序记录，不与 Spec 结论混排：

1. **P1，证据缺口，已关闭**：原基线发生在 Colima 自动转发绑定全部网卡时；当时只在最终 loopback 拓扑重验 HTTP，不足以证明完整路径。现已在最终拓扑重跑 smoke、真实任务、两种 OpenChatCut 渲染、发布包和生命周期；`network-before.txt` / `network-after.txt` 包围该轮验证，仅有宿主 127.0.0.1 监听。
2. **P1，未修复：service key 格式与读取器不兼容**。`scripts/isolation/environment.mjs:83-85` 输出 shell 单引号；`src/local-control-plane/routes/handlers.ts:1237-1243` 的 `localWorkerServiceRoleKey()` 不移除引号。依赖它的连接测试、发布准备和凭据引用预检可能认证失败。对同一本地 API 用原读取值请求返回 401 `JWT cryptographic operation failed`，正规化本地 key 返回 200。证据 `service-key-parser.json`。shell source 会去引号，所以 FFmpeg 成功未覆盖这条 HTTP 路径。这里是新配置格式与现有代码的集成缺陷，并非修改了该业务读取器。
3. **P2，未修复：HOME 并未隔离**。`environment.mjs:104-105` 保留主用户 HOME，`run.mjs:52` 的服务及其子进程继承。在线 Codex 路径可能访问主用户配置/凭据；环境变量允许列表不能证明磁盘配置也隔离。本次只运行 FFmpeg 与本地渲染，无在线模型执行或生产凭据访问证据。
4. **P2，未修复：写入叶文件缺少符号链接防护**。`run.mjs:45-55` 写 worker env、console.log、console.json，`tunnel.mjs:22,30` 写隧道日志和记录，未逐一拒绝叶文件链接。`assertPrivatePath()` 的 existsSync 对悬空链接视为不存在，父目录通过后 write/open 会跟随链接。主 Agent 在临时目录用相同 validate/open 原语复现写入目录外哨兵；没有对生产文件注入故障。证据 `symlink-evidence.json`。未声称已完整注入启动流程，但原语和静态调用链均成立。
5. **P3，未修复：异常停止缺少隧道清理**。`database.mjs:24-27` 在 stop 时先 inspect 容器；若容器已丢失，抛错会跳过 `:35-36` 的 stopTunnel。静态确认，未在当前运行环境删除容器做故障注入。正常顺序启停已通过。

当前检查证明专用目录、数据库、媒体和端口在这次固定样本中分离；不能因此认定隔离入口已可靠覆盖全部执行路径。T01 需要先修复并回归上述适用缺陷。当前界面可做样本只读验收和已验证的本地固定样本复跑，不以它证明在线工作流已隔离。

## Spec：三张票

| 票 | 本轮判定 | 依据与门禁 |
|---|---|---|
| T01 / #107 | **部分满足，不能关闭** | 独立栈、真实 Auth/Vault、230 条迁移、Owner HTTP 读取与正常启停通过；首条隔离验收受未修复实现缺陷影响 |
| T02 / #108 | **自身验收满足** | 固定 1/3 镜头、真实执行、原始计时与资源口径完整；最终网络拓扑下已补跑。前置 T01 仍未通过，不能据此宣布 A 整体过关 |
| T03 / #109 | **文档交付满足** | ADR-0008 覆盖调度、事务、本地身份、Keychain、PostgreSQL、恢复与迁移契约；状态 Proposed，Owner 尚未批准，不得当作架构已实施 |

数据库补证：仓库 230 个 migration version 与实际数据库数组逐项一致；Auth users、Vault view 和 5 个 Vault 函数存在。`database-before.json` / `database-after.json` 保留版本数组和规模。追加验证后 7 个 Episode、11 个 task、10 个 task_run、10 个 DB artifact；未删除早期失败记录。

## 本轮真实补充验证

2026-10-23 08:55:32–08:55:52 UTC 在最终 loopback 拓扑运行：

| 样本 | Episode | 提交至结果 ms | 真实 OpenChatCut 模块 ms | 视频 |
|---|---|---|---|---|
| 1 镜头 | fd24296d-d486-4520-8116-3e0d16aad654 | 2601 | 5444.71 | 2.048 秒，360×640，有声音、无黑帧 |
| 3 镜头 | cc008085-6530-4fd3-93c9-a8f65b138774 | 1402 / 1295 / 1250 | 4982.61 | 6.058667 秒，360×640，有声音、无黑帧 |

4 个任务均走 HTTP → shell/当前逐任务编译 → Worker CLI → PostgreSQL 领取/回写 → FFmpeg。渲染直接调用真实模块，发布包使用真实媒体和合成 final/QC 角色；没有 Owner 审批或完整 DB 渲染编排。发布包篡改拒绝、恢复再验证均通过。smoke 为有身份 200、无身份 400、匿名无行且 42501。正常 console stop/restart 和错误 PID 安全跳过通过，生产 PID 前后均 28387 / 28388。

本轮重新运行 14 项隔离测试通过，并核验原始产物大小、SHA-256 和 ffprobe。之前同一未改动实现的完整回归为 655/655、类型及 Worker 构建通过；本轮没有声称重跑全部 655 项。原始网络、Chrome 页面读取和容器资源证据仍保留在上级报告；新增 baseline 里的 pageWorkload 是 HTTP 查询工作负载，不能冒称 Chrome 导航。

性能口径仍受限：每种样本单次、顺序 1→3、缓存未受控；主进程树 CPU/RSS 不含 VM 和 Chrome，不能推导 p95、全机容量、生产吞吐或后续 C 阶段目标已达成。

## 交付状态

专用 VM、数据库、loopback 隧道和 55173 控制台为 Owner 手动检查保持运行；已打开独立 Chrome 并登录合成 Owner。生产 5173/5678 仍是原 PID，生产 Git 仅原有 `docs/architecture-map/` 未跟踪目录。复审不修代码；只新增证据、审查报告和验收说明，纠正本地票单/PLAN 的完成状态。

详见 [手动检查步骤](manual-test.md)。缺陷修复后应重跑相应失败路径，再决定 A 的整体验收；当前不推进 B。

页面交接补充：最新三镜头详情实测“当前任务：已完成”，产物索引含3条a_roll_video；审计时间线显示“暂无状态变化”。固定样本没有走状态流转/审批链，任务执行由task_run原始数据和产物证明，不能声称时间线展示了完成事件。
