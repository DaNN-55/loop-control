# Impeccable 与现有 UI Skills 对比

核验日期：2026-10-27。对象为 `pbakaus/impeccable` 当前 `main`、本机现有 Skills，以及 Loop Control 的部分前端源码。以下结论来自文档与源码检查，没有安装 Impeccable，也没有用同一任务进行效果、耗时或 token 消耗对照测试。

## 结论

对 Loop Control，建议保留现有 Skills 作为日常实现基础，把 Impeccable 视为可选的设计审查与精修工具。若只和现有 `frontend-design` 比，Impeccable 的任务拆分、产品界面指导与验证流程更完整；若和现有整个组合比，它主要提供统一入口、审查闭环和确定性检测，不能据此认定最终设计效果一定更好。

上手有两个维度：Impeccable 把任务命名为 `critique`、`audit`、`polish` 等，比较容易表达意图；继续使用已有 Skills 则没有新的接入成本，也更容易保持项目既有习惯。

## 当前 Impeccable 是什么

仓库当前 `package.json` 标示版本为 `4.8.0`。README 将其概括为一个 Skill、24 个设计命令、浏览器迭代和 62 项确定性检测规则。它由 Anthropic 的 `frontend-design` 发展而来，当前已包含自带引擎的 launcher、CLI 和可选设计 hook，不再只是若干 Markdown 提示词。[版本源码](https://github.com/pbakaus/impeccable/blob/main/package.json)、[README](https://github.com/pbakaus/impeccable/blob/main/README.md)

主要能力分为三层：

- 设计指导：层级、布局、排版、颜色、文案与交互，由当前 AI 编程工具执行。
- 工作流：`shape` 先规划，`critique` 做设计评审，`audit` 查技术质量，`polish` 精修，`distill` 精简，`harden` 覆盖错误与极端输入。
- 工具：确定性检测、可选编辑后 hook、浏览器中的视觉方案迭代。官方说明独立 detector 不使用 LLM，也不需要 API key；这不代表设计生成工作不消耗原有 AI 工具额度。[Skill 源码](https://github.com/pbakaus/impeccable/blob/main/skill/SKILL.src.md)、[CLI 说明](https://github.com/pbakaus/impeccable#cli)

README 的部分命令摘要与 Skill 源码存在差异，例如源码将 `craft` 标为 deprecated，将 `teach` 作为 `init` 别名。实际采用时应以安装版本的入口和 playbook 为准，避免照搬旧教程。[命令路由](https://github.com/pbakaus/impeccable/blob/main/skill/SKILL.src.md)

## 与本机现有 Skills 对比

| 需求 | 本机已有能力 | Impeccable 对应能力 | 对本项目的判断 |
| --- | --- | --- | --- |
| 新页面视觉设计 | `frontend-design` 强调明确风格、字体、构图与视觉表现 | 分成 Persuade、Operate、Read、Experience 模式 | Impeccable 对后台的指导更明确，值得参考 |
| 控件与跨页面一致性 | `dan-ui-foundation` 提供具体 token、控件尺寸、按钮层级和交互约束 | 读取项目设计规范，提供 document、extract、polish | 继续用现有具体规范；Impeccable 可协助检查偏差 |
| UI 技术审查 | `web-design-guidelines` 按最新规则检查实现并输出位置 | audit 覆盖无障碍、性能、主题、响应式及实现一致性 | 有重叠；Impeccable 的评分与 detector 是增量 |
| 极端数据 | `break-ui` 要求真实或 schema 支持的 fixture、切换入口及实际渲染 | harden 覆盖溢出、网络错误、权限和国际化 | break-ui 的数据验证路径更具体；harden 范围更广 |
| 网页动效 | `animate` 区分机会、实现与性能，强调范围和实际验证 | animate 及模式内动效指导 | 当前 Skill 的边界更贴合日常小范围任务 |
| 中文文案 | `tech-doc-style-chinese` 保留事实、项目术语与状态语义 | clarify 改善界面文案 | 中文与领域术语继续以现有 Skill 为准 |
| 提取设计规范 | `design-system-extract` 强调来源、冲突和只读边界 | document、extract | 现有 Skill 更适合有约束的静态提取；后者适合统一设计工作流 |

本机依据：`/Users/dan/.agents/skills/` 下上述各 Skill 的 `SKILL.md`，以及 `dan-ui-foundation/reference/ui-contract.md`。这些是当前本机文件，不是对所有同名 Skills 的泛化评价。

Impeccable 的能力依据：[Skill 命令表](https://github.com/pbakaus/impeccable/blob/main/skill/SKILL.src.md)、[audit](https://github.com/pbakaus/impeccable/blob/main/skill/reference/audit.md)、[harden](https://github.com/pbakaus/impeccable/blob/main/skill/reference/harden.md)。

## 对 Loop Control 的实际价值

项目目前使用 React、TypeScript、Vite 与项目自定义 CSS。`src/ui/` 已有确认弹窗、分页、提示和焦点管理；`package.json` 未声明 `@dan/ui-*` 依赖。因此，「已有 Dan UI Skill」与「项目已全面接入 Dan UI 组件」需要区分，不能把后者当成现状。[项目依赖](../../package.json)、[样式](../../src/styles.css)、[确认弹窗](../../src/ui/ConfirmationModal.tsx)、[焦点管理](../../src/ui/useDialogFocus.ts)

账号蓝图、生产单、连接配置、镜头工作台与审核都属于任务操作界面。基于这些场景，Impeccable 最有价值的使用方向是：检查主次操作是否清楚、跨页面控件是否一致、错误与阻塞是否易懂、窄屏布局是否合理，以及深色模式和键盘操作是否完整。这是适用性判断，不是本轮发现了相应缺陷。[项目术语](../../CONTEXT.md)

其 `Operate` 模式明确允许系统字体、标准导航和高信息密度，要求颜色克制、状态完整、动效用于反馈，并反对后台页面入场编排。因此不能只看 README 的通用审美禁忌，就断言它会把后台改成营销页。[Operate 模式](https://github.com/pbakaus/impeccable/blob/main/skill/reference/operate.md)

它不能验证本项目的审批权限、连接秘密隔离、生产任务状态机或真实 Provider 兼容性。这些仍需领域源码、集成测试和运行证据支持；设计审查评分不能替代业务验收。

## 易用性与接入取舍

已有 Skills 的优势是直接描述任务即可，无须新增引擎、配置与产物目录。Impeccable 的优势是指令词汇统一，后续也能复用项目产品和设计记录。是否更省时间，需要实测。

官方推荐通过 `npx impeccable install` 安装，可选择 provider 与 project/global scope；相关 provider 可安装 hook，交互安装允许跳过，`--no-hooks` 可用于单次跳过。launcher 会运行附带或首次下载的引擎。部分新视觉方向流程会请求官方 roll API，关闭 telemetry 也不会取消该功能请求。因此不能把完整工作流概括为纯提示词或完全离线。[安装与设计 hook](https://github.com/pbakaus/impeccable#installation)、[Telemetry](https://github.com/pbakaus/impeccable#telemetry)

`critique` 当前要求设计评审与 detector/browser 证据两份独立评估；支持子代理时有相应编排要求，Codex 分支还包含委派确认流程。它更适合正式设计评审，日常的小改动未必需要这一套。[critique 流程](https://github.com/pbakaus/impeccable/blob/main/skill/reference/critique.md)

若后续试用，建议限定一个连接配置或账号蓝图界面，先做 audit，再修少量已确认的问题；保留现有视觉语言与领域行为，以修改范围、浏览器结果和交互验证比较收益。初次无需同时启用 live 与自动 hook，也无需替换现有全部 Skills。本轮只交付研究记录，没有执行该建议。

## 检查范围

- 已查官方 README、版本字段、Skill 入口，以及 Operate、critique、audit、harden 规则。
- 已读本机七个相关 Skill 的主体说明及 Dan UI visual contract。
- 已静态检查项目依赖、部分样式、入口与共享 UI；没有做完整 UI 审查。
- 没有安装、执行 detector、启用 hook、启动服务或修改应用代码；没有跑构建和测试。
