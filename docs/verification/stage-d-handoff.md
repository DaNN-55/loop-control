# D 阶段本地交接（2026-10-23）

> 2026-10-24补记：[T15真实Keychain补验](stage-d-t15-keychain/README.md)已在Owner授权的专用库/合成秘密范围通过，并修复异步Node管道误拒绝；专用库已清理、现有D服务仍默认disabled。在线Provider、live资格/真实蓝图选择及完整任务Worker CLI未验，T15整体与下游门禁仍未关闭，未开始T16。默认5秒历史失败及根因未解决保留。Owner已认可并授权本次修复/证据在当前分支本地归档，不推送或合并；下文为原始交接时点记录，不把旧“Keychain操作数0/待授权”当当前状态。

工作树`/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支`codex/local-first-stage-a`；起点`61ee01d9af38c9ab1f7db7717efab1126c88ba4c`。没有推送、合并、部署、关闭Issue、生产切换或凭据传输。GitHub OPEN状态刻意保留，不据此推断技术工作是否完成。

## 当前结果

| Issue | 本地验收状态 | 主要提交与证据 |
|---|---|---|
| #118 / T12 | 完成；双审查通过 | `d9f5ff1`、`3642446`、`d219216`；[证据](stage-d-t12/README.md) |
| #119 / T13 | 完成；双审查通过 | `4f9084b`、`af147ee`；[证据](stage-d-t13/README.md) |
| #120 / T14 | 完成；两项审查缺陷修复后复审通过 | `d466a7a`、`8bc2490`、`3ce95e7`；[证据](stage-d-t14/README.md)、[复审](stage-d-t14/review.md) |
| #121 / T15 | 接口及模拟验收完成，真实验收仍未完成 | `49147bc`、`30d1ac8`、`f5fa19d`、`7c6439c`、`c4fd52c`；[范围与证据](stage-d-t15/README.md)、[审查](stage-d-t15/review.md)、[精确待确认方案](stage-d-t15/keychain-test-proposal.md) |
| #122 / T16 | 未开始接管验收 | 实际Issue直接依赖#114/#120/#121，#121未通过 |
| #123–#129 | 未开始接管验收 | 依次经#122、分镜、旁白/媒体、对齐、Studio、发布包链条；#129亦依赖C的#114/#115 |
| #130 / T24 | 未开始接管验收 | 依赖#128及#121 |
| #131 / T25 | 未开始接管验收 | 依赖#129/#130；不能现在移除旧运行依赖或声称D全部完成 |

已实际读取GitHub #118–#131内容，未把缺少关闭状态当重做理由。T12原生PG真实空库/导入库、事务竞争、无Auth数据回退；T13本地Owner会话与账号/产物边界；T14复用原配置表单、幂等事务和冻结语义。当前应用回归88文件716项通过，Node2过/1既有跳过，应用及local-app类型通过；未提高默认5000ms超时。T15有20项真实本机IPC/协议检查、真实HTTP/PG配内存秘密存储及纯模拟Provider的并发/恢复/脱敏/隔离测试、9项最终回滚的空库SQL资格转换断言。协议二进制不含Keychain API调用；候选只编译，真实Keychain和Provider操作均0。蓝图原能力入口接管连接接口，默认disabled，模拟不能解除版本选择门禁；本次retryable与持久资格分离，符合ADR0007。

真实T14并发修复前200/200，修复后两事务都等锁再释放为200/409；UI的“POST已提交、后续GET失败”故障以mock fetch独立测试，未冒称真实DB故障。C原始38表20,379条记录在T14后仍逐条原样存在，D另有明确合成夹具。T12两个表的旧v2 JSON md5因本机libc排序不一致而不匹配，归档原始COPY逐行多重集及与C恢复库逐行比较一致，保留该差异；不能写成所有旧指纹全匹配。

## T15 精确边界

当前状态为待Owner明确授权、未尝试，**没有被工具拒绝，也没有未知结果**。[精确方案](stage-d-t15/keychain-test-proposal.md)：只用`.loop-control/stage-d/keychain/t15-synthetic.keychain-db`及service `com.loop-control.stage-d.connections.v1`，新可重建合成UUID条目；新增/解析/删除、仅该测试库锁定/解锁和最后清理，不动登录/系统库状态，不扩大已有ACL，不用“始终允许”。优先Owner提供专用库；自动创建可能新增/移除该测试库搜索列表项，须单独确认且不动原有项/顺序，不能保证即停止。Worker仅模拟Provider，无在线请求/费用。任何系统认证提示停止并报告。候选helper现显式限定专用路径/搜索范围，没有默认登录库回退。

HTTP/PG/UI/Worker接口及模拟验证已继续完成；实际默认秘密/验证端口仍disabled，真实Provider探测部署未启用，完整任务Worker CLI未迁移。仍须获准后通过真实helper验证秘密存取、拒绝/锁定/轮换/恢复及真实HTTP→Worker脱敏路径；真实Provider及真实蓝图版本选择另需明确授权、适配与实测。不能用协议、mock、SQL元数据状态转换或模拟Provider替代原三项验收；D私有绑定/意图的完整备份恢复仍属T24。

## 隔离环境与接续

原生容器`loop-control-stage-d-postgres`，固定image `postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`、卷`loop-control-stage-d-data`、库`loop_empty`/`loop_imported`、端口55472、Colima socket `unix:///Users/dan/.colima/loop-stage-a/docker.sock`。不要使用默认Docker socket或生产实例。

D应用127.0.0.1:55177，最新交接检查PID8140与记录匹配；`state/app.json`包含身份。应用以`--offline-test`运行，进程出站fetch全拒绝、socket仅允许127.0.0.1:55472；这是进程guard，不是主机物理断网，也不是离线外部AI生成证明。其他原有55173/55174服务未停止。只通过`node scripts/local/stop.mjs`/`start.mjs --offline-test`操作身份匹配的D服务。未将开发Vite服务宣称为完成的生产部署。

私有配置/合成本地Owner信息/会话/日志位于已忽略的`.loop-control/stage-d`，不得输出其秘密或提交。原C完整备份仍在`.loop-control/stage-b/verified/backups/1c6a94b1-6cd8-4497-8f15-545f2b889bff`，归档SHA256 `25e75bc66a2b7e16d294752606a121317982b84543b6296bfe927663c384b436`；C真实空库恢复38表20,379行/282媒体通过。D媒体为副本；新增合成产物留作诊断，源媒体未改。

接续先检查git状态、服务身份和运行命令，避免重复未知操作。`node scripts/local/check.mjs t15`运行正确隔离环境的回归并排除保存在`.loop-control`的历史副本；`history-preservation.mjs`检验全部原C行仍存在；`keychain-helper-check.mjs`只执行无Security调用的协议版；`connection-qualification-check.mjs`仅运行空库内最终回滚的SQL元数据夹具。`connections-acceptance.mjs`的真实HTTP/PG仍只使用内存秘密/模拟Provider，会保留明确合成连接供诊断，不执行native适配器。不要盲目重跑会新增夹具并改写夹具指针的配置验收脚本；T12旧Auth bridge验收亦不能原封不动用于T13后的会话服务。导入脚本拒绝覆盖非空已导入库，不要为复测清空当前D库。

用户既有PLAN.md和未跟踪backlog/spec/ticket文档均未纳入本轮提交。`output/playwright`是本轮独立浏览器诊断产物，必要无秘密证据已复制进逐票目录。原C五秒历史不稳定、3条既有advisor WARN、n8n原生校验1跳过、真人审批链和在线Provider未测全部保留，不宣称全覆盖。
