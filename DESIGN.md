---
name: "Loop Control"
description: "冷蓝灰底色、钴蓝导航与连续生产阶段轨迹的原生桌面工作区"
colors:
  bg: "#eef2f8"
  surface: "#fff"
  surface-2: "#f7f9fc"
  ink: "#17263e"
  muted: "#596b83"
  line: "#d8e1ee"
  line-strong: "#bdcadd"
  accent: "#365fe0"
  accent-hover: "#254fc9"
  accent-soft: "#eaf0ff"
  rail: "#173e8f"
  rail-ink: "#e8efff"
  success: "#167556"
  warning: "#94600c"
  danger: "#bd4147"
  success-soft: "#e9f5ef"
  warning-soft: "#fff5df"
  danger-soft: "#fff0f0"
  primary-ink: "#fff"
  dark-bg: "#111c2d"
  dark-surface: "#1a283c"
  dark-surface-2: "#203148"
  dark-ink: "#e7edf7"
  dark-muted: "#b3c2d6"
  dark-line: "#35475e"
  dark-line-strong: "#536b89"
  dark-accent: "#87a6ff"
  dark-accent-hover: "#a3baff"
  dark-accent-soft: "#293d65"
  dark-rail: "#0b2149"
  dark-success: "#74d2ac"
  dark-warning: "#e8bc6a"
  dark-danger: "#ff9da3"
  dark-success-soft: "#193b35"
  dark-warning-soft: "#3e3423"
  dark-danger-soft: "#442b39"
  dark-primary-ink: "#102145"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.025em"
  production-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-.025em"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "18px"
    lineHeight: 1.5
    letterSpacing: "-.015em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
    letterSpacing: "0"
  hint:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
    lineHeight: 1.6
rounded:
  badge: "5px"
  avatar: "6px"
  control: "7px"
  inset: "8px"
  compact-surface: "9px"
  surface: "12px"
  dialog: "14px"
spacing:
  space-4: "4px"
  space-8: "8px"
  space-12: "12px"
  space-16: "16px"
  space-18: "18px"
  space-20: "20px"
  space-24: "24px"
  space-28: "28px"
  space-30: "30px"
  space-40: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.primary-ink}"
  button-primary-dark:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-primary-ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-tertiary:
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  navigation:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  status-pending:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  task-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
  phase-track:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
  table-name:
    textColor: "{colors.ink}"
    typography: "{typography.control}"
---

# Design System: Loop Control

## Overview

**Creative North Star: "连续制作轨迹"**

以连续制作轨迹组织工作：冷蓝灰底色承托任务，钴蓝侧栏维持位置，白色或深蓝表面承载真实操作。界面保持紧凑，让当前生产单、下一步、审核与冻结配置处于同一上下文。

桌面工作区采用系统无衬线字体、对齐列表与克制的层级。绿色表示已走过的阶段，琥珀色表示真实待决事项；蓝色负责操作、选择和当前阶段。颜色始终伴随文本、图标或语义状态。

**Key Characteristics:**

- 冷蓝灰工作底色与固定钴蓝导航。
- 紧凑控件、对齐列表、完整生产上下文。
- 连续阶段轨迹连接当前任务、审核与交付。
- 浅色与深色共用语义角色；焦点和窄窗行为可用。

本文件记录原生实现的当前视觉系统。规范值来自 `src/ui/impeccable/foundation.css`、`configuration.css`、`maintenance.css`、`production.css`；控件行为与尺寸同时参考已有 Button、Input、Tooltip 源码。实际入口为 `src/local-app/LocalCatalogApp.tsx`，生产上下文为 `src/episodes/EpisodeProduction.tsx`。`PRODUCT.md` 记录产品约束；`.impeccable/briefs/native-app.md` 记录方向及迁移取舍。

## Colors

主色、状态色与中性色均有明确职责。Frontmatter 是数值规范；无 `dark-` 前缀的键对应浅色 `--lc-*`，`dark-*` 对应深色覆盖，未覆盖值继续继承。`surface-2` 对应 `--lc-surface-2`。已有控件的 `--color-*` 仅是这些语义值的别名，不建立第二套主题。

### Primary

- **操作蓝 / `accent`**：主要行动、选中状态、活动配置节；`accent-hover` 表达悬停，`accent-soft` 承载轻量选择背景。
- **导航钴蓝 / `rail`**：固定导航与登录说明面；文字使用 `rail-ink`。
- **主按钮墨色 / `primary-ink`**：浅色为白色文字，深色切为深蓝墨色。文字与图标使用同一角色，不能沿用控件中的固定白色。

### Secondary

- **松绿 / `success`**：已完成状态与已走过的阶段；`success-soft` 是相应的轻底色。
- **琥珀 / `warning`**：待审核、需决策或待处理事项；`warning-soft` 承载状态文字。
- **错误红 / `danger`**：错误与失败；`danger-soft` 是对应反馈底色。

### Neutral

- **工作底色 / `bg`**、**任务表面 / `surface`**、**次级表面 / `surface-2`**：形成连续背景与有边界的工作区域。
- **正文墨色 / `ink`**、**辅助文字 / `muted`**：区分行动内容、标签与解释。
- **分隔线 / `line`**、**控件边界 / `line-strong`**：用于容器分组、字段和轨迹未完成段。

**The Semantic Theme Rule.** 主题切换通过语义变量与采用控件的别名完成；主按钮文字和图标一并使用 primary-ink。

**The Status Has Meaning Rule.** 阶段颜色来自真实阶段与待决状态，不能用装饰色暗示已完成、待审核或拥有操作权限。

Sidecar 的八阶色带仅供设计面板预览，是从当前规范颜色生成的色调延展；它们不是运行时新增 Token，也不应替代上述语义颜色。

## Typography

**Display Font:** 系统无衬线字体栈；当前没有单独装载的展示字体。
**Body Font:** 同一系统字体栈，中文依次回退至 PingFang SC、Microsoft YaHei。

### Hierarchy

- **Headline**：页面标题使用 `headline`；窄窗标题降为 22px。
- **Production title**：生产单标题使用 `production-title`，保持实体标题与工具栏在同一上下文。
- **Section title / Title**：分区与任务容器分别使用 `section-title`、`title`；局部标题按源码保留字重差异，不把 650 强加给所有二级标题。
- **Body / Control / Hint**：正文、控件、辅助说明分别使用对应角色。列表常用 12px 正文、13px 名称与 10–11px 元数据；这些是密集列表的局部层级，不替代默认正文。
- 阶段、状态、日期与计数使用等宽数字。登录说明语句是独立的响应式大字号，范围为 32–46px，不推广为普通页面标题。

## Layout

- 应用侧栏默认宽 200px，可主动折叠至 64px；1250px 以下默认宽 180px，900px 以下采用 64px 图标栏。每个图标仍有可访问名称与 Tooltip。
- 主内容最大宽 1800px，左右留白默认 30px，1250px 以下 24px，640px 以下 16px。页面标题栏高 84px。
- 工作台采用制作列表加 320px 当前作品列，间距 20px；1150px 以下当前作品移至列表上方。选择列表行更新当前作品，唯一的下一步主按钮打开真实生产单；待审核提醒转至生产单的待审核标签，无阻塞时隐藏空块。阻塞队列与制作列表保留独立分页。
- 生产详情覆盖主内容区，保留侧栏和返回入口，内部最大宽 1540px；返回栏高 64px。任务正文与 300px 审核/配置列相隔 24px。1100px 以下侧列移至下方，700px 以下单列；镜头工作台需要时占满主区。
- 账号蓝图沿用工作区左右边距，不设置独立居中限宽；采用单列表单，依次为账号定位、资产目录、生产能力、审核设置；分镜规划并入能力表。账号选择与保存状态同一行，标识、时区与账号刷新放入操作菜单；检查结果与保存动作位于表单底部。820px 以下缩小分区内边距，600px 以下能力行改为两行并保留执行信息。系列页保留左侧搜索、分页与版本历史，右侧为连续分区表单；保存状态统一放在底部操作区，说明按需显示。其他配置页保留既有布局。
- 登录页使用 1.05:1 左右双栏；左侧是钴蓝说明面和三个静态流程标签，右侧表单最大宽 360px。900px 以下隐藏说明面并保留完整表单。流程标签不表示某个生产单的实际进度。
- 间距优先复用 frontmatter 的已用尺度；表单常见 16px 字段间距、24px 分区间距，任务表面常用 20px 内边距。

## Elevation & Depth

常规列表、工作区和任务容器以表面色与细边界分层。按钮、选择器和普通任务卡不靠抬升阴影表达重要性。模态框与 Owner 浮层保留柔和阴影和半透明遮罩；不对应用背景使用模糊。

### Shadow Vocabulary

- **Overlay**：`0 18px 50px #0002`，通用模态框和 Owner 菜单。
- **Configuration dialog**：`0 18px 48px rgb(12 29 57 / .2)`，阶段配置弹窗。

**The Flat Task Surface Rule.** 常规任务表面以底色、边界与留白分层；阴影用于浮层，不用悬浮感区分普通任务的重要性。

按钮颜色状态过渡为 150ms；减少动态效果偏好会关闭动画与过渡，不依赖动画传达成功或错误。

## Shapes

控件使用轻圆角，任务容器比控件更舒展，弹窗再增加一级。Frontmatter 分别记录控件、状态、嵌套区域、任务表面和弹窗的实际圆角；局部紧凑表面保留中间尺度。导航与表单不采用胶囊轮廓。圆形仅用于阶段节点、状态点等明确的小型标记。

## Components

### Buttons

紧凑、直接，以动作名称区分意图。常用 `sm` 为垂直 8px、水平 12px，文字内部按原控件追加少量留白。动作图标固定 18×18px；纯图标按钮默认 36×36px，侧栏、制作工具与行操作为 32×32px，内部不继承文字 padding 或 legacy 21px flex-basis。主按钮用 `accent` / `primary-ink`，悬停用 `accent-hover`；次按钮使用任务表面与正文，轻按钮使用透明背景与辅助文字。禁用和等待态保留既有 React Aria 语义、可用性与反馈。焦点为语义主色的 2px 轮廓，偏移 3px。

### Inputs / Fields

字段、选择器与多行输入使用同一控件圆角、正文和任务表面。边界角色为 `line-strong`，聚焦使用 `accent`；错误文字保留 `danger`。密码框保留显隐控制，普通输入字段保留可见标签。选择下拉按用户要求移除外部可见标题与标题列，保留关联 label 或 aria-label；内嵌 16px 图标、当前选项和 chevron。必要帮助位于框内右侧，错误与说明继续按需显示。连接短表单将文字标签置上方，控件与帮助统一最大宽644px；已保存连接位于编辑表单和版本区下方。配置长文本允许换行，窄窗堆叠标签。选项由 React Aria 浮层渲染，外层圆角 12px、选项圆角 8px，保留分组、禁用、真实 select 表单值、change 事件与键盘焦点；声音建议框允许任意自定义 ID。

### Navigation

五个原生入口分三组：工作台／生产单，账号蓝图，连接配置／历史资料；组内间距 5px，组间 16px 留白与细分隔线。侧栏条目最小高 40px，活动态采用半透明白底和加粗文字。OpenChatCut 固定在底部四个工具上方，分隔线放在它与四工具之间；四工具默认无边框，系统状态由侧栏底部入口打开右侧抽屉。工具使用悬停、按下、键盘焦点反馈，系统状态和 Owner 菜单展开时高亮，深色主题与侧栏折叠用 aria-pressed 表达当前选中状态。Owner 菜单仅保留登录与安全、权限允许的密钥管理及退出登录；蓝图与系列位于账号内。

### Chips / Status

状态以浅语义底色、同色系文字和紧凑圆角呈现。颜色与真实状态文案配合；历史只读、阻塞、待决不能只靠颜色识别。

### Cards / Containers

任务表面使用 `surface`、`line`、`rounded.surface`；内层内容可用 `surface-2`，避免每层都重复包卡。相邻任务用分隔线和留白组织，弹窗使用 `rounded.dialog`。

### Workbench distribution

工作台的五组阶段采用名称与数量同一基线，下方 3px 轨迹显示当前实际生产单占比；零值使用中性色。它是分布而非完成进度，不新增可点击阶段入口。系统状态悬停只显示简短摘要，点击打开 520px 的右侧抽屉，窄窗占满可用宽度。Worker、任务队列、资源状态和日常维护以分隔线组织，详情按需展开；头尾固定、正文独立滚动，不新增工作台卡片或页面，不叠加黑色 Tooltip。 系统状态点确认健康用 `--lc-success`，异常、离线或待确认用 `--lc-danger`，同时保留文字状态。每日健康检查仅显示通过或异常项数，展开显示数据库、媒体目录、运行程序三项，成功项不重复说明，失败项显示原因；最近失败分项单独折叠。

### Continuous phase track

横向连续轨迹包含输入与脚本、视觉准备、分镜审核、逐镜头制作、预渲染审核、合成与 QC、交付。已走过节点使用绿色勾和绿色连线；当前阶段通常为蓝色，仅真实待决时改用琥珀色，未来阶段使用中性色。当前项具备 `aria-current="step"`，窄窗可横向滚动。轨迹是状态指示，不替代审核与阶段操作。

### Lists / Long names / Tooltip

列表优先对齐实体名称、账号、系列、阶段和行操作。长名称最多显示两行，使用可聚焦 Tooltip 读取全文；名称入口保持原行的打开动作，行菜单仍独立。Tooltip 是补充信息，不承载唯一的错误、状态或必要操作。表格在需要时保留横向滚动。

### Production context / Login

生产详情的下一步、当前任务、审批与冻结配置共享实际生产单。返回入口保留列表上下文，草稿、审批理由、修订与历史只读规则继续使用真实逻辑。登录页沿用同一主题与真实认证接口；登录视觉中的三段轨迹仅是流程说明。

Sidecar 中的静态组件片段用于设计面板展示形状、状态和颜色；它们不接入应用运行时、API 或模拟业务流程。

## Do's and Don'ts

### Do:

- **Do** 沿用语义主题变量，并检查主按钮文字与图标在两个主题下的可读性。
- **Do** 保持列表与生产详情的返回上下文；长名称用两行截断和可聚焦 Tooltip 展示全文。
- **Do** 让阶段轨迹、审核状态与实际 API 数据一致，保留当前阶段的语义标记。
- **Do** 为窄窗折叠导航、堆叠面板和表单；保留可访问名称、必要错误与可见焦点。
- **Do** 优先使用已有 React Aria 控件、真实处理函数与注册的配置目录。

### Don't:

- **Don't** 把阶段轨迹做成可以绕过业务审核的可点击步骤。
- **Don't** 把原型的模拟媒体、假凭据、假导出或虚构列表带入原生运行时。
- **Don't** 给正常任务容器叠加阴影、重复卡片和无关统计，削弱当前操作的层级。
- **Don't** 为缩短界面隐藏必要的字段语义、审批理由、阻塞错误或历史只读状态。
- **Don't** 把设计文档和视觉截图当作全部业务集成测试已通过的证据。

证据范围：本文件依据上述源码与 `docs/verification/impeccable-migration-20261028/` 的原生生产页、深色审批控件、登录浅色/深色/窄窗截图记录视觉系统。实际 CSS 优先于原型；未把原型中的模拟预览、旧深色状态色或旧标题行高写成原生规范。视觉文档不扩展功能验收结论。

2026-10-28 一致性补充证据：`docs/verification/page-consistency-20261028/REPORT.md`，包含逐页独立审查、图标几何测量、无外部标题下拉与实际应用截图。

## 2026-10-28 原型对齐第二轮

- 生产单采用作品、当前阶段、行动状态、最近更新、操作五列。首列最大320px，标题下显示账号/系列；编号、蓝图与产物数进入行操作信息，完整管理操作保留。
- 阶段使用中性文本；行动状态采用语义图标＋文字：准备中（中性）、待审核（琥珀）、制作中（蓝）、需处理（红）、已完成（绿）。移除不一致且过浅的图例。状态来自真实pending及最新任务，待审与阻塞可以交叠，计数不宣称互斥。
- 待审核并入生产单状态标签；标签支持方向键、Home/End与关联面板。标题/编号搜索、状态和排序都先在服务端执行再分页，归档范围与状态筛选分别保留。侧栏徽章与待审核标签使用同一待决口径。
- 搜索和四个选择控件同高36px、同基线，10px间隔；新建/刷新位于状态标签同行尾部。
- QC审核的当前成片和技术证据优先于返回制作和材料准备，真实媒体与审批合同不变。无真实封面时使用名称与账号/系列识别，不填模拟封面。
- 验收：`docs/verification/prototype-alignment-20261028/REPORT.md`。其他已认可主题、导航分组、底部工具、OpenChatCut位置和无外部标题下拉保持。
