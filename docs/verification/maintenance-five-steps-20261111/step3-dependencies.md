# 第 3 项：依赖审查

任务开始于 2026-11-11，本阶段证据采集于 2026-11-12（Asia/Shanghai），目录沿用任务日期。沿用隔离分支 `codex/maintenance-five-steps-20261111`，在前两项已验收的未提交成果上检查。只新增本阶段报告和证据；没有改源码、依赖清单、锁文件、安装树或前两项成果，没有暂存、提交、推送、合并或操作日常服务。

## 结论与实际收益

当前仓库只有一份 npm 包清单及对应锁文件，没有 npm workspaces。全部 **24 项直接依赖（8 项运行、16 项开发）均有当前消费者**，未发现可以证实无用而直接删除的包。CLI、CSS 插件和类型包也已纳入检查，不能只按普通 import 数量判断。

- 移除依赖：0 项；新增依赖：0 项；版本升级：0 项。
- 自行实现的替代功能：0 项、0 行。
- 实际减少的安装占用：0 字节；没有声称浏览器包体、构建时间或运行性能提升。
- 所有保留项及其消费者逐项列在下表；存在替代取舍的候选另附问题、建议和实际影响。

## 范围、方法与证据

按 Git 跟踪清单与当前 `src / scripts` 新文件检查活跃包清单，只有 `package.json`、`package-lock.json`；历史 `publish_package.json` 是业务交付包，不是 npm 清单。没有把独立安装的 OpenChatCut SDK、Python／WhisperX 环境当成本仓库 workspace，也没有读取或改变它们的依赖树。`scripts/whisperx-align.py` 明确由环境管理员提供 `whisperx / torch`；当前仓库没有活跃的 pip 安装清单，历史验收的 requirements 留作证据。

扫描 1093 个源码、脚本、CSS 和配置文件的包标识符、子路径、显式 `node_modules` 路径及相关框架配置；人工检查真实入口、npm scripts、Vite／Vitest 配置、Dan UI 来源清单、CSS 插件和上游 `cx`。完整引用位置见 [dependency-references.json](step3-evidence/dependency-references.json)，包版本与扫描范围见 [manifest-summary.json](step3-evidence/manifest-summary.json)。引用数包含测试及夹具，只用作定位线索；下表给出保留所依据的实际职责。

类型依赖另通过现有 TypeScript API 解析四份 tsconfig 并创建只读 Program，记录编译图实际加载的声明文件，没有 emit。`@types/node` 在四份配置均加载；`@types/pg` 在后端／Worker／前端类型图加载；`@types/react / react-dom` 在应用与 Vite 类型图加载。见 [type-resolution.json](step3-evidence/type-resolution.json)。

同时读取 ADR-0009、Dan UI `README.md / UPSTREAM.json`：当前本机控制台与共享控件仍是正式入口；不能按目录名称或单次实例数量把控件基础设施视为已退役功能。

## 8 项运行依赖

版本为本轮锁文件实际版本；声明范围保留在清单证据中，未做更新。

| 依赖 | 锁定版本 | 当前消费者与保留理由 |
| --- | --- | --- |
| `@untitledui/icons` | 0.0.23 | `LocalCatalogApp / SystemStatusSurface` 的 XClose，以及 Dan UI Input、Select、Dropdown 等共享控件；11 处精确包引用，不是只有历史样例 |
| `@videojs/react` | 10.2.0 | `src/ui/media/AudioPreview.tsx / VideoPreview.tsx` 使用 Audio／VideoPlayer、控件、音量、手势、快捷键、状态播报、中文语言注册及音频皮肤；不是原生 media 标签的单一薄包装 |
| `lucide-react` | 1.31.0 | 账号、连接、生产工作区、预览等正式界面的图标；68 处引用，和 Untitled 图标系统并存；统一需要图标映射与上游改动选择 |
| `pg` | 8.23.1 | `scripts/runtime/services.mjs` 的 PostgreSQL Client 与本地服务／Worker 中的 Pool／PoolClient；承载真实事务与查询，不可用几十行等价替代 |
| `react` | 19.2.8 | `src/local-app/main.tsx`、正式组件及状态／生命周期 hooks，亦用于原生宿主注入代码；当前渲染框架 |
| `react-aria-components` | 1.21.1 | 真实连接弹窗、草稿离开保护，以及 Dan UI 的输入、菜单、Tooltip、Modal 等；负责交互、可访问性和焦点相关合同，不与 React DOM 或 Video.js 等价 |
| `react-dom` | 19.2.8 | `src/local-app/main.tsx` 的 `createRoot` 与现有 portal／组件渲染入口；和 React 分别承担状态／组件模型与 DOM renderer 职责 |
| `tailwind-merge` | 3.7.0 | `src/ui/dan-ui/utils/cx.ts` 的 `extendTailwindMerge`，含 display 字号主题扩展，广泛服务正式控件；包装短不代表被包装的冲突规则可用字符串拼接替代 |

## 16 项开发依赖

| 依赖 | 锁定版本 | 当前消费者与保留理由 |
| --- | --- | --- |
| `@tailwindcss/cli` | 4.3.3 | `scripts/build-dan-ui.mjs` 显式运行 `node_modules/@tailwindcss/cli/dist/index.mjs`；由 `npm run ui:build` 暴露，不需要普通源码 import 才算消费者 |
| `@testing-library/react` | 16.3.2 | 账号、工作区、组件及宿主回归的 render／screen／cleanup；147 处引用，负责渲染与查询 |
| `@testing-library/user-event` | 14.6.4 | 账号表单、连接草稿、真实 App 等回归中的键盘／指针交互；54 处引用，与 render/query 工具职责不同 |
| `@types/node` | 24.13.3 | Worker／后端 tsconfig 显式 `types: ["node"]`，Node builtins、Buffer、NodeJS 命名空间等；只读编译图实际加载 66 个声明文件 |
| `@types/pg` | 8.23.1 | 项目大量 `Pool / PoolClient / QueryResult` 等 PostgreSQL 类型；只读编译图实际加载 pg 声明，不能因无 `@types/pg` 字面导入删除 |
| `@types/react` | 19.2.18 | React 组件 props、hooks、Ref 和 JSX 类型；应用编译图实际加载，不是运行时 React 的重复实现 |
| `@types/react-dom` | 19.2.4 | `react-dom/client`、portal 与 DOM renderer 类型；应用编译图实际加载 |
| `@vitejs/plugin-react` | 5.2.0 | 根 `vite.config.ts` 与 `scripts/runtime/vite.config.mjs` 的 React 编译插件；同时被隔离浏览器夹具采用 |
| `jsdom` | 26.1.0 | 根 Vite test 模式指定 `environment: 'jsdom'`，部分宿主集成直接创建 `JSDOM`；不是仅出现在依赖清单 |
| `postcss` | 8.5.32 | `scripts/build-dan-ui.mjs` 解析 CSS AST、展开 layer、保留 property、改写主题选择器并包入 scope；不能以几条正则证明可等价替代结构解析 |
| `tailwindcss` | 4.3.3 | `src/ui/dan-ui/styles/entry.css` 的 `@import "tailwindcss"`，与 CLI 配合编译已采用控件的类规则 |
| `tailwindcss-animate` | 1.0.7 | entry.css 显式 `@plugin`；正式 Tooltip／Modal／Dropdown 的 `animate-in / animate-out / fade / zoom / slide` 类有实际消费者 |
| `tailwindcss-react-aria-components` | 2.2.0 | entry.css 显式 `@plugin`；共享控件使用 placement 等 React Aria 状态／位置变体，与动画插件生成不同种类的规则 |
| `typescript` | 5.9.3 | npm `check / build / worker:build / backend:build` 的 `tsc`，runtime prepare 构建链，以及部分既有测试的 AST API；属于当前工具链 |
| `vite` | 7.3.6 | 前端生产构建、本机 Vite 服务、插件机制与隔离浏览器夹具；不能由 Vitest 替代这些入口 |
| `vitest` | 3.2.7 | npm test／watch／显式集成、`vitest/config` 和现有全部测试；复用 Vite 基础不等于和 Vite 是相同工作 |

## 替代或合并候选：问题、建议与实际影响

| 编号 | 问题／冲突 | 建议 | 对项目的实际影响与本次处理 |
| --- | --- | --- | --- |
| S3-R01 | 两套图标库都提供图标，但当前正式页面和 Dan UI 分别消费；统一会要求逐图标映射，并修改共享控件的上游适配 | 若要统一，先选择保留哪套视觉并明确是否改上游控件，再按具体图标验收尺寸、线条和对齐；本轮保留两套 | 当前安装目录分别占 19292 KiB 与 40836 KiB，但这不是已获等价证明的可回收收益。贸然删任一包会直接使当前导入无法解析；没有承诺统一后的精确占用或视觉一致性 |
| S3-R02 | `tailwind-merge` 只有一个直接包装文件，但实际规则涉及 Tailwind 冲突分组、变体与自定义字号，不是简单 join | 保留上游工具；若要自写，先列出现有类合并合同并证明全部边界等价，再决定是否承担规则维护 | 安装目录 1108 KiB，目前没有等价替代证明；换成字符串拼接会留下冲突类，可能改变控件样式。没有新增替代代码 |
| S3-R03 | PostCSS 看似只服务一个构建脚本，但处理嵌套规则、at-rule 与选择器结构；两个 Tailwind 插件也分别处理动画和 Aria 变体 | 保留 AST 与插件边界，不用少量字符串替换冒充等价 CSS 编译链 | 删除将破坏 `ui:build` 或丢失真实控件规则。当前安装目录大小不能等同可删除体积；没有修改生成 CSS 或工具配置 |
| S3-R04 | Video.js／React Aria／React DOM 及两套测试工具用途相邻，但分别负责媒体状态与控制、通用可访问控件、DOM renderer、测试渲染和交互 | 按现有职责保留；若希望减少基础设施，应先单独确定产品能力和交互合同的取舍 | 替换会涉及媒体、焦点、键盘、菜单或测试协议，超出本轮不改行为的依赖清理；未移除能力、放宽测试或更换框架 |

没有发现能以几十行新代码完整替代且有明确维护收益的已使用直接依赖。没有执行未获等价证明的替代，也没有为减少包数取消现有行为。

## 可比安装度量

Node `v24.20.0`，npm `12.2.1`。本轮没有重新安装或 prune，以同一安装树在审查前后测量：

| 度量 | 审查前 | 审查后 | 减少 |
| --- | --- | --- | --- |
| 直接依赖 | 24 | 24 | 0 |
| 锁文件包条目（不含根） | 306 | 306 | 0 |
| 当前平台实际已安装的锁文件包目录 | 223 | 223 | 0 |
| 普通文件逻辑字节（按 inode 去重） | 183200237 | 183200237 | 0 |
| 分配字节（唯一 inode 的 stat_blocks × 512） | 279494656 | 279494656 | 0 |
| `du -sk node_modules` | 272944 KiB | 272944 KiB | 0 |

306 个锁条目包含其他平台的 optional 包，不能描述为本机实际安装了 306 个包。分配字节约 266.55 MiB，普通文件逻辑字节约 174.71 MiB；口径不同，不相减当作可回收空间。此度量含当前安装目录中的编译缓存，不是下载压缩包大小，也不是浏览器产物大小。详见 [install-comparison.json](step3-evidence/install-comparison.json)、[install-before.json](step3-evidence/install-before.json)、[install-after.json](step3-evidence/install-after.json) 和 `du-before / du-after`。

## 检查结果与边界

- `npm ls --all --json` 前后均成功，安装依赖图完全相同；未报告 missing／invalid 问题，结果分别保存在 `npm-ls-before.json / npm-ls-after.json`。
- npm manifest、锁文件 SHA-256 前后一致；审查开始时记录的 4498 个受保护源码／配置／证据文件内容未变，既有 Git 差异保留。见 [protection-check.json](step3-evidence/protection-check.json)。
- 只读 TypeScript 解析证实类型包实际进入编译图；它不是本轮重新执行类型检查或声明所有测试通过。
- 安装比较辅助 Python 命令首轮因 stdin 非 UTF-8 文本未执行成功，改为 ASCII 辅助代码后完成；没有改产品或依赖，也没有把该次失败算作验证通过。初次搜索还包含不存在的 `.github`／猜测的数据库文件路径，已改用真实入口与跟踪清单，没有以这些无匹配结果判依赖无用。
- 本阶段没有源码／依赖变更，因此未重复前项已通过的测试、构建或真实集成，也未运行 `ui:build` 改写生成 CSS。前项测试结果保持原有时间点与范围，本报告不把它们改称本阶段重新通过。

未审计所有传递依赖的内部实现，也未运行漏洞、许可证或升级评估；传递安装图已记录，但当前任务的移除判断以直接声明及其真实消费者为依据。独立 SDK／Python 部署和日常服务未变，未做包删除、环境缓存清理或任何真实生成请求。

证据中的辅助脚本保留本机实际绝对路径，属于本机复核工具；跨机器运行需调整路径，不作为可移植项目工具发布。
