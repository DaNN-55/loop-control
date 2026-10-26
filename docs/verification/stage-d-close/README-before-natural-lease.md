# D 阶段三个入口缺口收尾

2026-10-25，Asia/Shanghai。固定 worktree `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支 `codex/local-first-stage-a`，三缺口验收基线 `49e25388a65687a93ec14d864345b194a73607fa`。**三个缺口已实现，并完成同一正常入口的受控离线验收；历史失败证据保留，其他未验收范围继续开放。** 以下原收尾证据中的 Git 状态描述验收当时；后续归档以 Git 历史为准。

默认 5000ms 稳定性补修以本地提交 `bca697b` 为基线：测试池限制为可用 CPU 的 50%，本地目录测试等待异步初始化完成；原审核测试全文、全部业务断言与默认超时保持不变。实际 worker 外网封套下，目标 20/20、审核文件 5/5、完整默认回归连续 3 次 766/766，固定双全量压力对照也通过。**当前版本的这项测试稳定性门禁可关闭；历史失败不改判为通过，其他门禁不关闭。** 根因、全部中间失败与验收边界见[稳定性补修报告](default-5s-stability.md)。本轮未提交、新增在线请求或进入 E/F，SQL 建议继续暂缓。

最新 P2 补修针对重复注销的旧失败回调：注销绑定会话代次，只有当前代次可以显示错误和清理工作区，旧回调不能清掉重新登录后的目录与组件 CSRF。新增并发失败及重登后迟到回调测试，组件 11/11、默认 5000ms 完整回归 102 文件 766/766 通过；真实 Chrome 同页重登后的旧失败回调与正常注销 POST 200 已核对。详见[并发 P2 报告](logout-concurrency-p2.md)。仅关闭该问题，历史门禁继续开放。

首次 P2 补修的历史快照：失败后明确转登录，保留退出期间的请求围栏，重新登录后取得新 CSRF；当次默认 5000ms 回归为 102 文件、762/762 通过，详见[首次 P2 补修报告](logout-p2.md)。以下三缺口验收和原始数字保留为原收尾快照，不覆盖历史失败；SQL 一致性建议暂不处理。

## 范围与成功条件

核对 CONTEXT、ADR-0008、T12/#118→T10/#116、T15/#121→T14、T21/#127→T20、T24/#130→T22/T15、T25/#131→T23/T24 的已发布本地票单及既有验证报告。未联网刷新 GitHub；票单文件中“尚未实施”是历史发布快照，当前实现以代码、提交与原始证据为准。

交接时 cwd、分支、HEAD 一致；固定 stage-d 容器、镜像、隔离标签、55472、Colima socket 和数据卷重新核实。根 PLAN 及 42 个未跟踪规划/output 文件共 43 个无关文件逐一记录并复核 SHA。独立私有 PLAN 与原始驱动位于 `.loop-control/stage-d/state/d-close-20261025/`，不覆盖根 PLAN。

## 实现

1. **正常工厂装配。** `scripts/local/application.mjs` 根据受控部署配置注入真实 Keychain store、实际 Pexels probe 的零请求预留策略、OpenChatCut ROOT/NODE 和隔离 Studio 端口。无配置时仍禁用，环境里的 OPENCHATCUT_ROOT 不会被继承为授权。离线 probe 可以记录 live 路径的 retryable 结果，但 `networkAvailable:false` 使 externalReady 为 false；没有 verified 或连接资格。
2. **原生服务端分页。** `catalogQuery.ts` 将 C 阶段 SQL 契约参数化，使用同一 Owner/RLS、repeatable-read 事务及 `updated_at DESC,id ASC`，每页最多 20 条。账号/系列/归档/审核筛选、全局数量及运营待审/阻塞独立分页由数据库计算。共享纯类型与变更检测函数供新旧入口复用；旧 Supabase 运行调用没有被恢复。前端请求绑定筛选、请求和会话代次；退出开始后拒绝新目录读取，旧响应不能回填。详情仍聚合/增量读取，仅实际目录相关变化刷新当前页，隐藏详情不轮询，恢复可见读当前页；详情选择独立于列表页。
3. **恢复配置接续。** `deployment-restore.mjs` 从成功恢复回执生成正常部署文件；`readDeployment` 接受批准命名空间的恢复库，核对应用/Worker 同库、媒体回执及规范私有路径。正常应用工厂和 Worker 仍读数据库实际媒体绑定及 pending/failed 状态。没有放开任意数据库、目录、远端或生产回落。
4. **装配后暴露的离线前置检查。** Studio 需要媒体端口，原先把它配置为 live 但不给凭据，真实外部任务会先通过检查再 failed。新增明确的 `media.mode:'local'`，CLI 根据冻结包的外部连接/图像生成需求在执行前阻塞；本机 Studio 继续可用。保留首次 failed 任务、修复前红测和修复后另一条受控任务的 blocked 结果，未重置旧任务预算/attempt。

操作入口与字段见 [隔离部署说明](../../local-native-deployment.md)。未创建默认 native-worker.json，未启用在线策略；这不是默认/新主机完整部署验收。

## 同入口真实验收

全部服务通过实际 `npm start/stop -- --deployment … --offline-test`，使用 `createNativeApplication`，没有用专用替代 HTTP 服务器代替验收入口。真实 PG、两份新恢复库、独立 APFS 媒体和 Chrome；合成规划器只用于本机受控任务，不称在线生成。

| 路径 | 观察结果与证据 |
| --- | --- |
| 目录/Owner | Owner 可见 6259 条历史记录时只返回 20 条；第二页与真实 SQL 排序一致且无重叠。账号计数、账号/归档/审核/系列筛选、运营子页上限、跨 Owner 排除和非法参数400通过；增量详情无变化不重传。[HTTP](evidence/catalog-http-result.json)。该次响应108665字节含配置元数据，不宣称所有实体都分页或恒定耗时 |
| Chrome | 登录、目录第二页20条、账号筛选、归档空结果、详情、配置表单确认保存并由真实数据库核对、分镜审批及整页重载。恢复后新密码登录、已批准详情及第二页再次显示。390px视口内容宽390、20条、分页可操作；只是浏览器尺寸模拟，不是真机。[目录](evidence/browser-page2.png)、[空页](evidence/browser-empty.png)、[配置](evidence/browser-config-saved.png)、[恢复后](evidence/browser-restored-approved.png)、[窄屏](evidence/browser-restored-narrow.png) |
| Keychain/probe | 正常工厂下 Owner HTTP 创建合成连接、真实 helper 写入专用测试 Keychain；实际离线 probe 返回 retryable/ready false，externalReady false。恢复后重建空测试 Keychain，原引用 missing，经同一 HTTP 显式 rebind；原版本/引用保持，资格仍全false。[创建](evidence/connections-http-result.json)、[恢复重绑](evidence/restored-http-result.json) |
| Studio | 正常工厂下实际 Node/OpenChatCut 子进程55190打开继承的当前QC工程，工程API读取成功，真实Chrome显示素材、轨道与字幕。最终 local 媒体模式再次实际打开成功。[最终HTTP](evidence/final-studio-http-result.json)、[Chrome](evidence/browser-studio.png)。未重做完整编辑→冻结→渲染全流程，既有T21证据不扩大 |
| 普通重启续跑 | 新任务仅以30秒 available_at 测试触发器暂缓；停止时 ready/attempt0/claimed_at null/0run，删除触发器。正常启动后无需新派发即由实际 CLI 完成、恰好1run，HTTP产物SHA一致；没有修改 Worker 租约或 claimed_at。[停止](evidence/source-stopped-ready-result.json)、[完成](evidence/source-restart-completed-result.json) |
| 在线前提 | 修复前真实CLI failed/0产物保留；最终 local 模式的新受控Pexels任务为 blocked、attempt1、0产物、validation false，明确“在线媒体执行尚未配置”。全程0新增Provider请求、0新资格。[原失败](evidence/online-first-failure-result.json)、[最终阻塞](evidence/online-blocked-result.json) |
| 备份/恢复 | 真实原生v2备份恢复到 `loop_t24_restore_dclose02`；51表/28562行、872媒体文件、COPY/序列/安全对象/外键对账，冻结ready输入SHA不变。正常部署工具生成文件；Owner凭据/会话未导入，初始化原Owner新密码。[恢复](evidence/restore-result.json) |
| 恢复后的正常启动 | pending及failed状态的实际npm启动都失败，日志明确恢复未完成；ready后同入口启动、原ready任务自动完成一次，HTTP产物SHA一致。旧密码/会话401，新密码200；既有浏览器配置及批准状态保留，再经HTTP批准恢复任务的视觉审核。[续跑](evidence/restore-restart-completed-result.json)、[HTTP](evidence/restored-http-result.json)、[配置围栏](evidence/restore-bindings-result.json) |
| 构建/网络/原数据 | 新原生构建图1864模块，无SDK/旧App/旧控制面。Node进程树guard及Chrome域限制下所有实际HTTP目标仅批准loopback；原始网络不公开，无HAR。原 `loop_imported`/T24/T25逐表指纹与2560个媒体文件SHA不变。[模块](evidence/native-runtime-graph-result.json)、[网络](evidence/browser-network-result.json)、[原数据](evidence/preservation-after-01.txt) |

分页请求之间是独立快照，插入/更新可能改变边界。数据库仍计算全局统计，本轮没有执行容量/性能门禁。固定55190只验证单个编辑器；另观察到关闭Studio服务后页面继续本地 external-agent/register 重连，原始请求列表私有保留，未据此宣称资源稳定性通过。

## 回归与失败

三缺口原收尾的完整默认 **5000ms、102文件、760/760** 通过；此前758/759原始超时及基线对照保留。当时源码同入口启动、runtime指纹、Owner HTTP、真实Chrome目录20条与退出，以及正常停止均已验证。[当时smoke](evidence/final-smoke-result.json)、[当时范围](evidence/final-scope-result.json)。P2 修复后的当前结果见上方补修报告。

完整默认5000ms结果见 [原收尾执行摘要](evidence/verification-summary.json) 与编号原始日志。原始红/绿结果全部保留，后续通过不覆盖历史失败。类型、原生编译、runtime准备/指纹及构建按实际执行索引记录；Node2通过、1个既有n8n检查跳过。构建约586.6KB chunk告警保留。

- 工厂未注入Keychain红测、目录/恢复入口复现均先失败后修复。最早复现脚本相对路径写错，原模块解析错误保留；修正后才记录真实缺口，不把工具错误当产品复现。
- 首次focused命令误匹配私有历史源码且缺旧测试合成env；后续明确排除 `.loop-control`，未修改产品断言。两次类型检查沿共享类型拉入旧模块，后改为纯类型边界；未改变领域值。
- HTTP驱动将同名多账号合计6030误当单账号数量，改为真实选定账号SQL对照；固定session快照wx冲突在业务请求前失败，改每次独立UUID快照。编号日志保留。一次浏览器驱动日志名与外层日志重名，内层逐步原始输出仍在，外层EEXIST不算通过。
- Studio早期驱动使用错误枚举比较、被副本刻意关闭的分镜标志，以及错误的QC成片路径；拒绝记录保留，后只在本轮副本恢复必要标志并采用当前工程路径。没有放宽产品校验。
- 源码变更及前端build清理dist时，真实runtime完整性检查两次拒绝执行；改为构建后正常stop/start准备再验收。未跳过完整性检查。
- Chrome配置前两次点击后未验证保存成功；服务重启/HMR使页面回到首账号，驱动又有select/find用法问题。最终逐步确认账号与textarea值、点击确认，并用数据库核对成功。一次关闭Studio后台标签触发agent-browser Target.attachToTarget错误；只读offline doctor后重新打开本轮页面、新密码登录再验收，不接管其他会话。
- 首轮完整回归755/756的Range409是ambient TMPDIR经macOS `/var` 链接造成规范路径拒绝；原实现未改，恢复既有私有规范TMPDIR后756通过。新增可见性测试后757通过。
- 媒体前置修复后的一轮完整默认测试为758/759：旧 `ReviewWorkspace` 的BGM/TTS用例5031ms超时。同名T21基线5042ms红、T25基线3164ms绿；App与测试字节不变，reviewSelectors发射JS一致。只能归为既有时序症状重现，不能断言资源争用或根因已解决。[对照](evidence/timeout-attribution-result.json)。没有调超时或为绿色反复重跑。
- 最后复核另捕获“退出POST未完成时仍能按刷新新建目录读”的实际竞态；先红测确认，再在退出开始后的refresh入口加围栏。因这项源码变更才运行最后一轮完整回归；原758/759失败仍单独保留。

## 收尾和未关闭范围

正常服务和Studio已停止、55189/55190关闭、PG业务连接0；只删除本轮合成测试Keychain与浏览器认证项/会话，默认/搜索列表快照及stage-d目录mode恢复。隔离数据库、APFS媒体、备份和私有证据保留供复核。43无关文件、根PLAN、HEAD不变，索引为空。[收尾](evidence/cleanup-result.json)。

**T21 当次 740/745、所有历史默认 5 秒失败及当时根因未解决的记录继续保留。** 后续稳定性补修通过受控复现、单变量对照及预定重复验证关闭当前版本的测试稳定性门禁，不追认旧运行通过，也不把每次历史失败都归为同一原因。既有 30 分钟 Worker 租约及立即故障切换仍未证明；原 ready 任务续跑不是有效租约接管，不以改 claimed_at 冒充等待。

真实WhisperX成功推理、默认/新主机完整部署、在线生成、其他Provider、完整多能力Worker，以及E/F总体全链路、容量、性能、切换回退均未验收/未获本轮执行授权。T15 Pexels历史仅2次批准请求且预算已用尽，未重置或追加；模拟资格、历史SecretStore替身及T17中间日志覆盖说明继续保留。模块/离线装配不等同完整在线任务证明。

[证据索引](evidence-index.json)区分公开脱敏材料与私有原始文件；凭据、Cookie/CSRF、原始网络、SQL/备份与部署文件不进入公开目录。[主Agent复核](review.md)不称独立评审，也不称整个D在线/部署资格或E/F通过。
