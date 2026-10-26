# A 阶段交付与验证

> 本文保留首轮交付及当时停止状态的历史记录。四项修复和再次复审已完成，Owner现已确认A阶段通过并批准ADR-0008为Accepted。最新验证见 [四项修复报告](fixes/README.md)，操作见 [当前检查步骤](fixes/manual-test.md)。

日期：2026-10-23，Asia/Shanghai。云端票据 [T01/#107](https://github.com/DaNN-55/loop-control/issues/107) → [T02/#108](https://github.com/DaNN-55/loop-control/issues/108) → [T03/#109](https://github.com/DaNN-55/loop-control/issues/109) 的正文和全部评论已读取，三张均无评论，内容与已批准票单一致。未修改云端票据、关闭 Issue 或发布评论。

A 的隔离工具、固定样本与原始基线已实现并验证，T03 的 [ADR-0008](../../adr/0008-local-execution-and-migration-contract.md) 已交付为 Proposed，供 Owner 审阅。未实施 B–D、未合并、未推送、未切换生产。本阶段没有修改业务模块、现有历史迁移、审核关卡或原有生产启动脚本；新增命令均有 `isolated:` 前缀。

## 工作区与隔离

最终目录为 `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支 `codex/local-first-stage-a`，提交基线 `cf450d9`。用户中途明确要求回到原优化工作树，已遵照执行；早期新增工作树中的本次工具和记录已转回。

| 资源 | 隔离位置或身份 |
|---|---|
| 控制台 | `127.0.0.1:55173` |
| 测试 API / DB / shadow | `127.0.0.1:55431 / 55432 / 55430` |
| 容器运行时 | 专用 Colima profile `loop-stage-a`，2 vCPU / 4 GiB RAM / 20 GiB 虚拟磁盘；未切换默认 Docker context |
| 兼容数据库 | 专用 Supabase project `loop-control-stage-a`；PostgreSQL 17.6，230 条历史迁移成功应用，Auth users 和 Vault decrypted_secrets 实际存在 |
| 配置 | `.loop-control/isolation.json`，只接受本树路径、本机专用端口和本地 demo 凭据；0600，不进入 Git |
| Worker 配置 | 本树 `n8n/worker.env.local`，按隔离配置生成并逐次核对；不匹配时拒绝覆盖或启动 |
| 媒体 | `.loop-control/stage-a/media`，本次专用 512 MiB sparse APFS 卷，满足现有真实挂载点校验；不使用生产媒体 |
| OpenChatCut | `.loop-control/stage-a/OpenChatCut`，本地已安装运行时的独立副本；源目录仅用于复制 |
| 日志/状态/临时文件 | `.loop-control/stage-a/logs`、`state`、`state/tmp`；运行数据均被 Git 忽略 |
| 身份/生成数据 | 单独创建的合成 Owner、测试账号和 `is_test=true` Episode；未复制生产数据或生产密钥 |

启动拒绝缺失/外部配置、生产根目录、远程 API、错误端口、错误 Docker 身份、非 demo 凭据及目录符号链接逃逸。初始化在创建目录前检查已存在的祖先，避免校验之前写入错误位置。子进程环境使用允许列表，不继承 Provider token、远程 URL 或 NODE_OPTIONS。停止控制台前核验 PID、命令、工作目录和监听端口；不存在或不匹配的记录不会触发信号。

隔离入口是误配置防护，不是针对恶意本机用户的 OS 沙箱。手动绕过这些命令、直接改写数据库中的文件根目录或调用原始 Worker，不属于本次证明；正常启动会检查所有蓝图的素材根目录必须位于隔离媒体树内。

## T01 结果

- 230 条不可变历史迁移在带 Auth/Vault 的真实测试库成功应用；没有为通过测试去删迁移或伪造平台函数。
- 合成 Owner 通过真实 Auth 登录；现有 `GET /_episode-dispatch` 经 Episode/Owner/任务读取校验返回 200。无会话返回 400，匿名数据库访问返回 `42501`，没有测试 Episode 可见。
- 实际停止后端口消失，重新启动后 HTTP 读取仍成功。使用本次专有哨兵进程构造错误 PID 记录，停止入口安全跳过；没有把生产 PID 当作破坏性负面测试目标。
- 生产 5173/5678 的 PID 在启停对照中均保持 `28388 / 28387`。[smoke 原始结果](smoke.json)、[生命周期结果](lifecycle.json) 已保存。

环境准备曾遇到 Colima 镜像缺失 DNS 文件、重复 CLI 启动争用容器名和 Auth email provider 配置错误。均在专用测试设施修正后重跑；它们没有被记为业务代码回归。完整过程见根 PLAN。

## T02 固定样本

输入为固定参数的真实合成媒体：蓝/绿/红色画面 + 330/440/550 Hz 正弦音频，640×360、30 fps，每镜头 2 秒。每次运行生成独立测试 Episode，避免覆盖旧证据；使用相同输入参数和文件指纹比较，计时不包含素材准备。单镜头 1 个任务，多镜头 3 个任务，顺序提交。数据库实测规模为 1 个蓝图、5 个 Episode、7 个任务、6 个 task_run 和 6 个 DB 产物；包含两次早期 harness 失败留下的测试 Episode，未隐藏或删除。

**执行类型**：4 个任务均为真实 HTTP → 当前 shell/逐次编译 → Worker CLI → PostgreSQL 领取 → FFmpeg 裁剪 → 数据库结果与指纹回写。没有用模拟执行器代替这 4 个任务。素材来源是合成数据，不能称为生产样本。

| 样本 | 提交到领取 ms | 领取到结果提交 ms | 总时长 ms | OpenChatCut 模块渲染 ms |
|---|---|---|---|---|
| 1 镜头 | 1339 | 187 | 1526 | 12609.72 |
| 3 镜头，第 1 个任务 | 1158 | 169 | 1327 | — |
| 3 镜头，第 2 个任务 | 1076 | 166 | 1242 | — |
| 3 镜头，第 3 个任务 | 1081 | 168 | 1249 | 4648.70（整个 3 镜头视频） |

队列时间以派发提交到 task_run.started_at 计算，包含当前逐任务编译/启动。总时长由数据库开始/完成时间及提交时刻计算；轮询观察时间另存在原始数据中。第一和第二次 OpenChatCut 渲染的缓存/预热状态未受控，不能把多镜头更快解释为稳定规律。

真实渲染沿用当前 OpenChatCut 模块及受控 Node 脚本，产物是 360×640 视频，分别 2.048 / 6.058667 秒，均含音频、无黑帧，工程/运行时/QC/视频指纹齐全。此处直接调用渲染模块，未走 DB 渲染编排或 Owner 审批链。[原始样本](baseline.json) 包含 Episode ID、时间、每个文件的大小和 SHA-256，可定位本地媒体。

发布包补充演练使用真实视频、从视频提取的封面、合成 metadata 和已通过的真实 QC 报告，通过现有发布包模块校验；故意损坏本次生成的封面会被拒绝，恢复后再次通过。包角色明确是测试 fixture，未记入 Owner 审批、未将 Episode 记为生产完成。[包校验原始结果](packages.json)。

### 页面读取

| 入口 | 1 镜头 | 3 镜头 | 口径 |
|---|---|---|---|
| 真实 Chrome 详情 | 24 请求 / 9030 bytes | 24 请求 / 23516 bytes | 已登录、开发模式，实际读取；响应体解码字节数，不含协议头或静态资源 |
| 单批查询工作负载，执行前 | 13 请求 / 2495 bytes / 44.23 ms | 13 请求 / 5679 bytes / 20.55 ms | 相同表集合，额外一次 task-ID 查询；不冒称浏览器导航 |
| 单批查询工作负载，执行后 | 13 请求 / 4562 bytes / 30.79 ms | 13 请求 / 11903 bytes / 14.98 ms | 同上 |

Chrome 两次详情观察中的最长单请求分别 43.1 / 42.1 ms；完整逐请求耗时见 [1 镜头](browser-1-shot.json) 和 [3 镜头](browser-3-shot.json)。开发模式 StrictMode 的重复加载包含在观察中；没有据此推断生产构建也有相同请求次数。小样本只保留原始值，不给出无统计意义的 p50/p95。

### 资源

每 500 ms 记录测试 harness、隔离控制台及其子进程的 RSS 和 `ps` 生命周期 `%CPU`，共 52 份原始样本。空闲采样约 195–209 MiB RSS（包含测量程序），最后一份空闲 CPU 为 0.4%；执行过程 RSS 合计峰值约 2.84 GiB，CPU 合计峰值 444.6%。CPU 可跨多个宿主核心，此读数不是瞬时 CPU、持续负载或整机总开销；不包含独立 Chrome 会话和容器 VM，不能把它当成容量结论。

任务和渲染阶段媒体总字节数从 96,495 增至 640,575；两份样本目录分别 138,058 / 406,022 字节，此数字在补充发布包之前采集。测试媒体卷虚拟容量 512 MiB。数据库设施另计：四容器结束后资源快照约 243 MiB 内存；镜像 2.083 GB，DB volume 74.87 MB，容器写层约 254 kB。OpenChatCut/依赖副本和 VM 基础镜像不计入媒体增量。见 [容器资源](container-resources.jsonl)、[容器磁盘](container-disk.jsonl)。

未执行在线 Codex/TTS/图片/下载或 WhisperX 模型任务；未执行多 Episode 压测、满载排队、租约故障注入、完整备份恢复和最终切换。5 秒目标只有空闲槽位下的 4 个提交样本，不能认定 C 的完整调度目标或正式产能已经达标。

## T03 交付

[ADR-0008](../../adr/0008-local-execution-and-migration-contract.md) 明确了：

- 应用服务、浏览器、调度器与 Worker 的职责及单一权威写入路径。
- 先回收、后容量核算、再领取的事务顺序；全机/资源组锁序、Episode 公平性、租约 token、零基 Worker attempt 和旧结果拒绝。
- PostgreSQL、本地 Owner 会话、Keychain helper、Node 常驻服务及必要依赖，保留现有审核与连接版本语义。
- B/C/D 的逐段迁移与恢复门禁，以及 HTTP、真实数据库和真实产物的代表请求/可观察结果。

这是可供后续票实施的具体契约，尚未替代现行架构，也不把未来并发/恢复测试写成已通过。

## 复跑

已准备的环境：

```sh
npm run isolated:database -- start
npm run isolated:start
npm run isolated:smoke
npm run isolated:baseline
node scripts/isolation/package.mjs
node scripts/isolation/lifecycle.mjs
npm run isolated:test
npm run check
npm run isolated:stop
npm run isolated:database -- stop
```

运行前先启动专用 VM `colima -p loop-stage-a start --activate=false --ssh-config=false --port-forwarder none`，并重新挂载本次媒体镜像（如已卸载）。不能运行原始 `npm start` 来替代隔离入口。

全新隔离树首次准备：安装 lockfile 对应依赖；启动指定的专用 Colima profile，仅挂载优化目录（`--mount "$PWD:w"`），专用 profile 参考[Colima模板](../../../scripts/isolation/colima.yaml)，必须设置 `portForwarder: none`；`npm run isolated:database -- prepare` 复制固定模板和历史迁移，再 start；在 `.loop-control/stage-a/media` 挂载独立测试卷，将已安装的 OpenChatCut 复制到 `.loop-control/stage-a/OpenChatCut`，最后 `npm run isolated:init`。配置和凭据不从生产目录复制。prepare/init 发现已有配置时拒绝覆盖，重复测量先记录 DB 规模和缓存条件，或使用全新测试数据库。不要删除任何生产资源以“重置”。

若专用 Colima 镜像仍出现 `/etc/resolv.conf` 指向不存在的 `/run/systemd/resolve/stub-resolv.conf`，在该专用 VM 中补齐解析文件后验证 DNS，再启动栈；本次没有修改宿主机或 default profile 的解析配置。

## 检查与交付状态

- 类型检查、Worker 构建、完整单元回归、隔离负向测试、真实 HTTP/DB/媒体/发布包与生命周期结果由本次实际运行记录支持。最终测试数和服务清理由 PLAN 记录。
- 初次裸 `npm test` 因本树没有 `.env.local`，3 个文件在导入时拒绝缺失公开配置；改用 `isolated:test` 传入本地 demo URL/key 后完整通过。没有复制生产 `.env` 或放宽应用检查。
- n8n 原生节点配置检查仍跳过：隔离环境不安装/启动 n8n；工作流静态/导入测试照常运行。其他数据库并发和 OpenChatCut 全套旧集成测试未宣称执行，本次只执行受本票影响的真实路径。
- 改动留在本地独立分支，尚未提交、推送或合并。云端三票保持 open，等待 Owner 审阅后决定后续交付动作。

最终端口核对发现 Colima 默认自动转发将测试 API/DB 绑定全部网卡；已停止测试栈、禁用自动转发，改用有身份记录的独立 SSH 隧道，仅发布宿主 `127.0.0.1:55431/55432`。启动前验证专用 profile 设置，启动后检查真实 listener；通配地址拒绝运行。Docker 内部服务仍在隔离 VM 中按 Supabase 默认监听，未配置对外 VM IP。最终 HTTP 读取重验通过，基线原始计时保留，采集时使用的是先前的自动 SSH 转发。见[最终网络记录](network.json)。

最终结果：类型检查/Worker构建通过；完整回归 **655/655**（67文件，含14项隔离检查），另外Node检查2通过、1跳过。所有新增脚本语法及git diff --check通过。测试浏览器、控制台、数据库、隧道和专用VM已停止，三个隔离端口无监听；生产PID和git状态与执行前一致。早期新增工作树已归档，未丢弃本次必要数据。媒体卷保留挂载以便审阅。[收尾记录](shutdown.json)。
