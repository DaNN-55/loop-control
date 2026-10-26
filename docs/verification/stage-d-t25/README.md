# T25：退出 Supabase 运行依赖与断网数据操作

2026-10-25，Asia/Shanghai；分支 `codex/local-first-stage-a`，基线 `7c153c23b3e217685d977711040a06a9d01c414d`（T24）。

**T25 实现及受控离线本地验收完成，本报告随实现按后续授权纳入当前分支的本地提交。** 默认入口改为原生应用，实际验证启动、登录、查询、配置编辑、材料导入、审核、持久排队及重启；新版构建图无 Supabase SDK/旧 App/旧控制面，原生库无 Auth/Vault schema。最终默认 **5000ms、98 文件、749/749** 通过。**T21 当次及历史默认 5 秒失败、根因未解决继续保留；既有 30 分钟 Worker 租约及立即故障切换未证明不变。** 未新增在线请求、操作生产、推送、合并或进入 E/F。

## 票单、依赖及实施边界

核对工作树已发布 T25 / [#131](https://github.com/DaNN-55/loop-control/issues/131) 三项 AC：盘点直接查询/RPC/Auth/Vault及CLI探针；退出新版 Supabase 运行前提并保留历史；真实断网数据操作、在线任务不假成功和 A–D 范围报告。依赖已提交的 [T23](../stage-d-t23/README.md) 与 [T24](../stage-d-t24/README.md)，并复用 T12–T22 的原生读取、Owner 会话、配置、输入、分镜、媒体、工作台和交付模块。遵守零新增在线请求，没有联网刷新或修改 GitHub 票单。

[调用者盘点](dependency-inventory.json)读取基线215个已跟踪源码文件，记录202个直接客户端、查询/RPC（含类型转换形式）、Auth/Vault和CLI探针锚点，并说明去向。它是静态盘点，任意计算式调用不由正则证明；运行模块图、真实HTTP和模块/网络拒绝另作动态证据。37个本地迁移 SHA、历史 Supabase 迁移、旧启动/停止脚本和 n8n 文件均保持原样。

沿用批准的 PostgreSQL 容器/55472，创建 `loop_t25` 克隆库和本轮新APFS媒体副本，应用55189。只在克隆库关闭旧消费者，为本轮合成单开启原生输入路径。原 `loop_imported`、T24恢复库及原媒体只读；没有操作旧生产工作区、宿主网络、登录/系统 Keychain，也没有读取 Provider 秘密。

## 实现与旧路径去向

- `npm start/dev/dev:local` 默认原生启动，`npm stop/stop:all` 只停止身份验证后的本轮记录进程。专用部署文件严格限定到批准的T25隔离路径、库、端口及同库Worker；缺失本地配置不回落云端。原始启动/停止行为保留为显式 `legacy:start/stop`，旧服务不被扫描或停止。
- 原生服务工厂负责PG、Owner命令、常驻Worker与运维，运行前验证媒体部署。构建不启动数据库消费者；多个关闭钩子返回并等待同一清理Promise。根Vite默认serve和preview加载原生配置，build使用静态原生入口，禁止读取旧环境文件；旧配置复制为字节一致的 `vite.legacy.config.ts`，仅显式legacy模式使用；legacy:start向子进程传递显式标记，根配置强制legacy前端后端选择。
- Supabase SDK及其传递包转为开发依赖，用于保留的legacy编译/回归；没有下载或升级包。新版构建的1859个模块中没有SDK、旧App或旧控制面。共享视图遗留默认远端回调解析到明确拒绝模块；本地页面继续提供已迁移HTTP回调，遗漏调用不能联网回落。
- 默认Worker入口运行原生有界stdin CLI；空输入提示使用应用调度器，默认独立orchestrator拒绝旧栈。原独立发布CLI退出默认路径，提示在Owner本地控制台操作；兼容命令显式为 `legacy:worker/orchestrator/publish:*`。没有新造另一套发布API，也未将旧CLI说成已迁移本地独立CLI。
- 更新根README与两项默认启动/停止契约断言，保留旧行为的显式legacy断言；未修改历史功能断言、期望业务结果或测试超时。隔离运行guard拒绝SDK模块、旧环境文件、生产路径和非批准网络连接，不改变宿主其他服务；它是验收工具，不是系统级断网防火墙。

## 真实验收

| 路径 | 已观察结果 |
| --- | --- |
| 真启动与配置 | 通过实际 `npm start -- --deployment <本轮私有文件> --offline-test` / `npm stop` 启停，不使用自制测试HTTP服务器替代应用；根Vite临时打包后的serve配置也实际加载。原生Owner登录、账号创建/蓝图编辑、脚本/图片导入成功。[准备](evidence/prepare-01-prepare-result.json)、[最终入口](evidence/final-runtime-result.json) |
| 真实排队重启 | 对本轮新任务仅用一次测试触发器延后available_at20秒，捕获 ready:0/无claimed_at/0run，删除测试触发器后停止；重启无需再派发，真实原生CLI完成、恰好1run、HTTP产物SHA一致。未修改租约/claimed_at，没有宣称即时接管有效租约。[停止快照](evidence/stopped-ready-result.json)、[续接](evidence/restart-01-restart-result.json) |
| 审核与新任务 | 重启后真实Owner HTTP读取/批准视觉审核并请求新分镜，真实CLI完成；Chrome登录后提交分镜批准，手动刷新、跨真实服务重启整页重载，仍为分镜已批准的待补素材工作台。[浏览器](evidence/browser-result.json)、[实际截图](evidence/browser-28-final-approved.png) |
| 在线前提阻塞 | 在T25克隆库中复制一条已有受控Pexels任务，真实队列/CLI检查得到 blocked:1、前提“本地媒体执行尚未配置”、validation false、0产物；没有读取Keychain/Provider秘密，资格全false。[结果](evidence/online-blocked-result.json)。这是有界SQL夹具，不是Owner在线资格或真实Pexels调用验收 |
| HTTP/CLI边界 | 匿名401、错误Origin/CSRF403、跨重启原会话有效、n8nRequired:false；共享远端回调实际在访问rpc前拒绝，默认独立Worker/orchestrator/发布CLI均明确失败而非调用远端。[边界](evidence/boundary-result.json) |
| 模块与网络 | 最终原生构建图无SDK/旧入口；服务/真实CLI在Node模块与网络guard下运行。最后一次服务拒绝计数仅为5项自检（旧API/外网fetch、n8n socket、SDK、旧env），没有实际额外外部连接。Chrome727个实际HTTP/WS目标全部为127.0.0.1:55189，原始网络私有，无HAR。[模块图](evidence/native-runtime-graph.json)、[最终运行](evidence/final-runtime-result.json) |
| 历史/备份/收尾 | 原库38表/26,552行、T24库38表/27,019行COPY多重集一致；原native848+T24副本853，共1701文件SHA一致，43无关文件不变。T25实际原生备份再验证，密码/会话及已知秘密未导出。应用端口关闭、PG连接0、仅本轮Chrome/合成认证项收尾，卷/库/私有证据保留。[审计](evidence/audit-result.json)、[实际记录路径复核](evidence/audit-followup-result.json) |

Provider前提缺失由真实Worker保留blocked证据，不是在线成功；浏览器当前任务“已完成”指离线合成规划器最近结果，工作台仍明确显示素材/TTS等待项。在线任务夹具只验证拒绝路径，既有真实Provider最小验证范围不扩大。

## A–D 范围结论

| 阶段 | 已有证据和本轮影响 |
| --- | --- |
| A / T01–T03 | [隔离与ADR修复验收](../stage-a/fixes/README.md)已获Owner认可；T25沿用该工作树/实例边界，本轮未重跑A全演练 |
| B / T04–T05 | [恢复与租约](../stage-b/README.md)原证据保留；T24补新本地数据恢复，T25不改变既有30分钟租约或声称立即故障切换 |
| C / T06–T11 | [分页与浏览器补验](../stage-c-followup/README.md)已获认可；本轮保留兼容源码和回归，默认运行改为本地HTTP；历史默认5秒失败不被通过覆盖 |
| D / T12–T25 | T12–T24有各自受控原生业务证据，T23接管调度、T24完成新库/媒体/绑定恢复；T25关闭新版运行依赖及断网数据管理这组受控缺口。在线生成、默认/新主机部署、真实WhisperX及完整多能力Worker等仍未验收 |
| E/F | 继续搁置，未实施总体发布/生产切换，不合并。A–D的实施与受控证据不等同全部环境资格/性能门禁或E/F通过 |

## 回归和失败记录

最终 [默认命令](evidence/default-5s-04-result.json)、[原日志](evidence/default-5s-04.txt)：98文件/749通过，无超时覆盖。TypeScript、原生编译、runtime完整性、MJS语法与最终本地构建通过；[Node](evidence/node-final-04.txt)2通过/1项既有跳过。构建仍提示一个约583KB chunk超过500KB的常规提示，未调高告警阈值，也未据此声称默认部署性能通过。

1. 首轮构建围栏拒绝旧入口：HTML改写原先在依赖扫描后，改到pre阶段后通过，未放宽模块禁令。[初次构建](evidence/frontend-01.txt)。早期Vite watcher探测旧worker.env被guard拒绝；最终忽略n8n/历史Supabase目录，服务只剩自检一次env拒绝。配置值没有被读取或用于运行。
2. 首轮全量747通过/2失败，均为旧npm默认路径断言，不是5秒超时。[原错](evidence/default-5s-01.txt)。按T25明确契约更新默认值，并新增legacy断言后749通过；随后修正关闭Promise和根Vite临时目录路径，才再做最终全量749。兼容入口复核又发现legacy:start子进程需显式标记，修正模式传递及前端选择后做第四轮最终全量749。未通过反复运行掩盖失败。
3. 在线夹具首次直接复制被既有去重索引拒绝，事务回滚；只给新夹具配置hash加专用后缀，旧快照/历史不变，未创建新live资格。保留[第一次](evidence/online-blocked-01.txt)及[第二次](evidence/online-blocked-02.txt)原日志。此夹具不冒充API合法创建的新蓝图修订。
4. 等待旧T19页面显示该夹具blocked文本超时，未当作UI通过；真实CLI/DB结果独立验证。旧页面“生成分镜媒体”按钮实际被更早的“请先批准当前分镜”前提拒绝，未调用在线Provider；不将其说成在线阻塞文案的浏览器覆盖。[等待](evidence/browser-20-blocked-ready.txt)、[实际页面](evidence/browser-23-online-command-result.txt)。
5. 一次边界脚本在启动命令尚未完成时发请求，真实ECONNREFUSED；确认实际started后顺序执行通过。[初错](evidence/boundary-01.txt)、[通过](evidence/boundary-02.txt)。测试钥匙串本轮未创建；合成浏览器密码只经stdin进入本轮私有认证项，按实际表单选择器调整后登录，随后删除。
6. 首次审计误从原始部署JSON取派生recordPath，产生existsSync(undefined)弃用警告；端口/DB连接本来独立通过，随后用真实app.json路径确认已删除，修正私有审计脚本，原日志保留。关闭Promise/根Vite路径复核则用最终实现实际验证，未仅靠源码字符串。

## 持续保留的限制

- **T21 当次及历史默认5秒失败、根因未解决**。本轮初次2失败为明确旧路径断言，未新增5秒基线对照或修复历史时序根因，最终749通过不关闭历史门禁。
- **30分钟Worker租约不变，立即故障切换未证明**。本轮ready队列持久化不涉及有效租约接管；T23的受控claimed_at过期不等于实际等待30分钟。
- 真实WhisperX成功推理、默认部署、新主机配置、在线生成、其他Provider、完整多能力Worker仍未验收。运行入口的默认选择已验证，通用生产默认部署尚未验收；本机专用D配置和复制工具链不作可移植部署证明。
- 合成规划器、模拟资格和历史SecretStore替身限制继续保留。本轮未访问真实Keychain/在线Provider；T15/T24真实专用合成Keychain结果及Pexels既有最小验收不扩大为本轮在线能力。
- [T17日志覆盖说明](../stage-d-t17/README.md)继续保留；本轮编号stdout独立保存，app.log是追加日志，fixture/deployment/缓存/构建目录是明确滚动状态，不声称每个中间状态都有原始快照。
- SDK保留在开发/显式legacy环境，历史迁移与旧代码不删；默认独立发布CLI明确退出，由已迁移Owner本地控制台操作。未重测显式legacy全栈启动或部署，不操作原有服务/生产。
- [证据索引](evidence-index.json)区分公开证据与私有原始材料。数据库密码、Owner密码、cookie/CSRF、原始网络、SQL/备份及私有部署文件不复制到报告目录，无HAR。根PLAN与43个无关规划/output文件原样；验收收尾时未暂存或提交，后续本地归档见下文，仍不推送或合并，E/F继续搁置。[本地复核](review.md)不是独立评审或总体发布验收。

最终实现回归后只整理文档、执行只读范围核对和复制公开证据；源代码与测试超时未再改动。最终范围/凭据检查结果见[记录](evidence/scope-final-result.json)，该原始记录描述验收收尾时索引为空、HEAD仍为T24本地提交的快照。

## 本地提交归档

2026-10-25 获用户认可并授权，将 T25 实现、验收报告、回归日志和证据索引提交到当前分支。此次只更新归档状态与说明，业务实现、默认5000ms测试结果及所有原始验收证据保持原样，没有重跑已经通过的验收。原始记录中的 `noCommit`、`indexEmpty`、基线HEAD和文件数量保留为验收收尾快照；提交SHA以Git历史为准。

**T21 当次及历史默认5秒失败、根因未解决、既有30分钟Worker租约限制和立即故障切换未证明**继续保留。真实WhisperX成功推理、默认/新主机部署、在线生成、其他Provider、完整多能力Worker及显式legacy全栈启动等未验收项，以及模拟资格、历史SecretStore替身和T17中间日志覆盖说明均未关闭。未纳入根PLAN、无关规划票单/output或含凭据的私有材料；原始网络、SQL、备份、部署配置和认证材料继续留在隔离私有目录。未操作生产、新增在线请求、推送或合并，E/F继续搁置。
