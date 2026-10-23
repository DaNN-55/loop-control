# Loop Control A 阶段执行记录

更新：2026-10-23（Asia/Shanghai）。Owner已确认A阶段通过，ADR-0008为Accepted；已授权提交当前分支的A相关改动，暂不合并或推送。下一步由新对话沿用当前目录、分支与隔离环境，按T04/#110→T05/#111执行B。C/D未开始，E/F搁置；生产保持不变。

## 当前目录与授权

- 当前工作树：`/Users/dan/.codex/worktrees/local-first-optimization/loop-control`。
- 当前分支：`codex/local-first-stage-a`；基线 `cf450d9e91696fd071f4b2476c81a72dda8da14e`。
- Owner 首先要求新工作树，后明确纠正为返回原优化树、用新分支实施；已遵照后者，所有后续修改和测试在上述目录。
- 生产目录 `/Users/dan/Programs/loop-control` 仅只读检查；保留其中已有 `docs/architecture-map/`。未复制生产凭据或业务数据。
- 本对话完成A三票；Owner现已批准A验收与ADR并授权本地提交。未关闭云端Issue或发布评论，未授权推送或合并。B交接给新对话。

## 已完成步骤

- [x] 重读 `to-tickets`、项目术语、ADR、Issue tracker 与标签规则。
- [x] 通过 gh CLI 读取云端 T01/#107、T02/#108、T03/#109 全文及全部评论，三张均无评论，依赖链 T01→T02→T03 一致。
- [x] T01（四项修复及再次复审已通过）：固定本树目录/端口/测试凭据的隔离入口；兼容 Auth/Vault 的真实 DB，230 条历史迁移；真实 Owner HTTP Episode 读取；负向配置与独立启停/错误 PID 跳过。
- [x] T02：1/3 镜头固定真实媒体；4 个真实 HTTP 派发/Worker CLI/DB 任务；真实 OpenChatCut 模块渲染；浏览器、API、计时、CPU/RSS/磁盘原始样本；真实文件发布包验证和损坏恢复。
- [x] T03：[ADR-0008](docs/adr/0008-local-execution-and-migration-contract.md) 记录服务、容量、租约、结果代次、本地身份、Keychain、PostgreSQL、恢复和逐段迁移契约。状态 Accepted（Owner于2026-10-23确认）；没有提前替代现行架构。
- [x] 完整回归/类型/Worker 构建及真实路径检查。
- [x] 收尾：最终脚本核对、生产只读对照，停止本次测试服务，归档误建且已无用途的新工作树。

## 验收与证据

主报告：[A 阶段交付与验证](docs/verification/stage-a/README.md)。原始计时、逐请求指标、任务/产物指纹、生命周期、发布包与容器资源均在该目录；秘密仅在 Git 忽略的 `.loop-control` 和本树 worker.env.local。

测试边界沿用已批准的本机 HTTP 主边界、真实 DB、真实产物。固定样本来自合成素材，但执行器和数据库是真实的。OpenChatCut 直接模块渲染和测试发布包角色不等于完整 Owner 审批/DB 渲染编排；未执行在线生成、并发压力、租约故障注入或备份恢复，不以 A 的样本宣称正式吞吐或 C 目标完成。

## 环境与失败修正

1. 初始 default Colima 已停止且无本机 PostgreSQL；创建专用 `loop-stage-a` VM，未切换默认 Docker context。
2. 镜像拉取连续两次因 DNS 失败；查明专用 Ubuntu 镜像 `/etc/resolv.conf` 的目标缺失，补齐该 VM 的解析文件后恢复。一次先前 CLI 重试与新启动重叠导致测试容器名冲突，确认旧进程退出后顺序重启成功。未改宿主/生产网络。
3. Auth email provider 禁用导致合成 Owner 无法登录；调整测试模板，使本地已有用户可登录而公共 signup 仍关闭，重启隔离栈后通过。
4. 首次隔离单元测试因 macOS `/var` 的真实路径是 `/private/var` 导致 fixture 不规范；规范化路径后通过。
5. 真实 FFmpeg 任务首先成功，OpenChatCut harness 先后因手写旧字幕空间契约和未映射逻辑命令失败。记录两次原因后，改用项目当前默认字幕契约及已有真实集成测试的 Node 脚本映射，1/3 镜头均通过；未修改业务校验。
6. 裸 npm test 因公开客户端配置缺失失败 3 个文件；新增 isolated:test，以本地 demo 配置运行后完整通过，未复制生产 .env。随后补充初始化前拒绝目录逃逸的行为检查。

## 后续入口

Owner已确认A与ADR，并授权新对话开始B；下一票为T04/#110（完整备份与空库恢复），验收后再做T05/#111（先复现再修租约）。沿用当前分支和隔离环境，按implement执行；不要开始C/D或将设计批准视为生产部署/合并批准。原有 A–D 规格和 25 票映射仍在 `docs/specs/local-first-*`；E/F、功能删减和生产切换继续不在当前授权范围内。

7. 最终端口核对发现专用VM自动转发绑定全部宿主网卡。Docker默认ip设置被Supabase显式绑定覆盖，新增防护已拒绝并停栈；调整为Colima portForwarder:none + 独立127.0.0.1 SSH隧道，实测55431/55432仅本机监听，HTTP重验通过。新增通配listener拒绝测试。复跑模板与实际检查已记录。

## 最终检查与状态

- npm run check、npm run worker:build通过；最终完整回归67文件/655测试通过（包含14项隔离行为检查），另2项Node导入检查通过、1项n8n原生环境检查跳过。新增脚本逐一node --check通过，git diff --check通过。
- 最终本机端口绑定验证和HTTP重验通过；独立Chrome、控制台、API/数据库、SSH隧道及loop-stage-a VM均已停止。55173/55431/55432无监听；媒体保持挂载以便审阅，测试数据库卷和原始数据保留。
- 生产5173/5678仍为PID28388/28387；生产git status与执行前完全一致。default Colima仍Stopped（原状态）。
- 早期误建且已转移完必要内容的工作树已由托管工具归档，当前仅原生产树和原优化树两个活动工作树。
- 本地改动未暂存、未提交、未推送、未合并；云端Issues未修改。A交付报告与Proposed ADR等待Owner审阅，B未开始。

## 2026-10-23 子 Agent 复审与手动验收交接

- 两名 code-reviewer 独立完成 Standards/隔离与 Spec/三票验收审查；关键发现由主 Agent 复核。本轮只改报告和本地状态，不修业务或隔离代码。
- T01 不能关闭：service key 单引号被 HTTP 读取器保留，真实本地 API 401（正规化 key 为200）；主 HOME 仍继承；部分叶文件可经悬空符号链接越界；异常 DB stop 存在隧道清理缺口。后两项分别为临时哨兵原语复现与静态确认，未破坏生产或当前服务。
- 最终 loopback 拓扑下补跑230迁移逐项比对、Auth/Vault、smoke、4个真实任务、1/3镜头模块渲染、包篡改/恢复与生命周期。关闭原基线拓扑证据缺口；T02 自身通过，T03 文档交付通过，T01 前置门禁仍未通过，不推进B。
- 本轮14项隔离测试通过；完整655项为前次同代码验证，不冒称重新全量运行。原始与新证据都保留。
- 当前55173/55431/55432仅127.0.0.1监听，专用loop-stage-a VM/DB/隧道/控制台保持运行，独立Chrome已登录并显示最新三镜头产物。生产5173/5678原PID28388/28387、生产Git状态不变。
- 详细结论见 [复审报告](docs/verification/stage-a/review/README.md)，操作见 [手动检查步骤](docs/verification/stage-a/review/manual-test.md)。未暂存、提交、推送、合并，云端Issue未修改。

## 2026-10-23 四项修复（完成）

Owner 已授权在当前分支和隔离环境修复四项复审发现，补齐回归测试并再次由两个子 Agent 复审三票；仍不提交或合并，不影响生产。

- [x] 先补齐 JWT 生成/读取、专用 HOME、叶文件链接与异常 stop 的失败测试。
- [x] 最小修改隔离入口；另依Owner补充授权调整A-roll任务卡片样式。生产目录代码与配置不变。
- [x] 运行针对性测试、完整回归、类型/构建及真实隔离 HTTP/任务/渲染/启停；补证最终网络和生产只读对照。
- [x] Standards / Spec 两个子 Agent 只读复审，处理有效发现后再交接。

## 四项修复后的最终验收

- JWT输出兼容真实HTTP读取器和shell；HOME/CODEX_HOME/XDG/npm/Git配置使用专用目录；五类实际叶文件拒绝符号链接；DB停止失败仍清理身份匹配隧道。30项隔离测试通过，实际CLI注入与恢复通过。
- A-roll卡片按完成/运行/失败/阻塞显示状态，不再统一红底；实际桌面/390px及深浅色样式验证通过。
- 最后代码调整后18:09完整回归70文件/675项通过（包含30项隔离），另Node2通过/1跳过；smoke重验200/400/匿名0行。类型、Worker构建、脚本语法及diff检查通过。
- 实际loopback下四个FFmpeg任务、两份OpenChatCut视频、发布包损坏拒绝/恢复、console启停/PID安全检查通过；230迁移与Auth/Vault核对通过。
- 两名子Agent复审：Standards无剩余阻塞项；Spec三票满足，T03为Proposed文档交付待Owner确认。时序证据和文档状态问题均已关闭。
- 最终报告：[四项修复与再次复审](docs/verification/stage-a/fixes/README.md)；[当前检查步骤](docs/verification/stage-a/fixes/manual-test.md)。旧review结论作为历史保留。生产PID和Git状态不变，测试服务保持运行。未暂存、提交、推送、合并，未修改云端Issue。

## Owner确认与B阶段交接（2026-10-23）

- Owner明确确认A阶段通过、ADR批准；ADR-0008更新为Accepted。既有复审章节中的Proposed/未提交是当时的历史记录，以本节和页首为当前状态。
- 授权将A阶段工具、测试、UI修复、ADR、A三票及验证文档提交到当前分支，暂不推送或合并；未把原有B–D规划材料混入该提交。
- B阶段由新对话执行，目录仍为本优化树，分支仍为codex/local-first-stage-a，不创建新工作树或切换生产分支。先刷新云端T04/#110全文和评论，再按依赖做T05/#111。
- 使用implement：沿已获认可的本机HTTP、真实数据库、真实产物/恢复边界进行TDD；定期类型检查与针对性测试，末次全量回归，完成后code-review并提交当前分支。不要重复请求已获批准的测试边界或合并授权。
- 当前兼容设施为loop-stage-a VM / loop-control-stage-a DB、127.0.0.1:55173/55431/55432，配置和测试凭据在忽略目录；生产5173/5678及/Users/dan/Programs/loop-control保持原样。B若需要空库恢复目标，必须另建隔离目标，不能对生产或现有A证据库做破坏性重置。
- A最终验证：70文件675项通过（含30项隔离）、Node2通过/1跳过、类型/Worker构建、真实任务/渲染/包校验/启停与子Agent两轴复审通过。详见docs/verification/stage-a/fixes/。
