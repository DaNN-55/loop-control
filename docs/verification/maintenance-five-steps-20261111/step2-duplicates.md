# 第 2 项：重复实现审查与归并

日期：2026-11-11。工作树与分支沿用第 1 项：`codex/maintenance-five-steps-20261111`；HEAD 为 `aa404667`，在第 1 项已验收的未提交改动上继续。没有暂存、提交、推送、合并，没有改主工作区、日常服务、日常数据库与媒体或 Keychain。

## 结果

完成 6 组等价归并，涉及 27 个产品源码文件（含 1 个新模块）；产品源码 75 行删除、59 行新增，净减少 16 行。新增共享模块 `src/worker/fileSha256.ts` 为 8 行，其余共享实现放在已有责任模块。4 个测试文件净增加 113 行；测试和证据不计入代码节省数字。没有以减少行数改变业务规则、错误、身份、费用或持久化格式。

各组定向检查通过；追加第 6 组后，顺序类型检查、前端构建、运行包准备再次通过。第 1–5 组结束时默认全量为 **292 文件／2116 项全部通过，0 失败、0 跳过**，并有真实回执 HTTP／隔离 PostgreSQL **2／2 通过**。第 6 组另有 **12 项摘要定向测试通过**，以及 **3 条选定的口播／配乐／字幕 HTTP／隔离 PostgreSQL／文件集成通过，另外 24 条被名称过滤而未执行**。未在第 6 组后重复无关默认全量，以上分次结果不叠加成一个虚构总数。所有改动与准确计量见 [step2.diff](step2-evidence/step2.diff)、[line-metrics.json](step2-evidence/line-metrics.json)。

## 覆盖与判断方式

从 Git 跟踪清单分类 `src / scripts` 的 1012 个 TS／TSX／JS／MJS 文件。排除测试、夹具、明确保留的原型、Dan UI 上游和生成声明后，对 430 个第一方生产文件中的 4571 个函数／回调做 AST token 初筛。参数名称归一得到 111 组精确候选，其中 6 组实施；其余短回调、闭包、字段假阳性与边界候选逐组给出结论，见 [candidate-index.json](step2-evidence/candidate-index.json)。原始候选位置是修改前行号，不冒充当前行号。

精确 token 相同不构成等价证明：参数归一会误把对象 shorthand 的属性名也归一；闭包还依赖各自状态、调用时机、资源和副作用。91 组是短内联片段，保留局部 JSX 映射、筛选谓词、算术、catch 和状态回调，不新增大量微型包装函数。具名候选也逐项核对作用域、参数类型、返回值、错误、调用顺序和消费者。

额外对具名函数做标识符抽象、保留字符串值的结构扫描，实际得到 2 组不少于 40 token 的近似体，见 [near-groups.json](step2-evidence/near-groups.json)。这不是通用相似度搜索对所有可能变体的完备证明。人工检查以下领域与近似实现，不声称逐行证明全仓不存在其他重复。

| 领域 | 实际检查对象／入口 | 结论 |
| --- | --- | --- |
| 前端与组件 | 正式／紧凑连接工作区、ConnectionDraftSession；ModelsDialog／BillingDialog；WorkspaceViews／OperationsWorkspace；配置修复表单、媒体组件和局部回调 | 共用连接基线；不合并有秘密／非秘密草稿和不同读取归属的组件 |
| 请求与 Owner API | `client.localCommand / localConnectionCommand / localBillingCommand`，`viewTransport`，`connectionModels / connectionBilling`，configuration／episode／lifecycle／receipt 路径 | 普通幂等恢复、秘密元数据摘要、账务随机操作键和旧 transport 拒绝语义不同；仅归并相同 canonical 摘要原语 |
| Worker 与合同校验 | `contracts / runtimePreflight / runtimeEvidence`，durationDecision、acousticAlignmentContract、mediaProviders、codexRunner | 连接版本 UUID 三处归一；不同错误、数值／SHA 大小写、历史合同与类型守卫边界保留 |
| 存储与目录 | `mediaPaths / accountAssetRoots / mediaRootSettings / mediaRootMigration / storageInventory`，历史清理与工作树 Studio 文件验证 | 路径重叠四处归一；有身份／无跟随／前后 stat 验证的 fileDigest 不与简单流式 SHA 混合 |
| 脚本与原生宿主 | storage backup／restore／occupied／native-backup-format、runtime secrets／history consolidation、OpenChatCut host manifest／embedded／standalone | backup 复用已有 TS 路径原语；独立引导、虚拟身份、启动源码快照及 SDK 解析保持 |
| 其他语言入口 | 4 个 native Keychain Objective-C 程序的 main、SecItem／控制／历史枚举职责，单一 WhisperX Python 对齐器 | 不因 JSON 输出包装相似合并不同服务、交互、解锁和秘密读取协议；未操作 Keychain 或 ML 模型 |
| 明确保留范围 | 测试／fixture／原型、上游组件、生成类型、SQL 迁移与历史证据 | 不把这些内容的重复当成当前生产实现；未修改或删除 |

已读取 ADR-0026／0027／0029：宿主注册与源码快照、视觉请求的阶段拒绝、供应商任务恢复和受限下载保留原责任，不跨层归并这些流程。

## 已实施的 6 组

| 编号 | 保留实现与选择理由 | 调用迁移与等价证据 | 每组验证 |
| --- | --- | --- | --- |
| S2-M01 | 导出已有 `runtimeEvidence.isConnectionId`，该模块无反向合同依赖，是连接引用解释的现有纯叶模块 | contracts、runtimePreflight 删除私有副本；接受 `string / undefined`，同一完整 UUID 正则、大小写不敏感、相同布尔结果，无 trim／强转或错误包装变化 | contracts、runtimePreflight、legacyPexelsReference：3 文件 24 项通过 |
| S2-M02 | 在现有 `ConnectionDraftSession` 保存唯一 `connectionDraftBaseline`，基线本就属于两种工作区共享的非秘密会话草稿 | 通用与紧凑工作区全部使用同一函数；字段顺序仍为 name、description 的空串回退、current_version_id、region；未加入秘密或新字段；该模块向工作区的引用只有 type | ConnectionDrafts、CompactConnectionWorkspace、真实 App connectionDrafts：3 文件 26 项通过 |
| S2-M03 | 现有 `mediaPaths` 增加 `assetPathsOverlap`，与既有 `assetPathWithin` 同属字符串路径关系 | accountAssetRoots 的公开名称通过别名保留；媒体根设置／迁移、storage backup 迁移全部调用。仍先判相等，再判双向包含；不引入 realpath，不改变同前缀兄弟目录语义。backup 之前已经导入该 TS 模块 | mediaPaths、reference-integrity、真实 backup 函数入口：3 文件 18 项通过；新增 5 项证明等根／父子在任何文件写入前拒绝，兄弟／独立目录通过该守卫 |
| S2-M04 | 新无副作用叶模块 `worker/fileSha256.ts` 保存现有流式算法，避免历史清理依赖整套 Studio 服务或反向依赖 | historyEpisodeDeletion.hashFile 与 openchatcutStudio.fileSha256 的调用均转向共享模块；沿用默认 createReadStream、逐块 SHA-256、hex 返回及原始流错误；周围文件身份和安全检查未动 | 标准 SHA-256 空文件、abc、百万个 a 多 chunk 向量及 ENOENT；真实 historyBlobTargets 成功和同大小内容变化拒绝：2 文件 3 项通过 |
| S2-M05 | 在已有 `configurationCommands` 中增加 `canonicalFingerprint`，复用未改动的 canonical 排序函数 | 4 个原私有／导出 helper 与 5 处同算法内联迁移，共 9 个模块、21 个调用。productionHash 保留公开 alias；endpoint 是否加入回执输入、全部参数与业务流程未改。没有混用 raw JSON 或 localeCompare 排序摘要 | 3 文件 24 项定向；9 模块 AST 展开完全等价；原算法黄金向量 5 项；真实 HTTP／PG 2 项通过 |
| S2-M06 | 在四者原本已依赖的 `configurationCommands` 导出独立 `jsonFingerprint`，明确保持 raw JSON 顺序，不新增模块或依赖 | studioCommands.identity、workspaceAudio.hash、workspaceCaptionsCommands.fingerprint、workspaceNarration.fingerprint 改为 import alias；同为 unknown 输入、同一原始 JSON.stringify→SHA-256 hex，7 处调用输入不变。其余字幕文本 SHA 保留原始字符串算法 | 新旧 5 模块展开全部等价；固定原字节 5 向量和 undefined／BigInt 异常通过；configurationCommands 当前 12 项；3 条选定真实 HTTP／PG／files 集成通过，24 条未选中 |

准确消费者列表见 [consumer-migration.log](step2-evidence/consumer-migration.log)。未发现这些函数被 `.name / .length / .toString` 反射消费；不把导出名的复用描述成 HTTP、Worker 或宿主公共协议变更。

### 持久摘要的额外证明

[verify-canonical-equivalence.mjs](step2-evidence/verify-canonical-equivalence.mjs) 将旧／新模块中对应别名和共享调用展开为原 canonical SHA-256 表达式，去除导入／重导出及被合并叶声明，再比较全部剩余语句的非 trivia token（包括字面量值）。9 个实际修改模块均完全一致；每个新调用的参数和位置保存在 [canonical-equivalence.json](step2-evidence/canonical-equivalence.json)。导入绑定、别名、原函数体另经人工核对；该比较不是对 TypeScript 程序的普遍语义证明。

黄金向量在改动前从原算法保存，之后以固定期望值验证，覆盖命令对象、嵌套 Unicode／数组、大小写与数字键、null 和空数组。没有在测试中复制新实现作为期望计算。

真实集成使用测试源码中原有独立表达式写入旧格式 payload_hash，然后通过本次实际 HTTP handler 查询：验证 Owner、完整 payload、会话／CSRF、未知回执、错误输入拒绝，以及 lifecycle 私有清理清单不外泄、不执行清理。这比单独 helper 测试覆盖更直接的兼容边界。

### raw JSON 摘要的补充核查

4 个 raw JSON helper 都接受 unknown，原来就导入同一 ConfigurationError 模块，没有可证实的输入、异常、反射或依赖差异，因此完成第 6 组，而不是因为 raw 与 canonical 不能混用就保留 raw 组本身的重复。`jsonFingerprint` 不排序、不兜底、不转换 Buffer、不改变 JSON.stringify 的错误；`canonicalFingerprint` 保持原默认排序算法，二者没有互相替换。

[verify-raw-json-equivalence.mjs](step2-evidence/verify-raw-json-equivalence.mjs) 与 [raw-json-equivalence.json](step2-evidence/raw-json-equivalence.json) 保存 5 个模块的旧／新展开结果：4 个消费者全部业务语句、7 处原输入与配置模块原有语句均相同。没有发现 identity／hash／fingerprint 的名称、参数个数或源码反射消费者。固定向量刻意保留 b,a 与 a,b 两种不同插入顺序，并验证嵌套数组／Unicode、null、空数组；undefined 和 BigInt 仍抛 TypeError。

真实集成只选 3 条已有用例：禁用口播保存且不入队、手工配乐准备／采用／混音／重启保留、字幕字段错误不改原工程。测试实际经过本次 Owner HTTP、隔离 PG、文件及 SDK project reader，不打开 Studio、不启动宿主、不调用 Provider。Studio 的原私有 identity 两处调用由整模块展开证明保持；没有把其他三条业务集成冒称完整 Studio 会话测试。

## 检查、失败和恢复边界

每组修改前原文件保存在 `/tmp/loop-maint-step2-20261111/groupN-before/`；新增文件明确列在 line-metrics。没有整树恢复、stash 或修改前项成果。第 1 项的完整基线沿用其已验收证据，未重复运行基线。

| 检查 | 实际结果／证据 |
| --- | --- |
| 组 1–5 定向测试 | `group1-tests.log` 24；`group2-tests.log` 26；`group3-tests.log` 18；`group4-tests.log` 3；`group5-tests.log` 24。覆盖有交叉，不能相加成最终总数 |
| 组 5 命令过滤 | 命令列出 6 个路径，实际只有 configurationCommands、scriptProductionContinuation、RecycleBinPanel 3 文件存在并执行，共 24 项；commandClient、scriptProductionStore、episodeLifecycle 三个所列测试路径不存在，未执行，未声称通过 |
| 类型检查首次 | `check.log` 因 mediaRootSettings 的旧 assetPathWithin 导入在组 3 后无用途而失败；属于本次可修问题，删除该导入，未改行为或断言 |
| 第 1–5 组顺序检查 | `check-fixed.log`、`build.log`、`prepare.log` 均成功，然后 `default-tests.log`：292 文件 2116 项全部通过、0 失败／跳过；没有并行清空和读取 dist |
| 回执真实集成 | `receipt-integration.log`：明确启用的 commandReceipt.integration.test.ts，1 文件 2 项通过，无跳过 |
| 第 6 组定向／顺序检查 | `group6-vectors-tests.log`：1 文件 12 项通过；`group6-check.log`、`group6-build.log`、`group6-prepare.log` 通过。未重复无关 2116 项默认全量 |
| 第 6 组实际关联入口 | `group6-http-integration.log`：3 个文件各选定 1 条，共 3 条通过；另外 24 条按 testNamePattern 过滤未执行，不是 27 条通过 |
| 差异 | 完整本阶段差异、代码计量、消费者搜索已核查；限定源码 `git diff --check` 通过 |

AST 比较器首次将模板节点的旧 source offset 用到另一份源码，导致打印字符串错乱；改为合成模板节点并按非 trivia token 比较后 9／9 通过。没有为匹配比较器改变产品代码。

保留构建既有大 chunk 提示及测试既有 act／media stderr。没有性能或下载体积的前后测量，不声称此轮提升运行性能。连接工作区只迁移纯序列化函数，没有改 JSX、事件流程或样式；真实组件/App 回归已执行，未额外打开浏览器，不声称浏览器验收通过。

### 隔离集成环境

默认 Docker socket 连接失败后，从项目已有环境文档找到并实际验证专用 Colima socket：`unix:///Users/dan/.colima/loop-control/docker.sock`。未改全局 Docker 配置。用已核对的 setup 模式创建本轮随机容器 `loop-maint2-c010e10acd42`：固定镜像身份、network none、tmpfs、无宿主端口、无 bind mount／volume，只从当前仓库建立 157 项迁移的 schema 基线，fixture 在同一容器内创建随机测试数据库，完全不连接日常库。

只执行两条回执 HTTP／PG 测试，没有调用 Studio 或生成；SDK 路径显式设为本轮不存在的占位目录，未读取或清理日常 SDK。setup 来源和身份见 `environment/setup.mjs`、`environment/run.json`、`integration-setup.log`。没有运行真实 Provider、Keychain、ML 或媒体生产。

完成后检查镜像／标签／网络／tmpfs，确认测试数据库 0、其他客户端 0，再停止本轮容器。`integration-cleanup.log` 与 [integration-stopped.json](step2-evidence/integration-stopped.json) 确认自动移除；没有停止其他容器或服务。

第 6 组另创建专属容器 `loop-maint2g6-0dfc63d2c05d`，沿用相同 schema-only、network none、tmpfs、无挂载／端口及随机 fixture 数据库保护。3 条选定测试需真实 SDK project reader，因此仅读取已安装 SDK 源码，并设置 `TSX_DISABLE_CACHE=1`；未调用会 prune cache 的 Studio 宿主入口，也未更改 SDK、共享缓存或日常工程。该容器在确认测试数据库 0、其他客户端 0 后停止并自动移除，见 `group6-integration-cleanup.log`、[group6-integration-stopped.json](step2-evidence/group6-integration-stopped.json) 与 `group6-environment/run.json`。两次集成容器均已退出。

## 跳过项：问题、建议与实际影响

| 编号 | 问题／冲突 | 建议 | 对项目的实际影响／本次处理 |
| --- | --- | --- | --- |
| S2-R01 | Worker 与 backup 的 kill 同体但捕获不同 child；stop 的计时器、取消和结果协议不同；简单局部函数与单次逻辑内联约定冲突 | 保留当前闭包；只有形成明确共享进程管理需求时，再单独设计公共边界 | 仍维护两处短 kill 片段；不改变退出升级、取消或异常处理。本次保留 |
| S2-R02 | manualMaterialChecklist 与 preflight 的 record 转换同形，但前者是第 1 项待决定的历史测试合同 | 先决定历史合同是否退役，再考虑是否共享该兜底转换 | 只保留少量旧代码，不进入当前正式执行路径；未把历史职责与当前预检绑定 |
| S2-R03 | subscribe／transition／clearSearch 和多处回调捕获不同状态；相同片段不意味着状态所有权一致 | 保留局部状态和短回调；如需统一状态模型另行评估 | 防止串用订阅集合、确认状态、列表筛选或卸载生命周期；保留少量内联重复 |
| S2-R04 | 两种 surface 的动画 reduce 片段相同，但运行集合、取消、完成与关闭时机不同 | 保留完整生命周期；本轮不建立通用动画状态抽象 | 页面关闭与取消意图不变，不为两行逻辑增加统一状态机制 |
| S2-R05 | isRecord／正数守卫可复用，但目前没有无依赖公共基础模块；部分模块位于 native host 登记图，contracts 与 durationDecision 已有单向依赖 | 若需要进一步集中基础类型守卫，先确认共享模块与 host 登记范围；不反向引用 contracts 制造循环 | 保留若干短纯判定；无运行错误或行为变化。未改原生虚拟身份／启动快照，也未新增跨运行时基础层 |
| S2-R06 | 其他摘要仍有默认 sort／localeCompare、原始字符串／Buffer、Buffer digest／hex、供应商签名输入差异，且部分位于独立 Worker／CLI 引导范围 | raw JSON 同域四处已按 S2-M06 归并；canonical 同域九模块已按 S2-M05 归并。其余算法须分别固定旧字节与引导依赖，不能合成一种算法或直接依赖在线认证模块 | 保留具有具体输入／输出／排序／引导差异的短原语，避免历史回执、迁移指纹、冻结工程或账务签名不匹配；不再将同域 raw JSON 四处列为待决定 |
| S2-R07 | quote／摘要分散于独立 CLI 引导与在线模块，部分 quote 有 String() 强转、部分只接受 string | 保持引导范围；如要继续集中，应先确定独立 CLI 的公共工具归属，不能直接依赖认证／在线服务模块 | 留下少量一行实现；离线备份／恢复、秘密引导和现有错误行为保持 |
| S2-R08 | 近似扫描的 updateMediaAdapter／updateExecutor 操作不同字段、键和表单类型 | 保留两个 setter，不按抽象标识符结构合并 | 防止把 mediaAdapters 写入 executors 或扩大可写字段；没有产品缺陷需要修复 |
| S2-R09 | readWorkspaceMetadata／readProject 的运行体相同，但返回不同领域类型；归并需要泛型读取接口或额外类型断言 | 可在后续选择一个局部泛型 JSON reader；本轮保留当前清晰的域类型边界 | 仅保留两处几行 JSON／ENOENT 读取，不影响 Studio 当前行为；未为了小幅行数收益扩大接口 |

上述保留项不是发现了必须修复的产品 Bug；按用户要求附上继续处理的建议与实际取舍。迁移、上游和保留原型属于既定保护范围，不列为待删缺陷。

## 证据与未验证范围

证据目录 [step2-evidence](step2-evidence/inventory.json) 包含扫描脚本／清单、111 组逐项索引、近似候选、每组日志、失败与修正记录、AST 等价证明、完整差异和集成环境回执。脚本保留实际运行版本，含本机绝对路径和 `/tmp` 快照依赖，供本机复核；不是可移植或完整的重复检测产品。临时扫描和组前恢复快照仍在 `/tmp/loop-maint-step2-20261111/`，便于主 Agent 验收。

没有运行完整第三方 SDK、全部数据库／历史协议集成、真实供应商或日常数据操作。第 6 组后只执行受影响路径；2116 项默认全量是前五组完成时的结果。文件 SHA 复用有真实文件／历史清理边界与默认套件验证，但未重新运行 Studio 媒体缓存的完整 SDK 集成；其周围安全检查未改。两条真实回执集成的通过不能泛化为所有持久化路径均完成集成验收。
