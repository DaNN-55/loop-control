# 第 4 项：Loop-Control 定时任务只读审计

采集时间：2026-11-12，Asia/Shanghai。任务目录沿用 2026-11-11。只新增本报告与 `step4-evidence/`，没有修改调度设置、启停服务、运行备份／生成、读取会话正文、访问 Keychain 或写入业务数据库。

## 结论

没有证据支持关闭或降低任何已确认的 Loop-Control 周期工作。当前日常服务内部有 Worker、脚本自动继续和原生自动化三个常驻扫描器；健康检查与通知由原生自动化扫描器承载。完整自动备份已被配置为关闭，部分快照未启用。没有发现归属本项目的当前用户 cron、可读 launchd 项、GitHub Actions 工作流或本地 Codex 自动任务配置。

建议分类：**保留当前启用的必要扫描／健康／通知职责；保持备份已关闭、快照未启用的现状；调整频率 0 项；新增建议关闭 0 项。** 不为填满分类而把空闲扫描或没有人工恢复记录的备份视为无用。

## 权威运行归属与统计口径

已核对日常配置的 `purpose=local-daily`、projectRoot、专用 Colima 容器标签／固定镜像，以及 `app.json` 中的部署文件和运行版本。没有调用可能触发存储恢复或秘密读取的 `readDeployment()`。

- PID `81218` 实际监听 `127.0.0.1:5174`，cwd 为 `/Users/dan/Programs/loop-control`；命令为该目录的 Vite 和 `scripts/runtime/vite.config.mjs`，启动于 2026-11-11 23:14:30 上海时间。
- 该 PID 的数据库连接指向 `127.0.0.1:54329`；已核实 `loop-control-local-postgres` 仅将容器 5432 绑定到该地址。配置文件修改时间为 11 月 4 日，早于当前 PID 启动；记录中的部署文件路径一致。日常启动源码使用固定项目配置，验证器强制数据库名 `loop_control`，不接受任意数据库环境覆盖。
- 当前运行版本为 `2557fbeb…`。直接检查其已编译 `nativeAutomation.js / workerScheduler.js`，确认 4 秒扫描、每天上海 9 点与执行时 5 秒租约续期，未仅凭隔离分支源码推断线上节奏。日常服务记录格式没有 nonce，使用 PID／命令／cwd／监听端口归属核对。
- 只在确认归属的 `loop_control` 库执行 `BEGIN ... REPEATABLE READ READ ONLY`、相关 `SELECT` 和 `ROLLBACK`；连接为 `postgres`，`superuser=true`，`transaction_read_only=on`。0 条记录不是 Owner RLS 隐藏。没有调用 initialize、claim、finish、run 或任何业务 RPC。

月度窗口采用滚动一个日历月、左闭右开：**2026-10-12 00:07:36 至 2026-11-12 00:07:36（上海时间）**。排期按 `jobs.due_at`，执行按 `attempts.started_at`，通知按 `reserved_at`，Worker 按 `task_runs.started_at` 分开统计，不能互换。证据：[monthly-audit.sql](step4-evidence/monthly-audit.sql)、[monthly-audit.json](step4-evidence/monthly-audit.json)。

当前保留的 `automation_jobs / automation_attempts / notification_delivery_events / task_runs` 在窗口内均为 0 条；automation jobs／attempts 全表也为 0，只有一个 health 计划，下次为 **2026-11-12 09:00 上海时间**。Worker 当前任务、自动继续 enabled scope 和未决通知也为 0。**这些数字只证明当前保留账本中的记录数量，无法证明过去整个月从未执行。** 未取得历史保留连续性证据，不能把空账本或当前 PID 的一次状态当成完整月度失败率。

`operationsEvidence` 每种操作仅保存 latest／last-success／last-failure，重复的成功空闲结果还会去重。当前 schedule／notification 文件记录 11 月 11 日 23:14 的成功空闲结果；这不是累计计数，不能用 4 秒频率推算“实际运行次数”。没有读取私有应用日志正文补造统计。

## 已检查入口

| 入口 | 只读证据与结果 | 覆盖边界 |
| --- | --- | --- |
| cron | `crontab -l` 明确返回 dan 无 crontab；`/etc/crontab / /etc/anacrontab` 不存在 | 未提权读取其他用户 crontab；未递归打开无关通用包装脚本。因此不是“整台机器所有用户都没有任务” |
| launchd | 当前用户 LaunchAgents 9 个、`/Library/LaunchAgents` 2 个、`/Library/LaunchDaemons` 9 个 plist；只读索引 Label／Program／Arguments／WorkingDirectory，无 Loop-Control 归属；`launchctl list` 无相关 loaded label | 没有把 Apple 系统服务或其他用户 GUI 域作为项目任务调查；仅保存相关结果和数量，不收集无关配置详情 |
| GitHub Actions | GitHub 插件没有完整工作流枚举接口，使用 `gh api repos/DaNN-55/loop-control/actions/workflows --paginate --slurp` 只读后备；实际 `total_count=0`；当前 Git 跟踪树也没有 `.github/workflows` | 只代表该仓库当前工作流，不扩大到组织或其他云调度器；未启动任何 workflow |
| Codex 应用自动任务 | 已先发现 `automation_update`；其 view 需要已知 ID。本地 `~/.codex/automations/*/automation.toml` 配置数为 0，未发现可 view 的相关 ID | 没有全账号云端／任意线程心跳的枚举接口，不能据本地 0 声称云端账号自动任务为 0；未读取会话正文，未创建／更新自动任务 |
| 日常应用内部 | 核对固定运行版本、相关源码、持久 plans／jobs／attempts、Worker／通知账本、操作元数据和产出索引 | 不调用实际作业；只读月聚合不能证明历史记录从未被清理或迁入／迁出 |
| 项目脚本与生命周期 | 对第一方生产 `src / scripts` 搜索计时器，排除测试、夹具、保留 Demo 和上游组件；核对启动、停止、备份、迁移、宿主、Worker 与前端消费者 | 区分真正常驻调度、按任务存在的租约／超时、按页面挂载的轮询；源码存在不等于每个页面当前都挂载 |

原始结果见 [coverage.json](step4-evidence/coverage.json)、`cron.json / launchd.json / github-workflows.json / codex-automation-index.json`，完整计时器位置见 [timer-locations.txt](step4-evidence/timer-locations.txt)。

## 应用内职责逐项盘点

下列 6 项是职责，不是 6 个独立进程／cron。月度“0”均指上述当前保留账本；扫描次数未持久累计的明确写未知。

| ID／所有者 | 用途、启用状态与实际频率 | 月内运行／失败证据 | 产出与消费者、重叠判断 | 建议 |
| --- | --- | --- | --- | --- |
| S4-T01 `startWorkerScheduler`／日常 Node 服务 | 当前启用，启动即 wake，之后每 4 秒及显式 wake；并发容量 1。扫描任务、串行规划并领取真实 Worker 工作 | 扫描次数／失败次数未知；当前保留 `task_runs` 为 0，不能当扫描 0 次。当前 schedule 元数据为成功空闲 | 产出是任务状态／运行／候选，供生产工作区、任务队列消费。与自动化扫描虽同为 4 秒，但操作不同任务表；`recordSchedule:!worker` 避免重复书写调度证据 | 保留；不能据空闲关闭，否则新任务无人领取、规划或恢复 |
| S4-T02 `startScriptProductionRunner`／LocalEpisodeCommands | 当前由应用启动，每 4 秒；仅有 enabled 的生产 scope 才做自动继续，动作使用既有授权和稳定操作键 | 扫描／失败累计未知；当前 enabled scope 为 0。没有独立逐次扫描历史，不能把 task_runs 0 当此扫描次数 | 按已保存的自动继续授权安排下一步，更新对应 last_status；Worker 负责执行，它负责授权下的下一步决策，不是第二份 Worker | 保留；当前无 scope 时不安排制作，不因几行空扫描引入未验证停用策略 |
| S4-T03 `startNativeAutomation` pump／日常 Node 服务 | 当前启用，默认每 4 秒且启动即 wake；排期入队、通知投递与 health／backup 工作均在此串行／围栏处理 | 扫描／失败累计未知；最新 schedule／notification 元数据有成功空闲结果，但它们会被去重覆盖 | 持久 automation_plans/jobs/attempts 和独立操作结果供 LocalSystemStatus 使用；与 Worker 使用不同状态权威，不是重复执行生产 | 保留；停 pump 会同时影响日检和通知，不是无副作用省资源开关 |
| S4-T04 `automation_plans.kind=health`／原生自动化 | 当前启用，上海时间每天 09:00；下次 11 月 12 日 09:00。失败有最多 3 次持久尝试与 1 分钟可用间隔，执行时每 5 秒续租 | 窗口内保留排期 0、执行尝试 0、失败／中断 0；全表无 jobs／attempts；不是完整月度从未执行的证明 | 检查数据库、媒体目录和固定运行产物，结果进入 attempts／系统状态抽屉。轻量健康检查不等于 Worker 或完整备份 | 保留；没有独立禁用／调频配置，不用删除 plans 绕过（启动会重新创建） |
| S4-T05 `automation_plans.kind=backup`／原生自动化 | **已关闭**：日常 `automaticBackups=false`，实际执行 kind 集合只有 health，无 backup plan。若启用，原实现按每天上海 09:00排期 | 当前保留排期／尝试／失败 0；已核实备份根下无 UUID 归档目录；不能据此推断其他时间／其他保留位置从未有备份 | 完整归档原本由 storage restore／校验读取，属于灾难恢复能力，不能以没有日常打开量判断无用。迁移前按配置触发的备份是事件驱动，不是额外 cron | 保持已关闭现状；是否开启由 Owner 另行决定，本次不改变策略或承诺已有可恢复备份 |
| S4-T06 通知消费者／原生自动化与 Owner 偏好 | 随 pump 每 4 秒检查；有新事件且相应类别和 macOS 偏好启用才投递。当前部署使用 desktop | 窗口内保留投递预留 0、失败／uncertain 0，未决 0；扫描次数未知。accepted 也仅代表系统接口接受，不代表用户已读 | 审批／失败／交付事件供桌面提醒和应用内通知使用，持久预留防重；应用内列表与桌面渠道用途不同 | 保留；按 Owner 渠道／类别偏好控制，不创建第二套定时提醒 |

消费者与源码索引见 [source-review-index.json](step4-evidence/source-review-index.json)。所有者为本机项目服务／登录的 Owner，不输出 Owner ID、会话令牌或作品正文。

## 按任务或页面存在的计时器

这些不是独立常驻 cron，也没有可用的月度累计台账。保留其必要生命周期，不将超时、去抖或秘密清除当成“白跑作业”。

| 范围 | 实际节奏／条件 | 消费者与关闭影响 |
| --- | --- | --- |
| Worker／运维租约 | Worker 子进程任务存续时每 5 分钟续租；health／backup 执行期间每 5 秒续租 | 保护任务归属和恢复围栏；结束任务会清理定时器，单独删续租可能使同一任务被重新领取 |
| 目录列表、生产单与系统状态 | 生产单列表 15 秒，生产单详情活动时 2 秒／空闲时 30 秒；系统状态抽屉打开且可见时 5 秒 | 显式页面状态的读取；关闭抽屉／退出对应详情会清理，不能假设关闭整个服务才停 UI 读取 |
| 工作区媒体／口播／导出 | 素材搜索 1.5 秒、视觉任务 2 秒、音频 3 秒、导出 2.5 秒；口播 3 秒但 load 仅在有待更新证据时发命令；统一轮询在页面隐藏／停用／卸载时停止 | 更新候选和制作状态；不是另一份生成调度器，不应把刷新代码删掉造成结果不出现 |
| 存储迁移与原生宿主 | 迁移面板有活动读取时约 500ms 串行重排；宿主所有权每 100ms、仅 active 时检查 | 迁移进度和原生浏览器编辑归属保护；关闭面板／宿主或流程结束后按既有清理停止 |
| 时间显示、提示与敏感信息 | 进度时间／秘密剩余时间等每秒；提示自动消失、250ms 搜索去抖、秘密最长 30 秒清除 | 依附可见组件；尤其秘密清除不能为了减少计时器移除 |
| 请求、进程与启动退出保护 | Provider 查询／下载与退避、Codex 295 秒、对齐与视觉执行 300 秒、Studio 桥 15 秒、子进程 TERM→KILL 2 秒等 | 均依附一次操作或进程；保留资源释放和未知提交保护。没有运行这些操作来制造审计样本 |

当前是否挂载每个前端组件、每次请求实际失败次数没有在本次授权下取得完整遥测，记为未知，不按源码频率外推。

## 如何关闭：仅提供方法，本次均未执行

1. **Worker、脚本自动继续、原生自动化 pump、每日 health**：目前没有保留应用运行且单独停止上述扫描器的受支持管理开关。现有整体停止入口是 `npm --prefix "/Users/dan/Programs/loop-control" stop`，恢复入口是 `npm --prefix "/Users/dan/Programs/loop-control" start`。这会同时停止本机 HTTP／Worker／自动化／自动继续，并锁定本项目 Keychain；不是只关闭一个日检。若希望独立关闭或降频，先确定产品取舍并增加受支持配置，不删除计划行或直接杀随机 PID。
2. **单个已授权自动继续的生产单**：后端已有 Owner／CSRF／幂等保护的 `episode-commands` 命令 `pauseScriptProduction`，参数仅 `episodeId`，会暂停该生产单的后续自动继续；当前正式四步界面未发现对应独立按钮，不能虚构点击路径。它不取消已经提交的外部任务，也不停止全局扫描。需要使用该能力时应经已认证受控入口，不直接 UPDATE 表。
3. **自动备份**：当前已经关闭，无需动作。未来若启用后再关闭，配置位置为主项目 `.loop-control/local/deployment.json` 的 `automaticBackups:false`，通过正常停启生效；会失去新的自动完整归档，旧归档不应被删除。当前没有执行配置修改或停启。
4. **桌面通知**：Owner 菜单 →「通知」→ 关闭「macOS 桌面提醒」并保存；或分别关闭人工确认／失败／交付类别。后端 `138-owner-notification-channels.sql` 同时检查渠道与类别。关闭桌面渠道不等于删除事件、关闭应用内提醒或停止扫描器；重新启用相应偏好即可恢复后续投递。
5. **条件式 UI 轮询**：关闭相应抽屉／面板、离开对应页面或结束任务，既有 effect 清理会停止相关计时器；不要用修改浏览器全局计时器来停止它们。租约、网络超时和秘密清除没有独立安全停用方法。
6. **cron／launchd／GitHub Actions／Codex 本地配置**：本次没有找到归属本项目的实际任务 ID，因此没有可准确指向的关闭命令；不提供含占位任务名的批量停用操作。部分快照也未启用，没有独立调度需要关闭。

## 问题／冲突、建议与实际影响

| 编号 | 问题／证据缺口 | 建议 | 对项目的实际影响与本次处理 |
| --- | --- | --- | --- |
| S4-R01 | 当前相关账本全表空，扫描文件只留最近结果，无法证明月度记录完整连续 | 将“当前保留记录 0”与“真实整月执行／失败次数未知”分开；若需要长期运维趋势，再决定是否增加有界累计统计和保留规则 | 本轮不能给可靠的月度失败率或据此关闭任务；不诊断无关数据恢复，不用历史会话中的旧数量覆盖当前事实 |
| S4-R02 | 4 秒周期虽然相同，但 Worker、脚本授权继续、运维／提醒各有不同状态和消费者；部分没有单项管理开关 | 保留当前职责；若要降低空闲开销，先测量实际 CPU／数据库请求成本，再选择事件唤醒或退避，并验证任务领取与恢复时延 | 未测量资源收益，不能承诺节省比例；随意降频可能影响约定的任务响应与恢复，本轮跳过修改 |
| S4-R03 | 自动备份已关闭、备份根未见归档；现状不能证明可恢复性，也不能自动推导为应该启用或删除 | 保持现状；由 Owner 根据恢复需求另行选择备份策略和恢复演练 | 本次不启用备份、不创建大文件、不更改日常数据；不把未验证备份说成已具备恢复保障 |
| S4-R04 | 其他用户 cron／GUI 域、任意云调度与线程心跳没有完整可用的项目枚举范围 | 只报告已查入口；只有确切项目任务线索出现时再补查对应对象 | 不宣称整机／全账号无调度，不扩大读取无关个人内容或设置 |
| S4-R05 | audit 开始时只 kill(pid,0) 不足以证明日常运行归属 | 已补 listener、命令、cwd、配置时间／路径、数据库端口和容器标签、superuser 只读可见性核对 | 本轮聚合有明确归属；没有调用可能写状态的 readDeployment／Keychain 路径 |

## 只读保护与验证边界

[protection-check.json](step4-evidence/protection-check.json) 确认隔离工作树初始 11144 个跟踪文件（排除主 Agent 所有的 PLAN）内容未变。数据库查询脚本只含只读事务、相关 SELECT 和 ROLLBACK；未执行任何自动化、备份或生成函数，未发送服务信号。没有代码／配置变更，因此不重复测试或构建。

最终观察原工作区有 `SystemStatusDrawer.css / styles.css / ui/impeccable/maintenance.css` 三处并行改动；本子 Agent 没有写原工作区或任何 CSS，也没有恢复它们。该观察与本任务隔离源码保持分开，交主 Agent 保留。

初次辅助脚本因本机 Python 无 tomllib 而未完成 Codex 索引部分，随后改为只读索引键提取并成功；几次包含猜测文件名的搜索未命中，已沿实际 `rg --files` 路径补查，没有将未命中当作无消费者证据。原始私有部署和日志正文均未复制到证据目录，所存仅选定非秘密字段、统计和相关项目元数据。
