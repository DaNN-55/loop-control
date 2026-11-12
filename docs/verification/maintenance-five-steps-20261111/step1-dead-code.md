# 第 1 项：死代码审查与清理

日期：2026-11-11。基线 `aa404667e949225c8fad1dae2e2aed56887cb357`，隔离分支 `codex/maintenance-five-steps-20261111`。未提交、暂存、推送或合并；没有修改主工作区、日常服务、数据库、媒体或秘密。

## 结论

一次清理批次移除了 2 个无消费者的顶层声明及仅服务旧包装的导入：`DeletionCleanupDialog` 和 `WorkspaceViews.navigation`。修改 2 个源码文件，删除完整文件 0 个；源码 diff 为 14 行删除、1 行新增，净减少 13 行。未删除测试、迁移、原型、上游组件或历史数据。

修改前后前端全部 71 个构建文件的相对路径、字节数和 SHA-256 完全一致，包含 JavaScript、CSS、HTML、模块图和资源。实际运行入口仍使用 `RecycleBinDialog → RecycleBinPanel → LocalDeletionRecovery` 与 `LocalCatalogApp.nativeNavigation`。不声称减少下载体积或提高性能。

基线类型检查、前端构建、运行包准备，以及默认全量 290 文件／2104 项全部通过。修改后类型与构建通过；首轮默认全量 289 文件通过、1 文件失败（2097 项通过、7 项失败），原因是本轮构建后遗漏重新准备后端产物。补 `runtime:prepare` 后该失败文件 7 项全部通过。这是分次验收，不能表述为修改后一次全量全绿。

## 范围与方法

按 Git 跟踪清单检查 `src / scripts / public / db` 共 1284 个文件的入口和职责分类。对其中 1012 个 TS／TSX／JS／MJS 文件进行 TypeScript AST 导入图、导出与标识符扫描；再用 TypeScript 符号解析区分同名变量，复核无引用导出。检查 npm scripts、tsconfig、HTML、运行时字符串加载、原生模块登记表、测试与保留原型。扫描器、清单与结果见 [step1-evidence](step1-evidence/coverage-inventory.json)。

自动扫描覆盖全体上述代码；人工核查覆盖下表入口和全部筛选候选，未逐行人工阅读 1012 个文件，也不声称证明不存在其他死代码。第三方 SDK 内部、任意运行配置和所有故障组合不属于本次形式化证明范围。样式和资源按入口核查，未逐条裁剪全部 CSS 选择器。

| 领域 | 已核对的入口、关键路径与分类 | 结果 |
| --- | --- | --- |
| 前端、导航与共享视图 | `index.html → src/local-app/main.tsx → LocalCatalogApp`；`WorkspaceViews`；账号、生产单、设置、回收站与恢复面板 | 删除旧导航数组及旧弹窗包装；当前路径保持 |
| 后端与 Owner API | `tsconfig.local-app.json` 的显式编译根；`scripts/runtime/application.mjs` 的 16 个 `load(...)`；`localRoute / catalog / episodeCommands / connections` | 动态入口保留；未改权限、事务、请求与回执 |
| Worker 与编排 | `tsconfig.worker.json` 的 3 个根；`localWorkerCli / localWorkerService / workerDispatch`；`run-prepared.mjs` 的固定版本加载；`workerResultSchema` | CLI、结果 schema 和队列执行入口保留 |
| 原生剪辑与 SDK 宿主 | `scripts/openchatcut-embedded.mjs`、standalone/render 入口；`openchatcut-host-modules.mjs` 12 个源码登记项及 public alias；注入字符串中的命名导入 | 静态符号零引用不能证明无用，全部保留 |
| 运行、构建与手动 CLI | 所有 package scripts；`vite.config.ts` serve 动态配置；runtime start/application/environment、prepare、storage backup/restore、project-history、inspect CLI、Python 对齐器 | 明确入口和受支持的手动入口均保留；未实际启动日常服务 |
| 存储、迁移与兼容 | `db/local` 163 个迁移及 `db/contracts`；restore publication、native backup；旧字段与持久化类型 | 不按当前直接调用数量删除历史协议、迁移或数据 |
| 框架、测试与原型 | 默认与显式 integration 测试、Vite test setup、fixture/config；全部 prototype HTML/TSX/config | 保留动态夹具、测试保护和 `3dba918f` 明确保留的 Demo |
| 上游、类型、样式与资源 | Dan UI 上游组件、`database.types.ts`、`vite-env.d.ts`；CSS 导入和 public 品牌／模型资产入口 | 保留生成／上游范围；未将未实例化组件视为死代码 |

### 自动候选的逐类复核

- 静态文件图产生 25 个无导入边文件，全部复核为 npm／CLI、HTML、tsconfig、运行时动态加载、框架声明或显式夹具入口，未删除文件。完整列表见 [scan-summary.json](step1-evidence/scan-summary.json)。
- TypeScript 符号扫描产生 13 个无静态消费者的导出，确认删除 2 个，保留其余 11 个。见 [修改前](step1-evidence/symbol-scan-before.json) 与 [修改后](step1-evidence/symbol-scan-after.json)。
- 11 个保留项：`isWorkspaceCandidateEdit / addWorkspaceRegisteredSource` 由 `virtual:loop-control-candidates` 使用；`captionSlotLayoutPatch / redirectLoopControlImport / LoopControlCaptionAlignment / useLoopControlHost` 由宿主注入使用；`restoreNativeBackup / resumeNativeRestorePublication / verifyRestoredFolderOpen` 有动态集成消费者；`nativeBackup` 由运行包装配；`workerResultJsonSchema` 由 Worker schema 输出链使用。见 [动态引用证据](step1-evidence/dynamic-preserved.log)。
- 基于正常运行根、手动脚本、原型根、后端字符串加载和原生注册补边后的文件可达性筛选，剩余 15 个非测试文件：4 个仅被测试消费的业务模块（下述待决定项）、4 个原型／夹具 config、2 个 fixture support、3 个 Dan UI 上游组件、test setup 和 `vite-env.d.ts`。不能整体删除，见 [reachability.json](step1-evidence/reachability.json)。
- 没有发现字面量常量条件的 `if / ternary` 分支或可确认整块注释掉的实现。唯一命名为开关且初值为 false 的候选 `mediaRootRuntime.fixture.ts:loseCommitEnabled` 会在 launch 时改写，是提交回执丢失的故障注入开关，保留。见 [additional-scan.json](step1-evidence/additional-scan.json)。这不等于证明所有复杂条件都可达。

## 执行候选与证据

| 编号 | 对象 | 仓库搜索、可达性及测试证据 | 改动与实际影响 |
| --- | --- | --- | --- |
| S1-D01 | `src/local-app/LocalDeletionRecovery.tsx:DeletionCleanupDialog` | 源码／脚本搜索仅定义；既无命名／namespace 导入，也非动态 registry。历史 `9da21493` 已把正式调用替换为 `RecycleBinDialog`；`RecycleBinPanel` 直接使用 `LocalDeletionRecovery`。该组件 6 条现有行为测试、正式菜单恢复路径均保护实际入口。ADR-0042 要保留的是恢复面板，不要求旧包装 | 删除包装及其 `RefObject / X / useDialogFocus` 导入；`LocalDeletionRecovery` 函数体未改，旧清理任务仍可访问 |
| S1-D02 | `src/workspace/WorkspaceViews.tsx:navigation` | 全仓词法搜索有大量同名属性，TypeScript 符号解析确认该导出只有声明。正式 `LocalCatalogApp` 导入视图与 `NavigationItem` 类型，但导航使用自己的 `nativeNavigation`；没有动态属性查找或重新导出该数组。私有包无 package exports；默认组件测试覆盖当前导航 | 删除旧数组；`NavigationItem` 与正式导航保持；不会改菜单标签、顺序或路由 |

删除前的搜索和历史证据见 [deletion-symbol.log](step1-evidence/deletion-symbol.log)、[deletion-consumers.log](step1-evidence/deletion-consumers.log)、[navigation-consumers.log](step1-evidence/navigation-consumers.log)、[history-deletion.log](step1-evidence/history-deletion.log)。准确差异见 [batch1.diff](step1-evidence/batch1.diff)。

恢复边界：两份原文件已保存在仓库外 `/tmp/loop-maint-step1-20261111/batch1-before/`；它们的起始内容也可从 Git 基线恢复。未使用整树 reset、stash 或提交。一次批次，无源码导致的失败，未撤回任何已验证改动。

## 检查结果

| 检查 | 结果与证据 |
| --- | --- |
| 隔离安装 | `npm ci --no-audit --no-fund` 成功，223 包。保留现有 npm 对 3 个安装脚本的阻止设置，未批准额外权限或改锁文件；见 `npm-ci.log` |
| 修改前类型／构建／准备 | `npm run check`、`npm run build`、`npm run runtime:prepare` 依次通过；见 `baseline-{check,build,prepare}.log` |
| 修改前默认全量 | `npm test`：290 文件、2104 项通过，0 失败、0 跳过；见 `baseline-test.log` |
| 修改后类型与构建 | `npm run check`、`npm run build` 通过；见 `batch1-{check,build}.log` |
| 产物一致性 | 前后 71 文件相对路径、大小及 SHA-256 完全一致；见 [build-comparison.json](step1-evidence/build-comparison.json) |
| 修改后默认全量首次 | `npm test`：289 文件通过、1 文件失败；2097 项通过、7 项失败。`scripts/runtime/application.test.mjs` 加载不到 `dist/local-app/local-app/mediaRootSettings.js`；见 `batch1-test.log` |
| 准备环境补齐与复验 | `npm run runtime:prepare` 成功，再运行 `npm test -- scripts/runtime/application.test.mjs`：1 文件、7 项通过，0 失败／跳过；见 `batch1-prepare.log`、`batch1-application-recheck.log` |
| 扫描复查与限定 diff | 无静态消费者导出从 13 项减为 11 项，消失的正是两处删除对象；`git diff --check` 通过。没有为了清理修改断言或移除测试 |

日志均在 `step1-evidence/`，原始扫描总图与恢复文件另在 `/tmp/loop-maint-step1-20261111/`。扫描脚本保留本轮实际执行版本，包含该临时目录和隔离工作树 TypeScript 库的固定路径，属于本机复跑证据，不是可移植工具；跨机器复跑需调整这些路径。未重新跑其余已通过 2097 项来凑一次全绿。构建仍有既有大 chunk 提示，测试仍有既有 React act／jsdom media stderr；它们未被屏蔽或改成通过条件。

前端全部交付字节不变，因此本阶段没有界面行为或表现改动，未额外打开浏览器。未运行真实供应商、真实数据库集成、第三方 SDK 内部完整验收；本次没有修改对应实现或协议。

## 跳过项、建议与实际影响

| 编号 | 问题／冲突 | 建议 | 对项目的实际影响与当前处理 |
| --- | --- | --- | --- |
| S1-R01 | `src/clipTiming.ts` 正式入口不可达，但 `clipTiming.test.ts` 仍消费其拖动、锁定和铺满语义 | 若确认旧秒级剪辑契约已随原生帧级编辑退役，再一起评估实现和专属测试；不要仅凭无正式导入删测试 | 保留会增加少量维护代码，但不进入当前运行包；删除会取消这组边界回归。本轮保留 |
| S1-R02 | `src/shotAcceptance.ts` 仅有专属测试消费者，涉及旧逐镜头确认顺序 | 先确认是否保留该历史工作流契约，再决定整体退役 | 当前四步／原生工程不调用它；删除将取消旧顺序算法的回归保护。本轮保留 |
| S1-R03 | `src/reviews/materialImport.ts` 的旧材料用途、命名和分类由测试覆盖，生产路径已不直接调用 | 由 Owner 明确是否退出旧材料命名／分类契约后再清理实现和测试 | 不影响当前正式运行；贸然删除可能丢失未来兼容判断依据与回归保护。本轮保留 |
| S1-R04 | `src/worker/manualMaterialChecklist.ts` 仅被专属测试消费，但解释旧冻结蓝图、任务及材料绑定语义 | 核对是否正式取消这部分历史协议支持，再决定实现／测试一并退役 | 当前运行图不加载它；删除会取消旧任务绑定语义的回归覆盖。本轮保留，不改数据 |
| S1-V01 | 本批验证漏在前端 build 后再次 prepare，导致默认全量中的 7 项运行装配测试缺少 dist 后端文件 | 后续固定顺序 `check → build → runtime:prepare → test`，不能并行清空和读取 dist | 影响验收可靠性，不是两处源码清理引入的产品回归；已补准备并将原失败文件 7 项全部复验通过，保留首次失败证据 |

其余动态入口、上游组件、生成类型、迁移和原型属于已确认保留范围，不是等待用户批准删除的缺陷。此次未改任何公共 HTTP、Worker 或原生消息接口。
