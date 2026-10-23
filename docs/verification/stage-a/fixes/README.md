# A 阶段四项修复与再次复审

> Owner确认（2026-10-23）：A阶段验收通过，ADR-0008已批准为Accepted，并授权本地提交A相关改动，暂不合并或推送。以下复审记录中的Proposed和未提交为当时状态；B由新对话按T04→T05继续。

2026-10-23，当前分支 `codex/local-first-stage-a`，基线 `cf450d9`。本轮 Owner 授权修复上次四项发现并调整 A-roll 任务卡片，仍不提交、推送或合并，不操作生产服务。运行检查和两个子 Agent 的再次复审已完成；T01/T02验收满足，T03文档交付满足，ADR仍Proposed等待Owner确认。

## 修复与回归

1. **JWT 兼容**：隔离配置生成器仅对已校验为 shell 安全字符的 service-role JWT 输出原始值，其他值继续 shell 引号转义；不改业务读取器。测试实际 `localWorkerServiceRoleKey()` 与真实 zsh source，均读到相同值。实际本地 API 用生成文件读取的 key 查询成功，200；旧的 401 证据保留于上级 review。
2. **专用 HOME**：应用、Worker 和隔离工具使用 `.loop-control/stage-a/state/home`，显式设置 HOME/CODEX_HOME/XDG config/cache/data、npm userconfig 和 Git globalconfig，丢弃继承的 provider token。Worker env 也显式覆盖这些值。单元测试执行真实 Node 子进程和 shell；运行中 Vite 进程环境只提取上述非秘密字段核对通过，专用默认 Codex auth 不存在。
3. **叶文件安全写入**：逐级 lstat 拒绝现存/悬空符号链接；日志使用 O_NOFOLLOW 打开，状态/config 写入经同一 helper，并在截断前拒绝非普通文件/硬链接。run、tunnel、初始化和验证 harness 的 JSON 写入均接入。实际 CLI 启动注入 console.log、console.json、worker.env.local、tunnel.log、tunnel.json 的链接，五条路径均拒绝，目录外临时哨兵未变。
4. **异常 stop 清理**：容器身份验证及 CLI 在 try 内，stop 的隧道清理在 finally；inspect 失败或不匹配时不操作数据库，仍只清理身份匹配的专用隧道。单元覆盖 inspect 失败、错误容器、CLI 非零/信号和 status 失败。真实命令通过 PATH 哨兵注入 Docker inspect 失败，未移除容器，确认隧道端口与记录消失后恢复。

隔离是本机可信进程的配置/路径/资源误用防护，不是抵御恶意同 UID 进程的 OS 沙箱；不能宣称阻止绝对路径主动读宿主文件。基础设施入口只显式访问专用 Colima profile 的 socket/SSH config；为避免 HOME 改变导致数据库身份漂移，该路径来自 OS 用户记录，不继承应用 HOME。没有复制主用户 Codex 凭据或执行在线模型，也没有改变 Keychain。

## UI 补充

A-roll 运行卡片不再复用红色 worker-blocker。已完成显示中性白底和绿色状态文字；执行中蓝色；失败/阻塞保留红色状态标题和轻边框。执行器证据与次数/成本用紧凑、有标签的布局，保留原有错误原因和重试指引。支持现有深色主题及窄屏。实际冻结证据未生成仍如实显示，不伪造为已生成。

## 验证

- 修复前 8 项新增复现检查全部失败，见 `regressions-before.txt`；修复后隔离测试 **30/30**。
- 完整回归 **70 个文件 / 675 项通过**，另 Node 2 通过、1 项 n8n 原生环境检查跳过；见 `tests.txt`。类型检查与 Worker 构建通过。
- `runtime-check.json` 是真实 CLI 的五叶文件拒绝、Docker 故障清理、生成 key 查询和运行中 HOME 核对；不是仅源码匹配。
- 230 个仓库迁移与数据库逐项一致，Auth/Vault 实际存在；`database-before.json` / `database-after.json` 保存实际规模。
- 最终 loopback 拓扑下再次完成 smoke、1/3 镜头 4 个真实 FFmpeg Worker 任务、2 次 OpenChatCut 模块渲染、发布包损坏拒绝/恢复和启停/错误 PID 跳过，见同目录 JSON。网络前后仅127.0.0.1，生产5173/5678仍为原PID28388/28387。
- 成功样本：1镜头 `4d8120a8-9e51-4ff5-91ee-b8cd36144dd6`（总任务1348ms，模块渲染5422.32ms）；3镜头 `13029a1c-8dff-49eb-a2d4-e04e36126f6d`（总任务1264/1283/1231ms，模块渲染4626.88ms）。两视频360×640、含音频、无黑帧，2.048/6.058667秒。
- 本轮补写路径检查时曾放错到 probe 中，真实复跑出现 ReferenceError；立即修正并重跑同一完整脚本成功，保留失败测试 Episode `02cbdcdd`。不以首轮655项或中途失败替代本轮最终结果。

仍不宣称完整审批、在线生成、并发容量、备份恢复或后续 B/C/D 已完成。T03 为 Proposed 的文档交付，不表示 Owner 已批准方案。

## 再次复审

### Standards

Critical issues：无。隔离修复闭环，未发现新的实现回归。正常UI新建/修复先预检，Worker每次执行前以 MEDIA_LIBRARY_MOUNT_PATH 复检 asset_root；直接HTTP入口接收已冻结Episode根。手工绕过这些入口、直接改写DB不是本次误配置防护边界。

审查曾指出一项P2：17:59的测试早于18:03最后脚本修改。已在**18:09**对最终代码重跑完整 isolated:test：70文件/675项通过，含30项隔离测试；受影响smoke重新通过200/400/匿名0行。`tests.txt`已替换为末次日志，`smoke-final.json`保存末次smoke，时序缺口关闭。没有在该轮后修改代码。

可选说明：LOOP_CONTROL_ISOLATED_MEDIA_ROOT是当前未消费的冗余环境值，未将其作为安全机制；实际约束来自既有预检和Worker的MEDIA_LIBRARY_MOUNT_PATH。保留该值不影响本轮通过。

### Spec

Critical issues：无。T01/#107独立配置/端口/DB/媒体/状态/日志及拒绝路径满足；T02/#108最终loopback拓扑下的固定样本和资源口径满足；T03/#109的服务、容量/租约/串代/恢复、本地Owner/Keychain/PostgreSQL/调度/迁移与验证契约文档满足，状态仍Proposed。

原P2文档状态不同步已修正：PLAN、三票和当前指南采用本轮结论；旧review和原报告保留历史并链接到此处。云端Issue仍OPEN，未发布评论或关闭。

两名子Agent只读审查；主Agent亲自执行验证并读取结果。Standards无剩余阻塞发现；Spec三票满足，T03仅表示文档交付，不表示设计获批或后续架构已经实施。

UI 实测截图：[桌面](task-cards-desktop.png)、[窄屏](task-cards-mobile.png)。`browser-style-check.json` 区分实际页面截图与仅DOM的四状态样式探测；后者没有修改数据库，探测后恢复原状态。操作见 [修复后的检查指南](manual-test.md)。

末次收尾：当前分支与HEAD未变，无新增提交，生产Git与开始时一致（仅原有docs/architecture-map/）；55173控制台、55431/55432 API/DB仅127.0.0.1监听，生产5173/5678原PID不变。服务为Owner保留运行。证据见after.json及network-after.txt。

末次子Agent确认：Standards通过、P2证据时序已关闭；Spec无剩余验收问题、P2文档同步已关闭。Spec建议给旧手动指南补历史提示，该提示已添加并链接当前指南。无剩余阻塞项。
