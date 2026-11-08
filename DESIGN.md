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

以连续制作轨迹组织工作：冷蓝灰底色承托任务，次级表面色侧栏以蓝色活动态维持位置，白色或深蓝表面承载真实操作。界面保持紧凑，让当前生产单、下一步、审核与冻结配置处于同一上下文。

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
- **导航钴蓝 / `rail`**：登录说明面，文字使用 `rail-ink`。应用侧栏采用浅色一体方案，在侧栏局部将 `rail` / `rail-ink` 映射为 `surface-2` / `ink`；活动项使用 `accent-soft` / `accent`，深色主题沿用同一语义映射。
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

- 应用侧栏默认宽 208px，可主动折叠至 64px；1250px 以下默认宽 180px，900px 以下采用 64px 图标栏。账号保留名称并增加首字缩略标记；每个图标仍有可访问名称与 Tooltip。
- 主内容最大宽 1800px，左右留白默认 30px，1250px 以下 24px，640px 以下 16px。页面标题栏高 84px。
- 工作台采用制作列表加 320px 当前作品列，间距 20px；1150px 以下当前作品移至列表上方。选择列表行更新当前作品，唯一的下一步主按钮打开真实生产单；待审核提醒转至生产单的待审核标签，无阻塞时隐藏空块。阻塞队列与制作列表保留独立分页。
- 生产详情覆盖主内容区，保留侧栏和返回入口，内部最大宽 1540px；返回栏高 64px。任务正文与 300px 审核/配置列相隔 24px。1100px 以下侧列移至下方，700px 以下单列；镜头工作台需要时占满主区。
- 四步制作区占满详情剩余高度，桌面返回栏 46px、作品标题区至少 62px、步骤导航至少 44px。脚本正文为主列；素材采用默认约 41:59 的镜头表格与详情分栏；9px 分隔线支持拖拽、方向键微调、双击恢复默认，比例仅保存在本机浏览器。两栏最小宽度为 280px / 360px。表格和详情分别滚动，900px 以下改为上下布局，表格在自身容器内横向滚动。
- 真实剪辑器使用 154px 可折叠镜头导航；320px补充工具默认收起，仅提供生成、版本、素材登记和字幕对齐，原生属性栏不被强制收起，并排布局避免覆盖字幕预览命中区域；字幕拖动在鼠标离开命中框时继续接收，松开只提交一次位置变更。字幕正文、字号、位置与普通混音由原生控件调整，中央预览和时间线优先。专注剪辑覆盖主窗口，四周留 8px；不替换原生工具。检查交付以成片与文件确认作为主列，检查、问题和交付设置为次列。
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

侧栏分为工作台／生产单与账号两组，组内间距 5px，组间使用 22px 留白。导航条目最小高 40px、字号 13px，账号分组标题 12px；活动态采用 `accent-soft` 背景、`accent` 文字与加粗字重。账号行保留名称和首字标记，更多账号、检索与归档仍在原列表内。OpenChatCut、系统状态和侧栏折叠固定在底部，工具高 36px，上方一条语义分隔线，折叠状态保持 40px 图标目标。工具保留悬停、按下和键盘焦点反馈，系统状态由侧栏入口打开原面板；Owner 工具仍在顶部。主题与侧栏折叠沿用既有状态和持久化逻辑。

### Chips / Status

状态以浅语义底色、同色系文字和紧凑圆角呈现。颜色与真实状态文案配合；历史只读、阻塞、待决不能只靠颜色识别。

### Cards / Containers

任务表面使用 `surface`、`line`、`rounded.surface`；内层内容可用 `surface-2`，避免每层都重复包卡。相邻任务用分隔线和留白组织，弹窗使用 `rounded.dialog`。

### Workbench distribution

工作台的五组阶段采用名称与数量同一基线，下方 3px 轨迹显示当前实际生产单占比；零值使用中性色。它是分布而非完成进度，不新增可点击阶段入口。系统状态悬停只显示简短摘要，点击打开 520px 的右侧抽屉，窄窗占满可用宽度。Worker、任务队列、资源状态和日常维护以分隔线组织，详情按需展开；头尾固定、正文独立滚动，不新增工作台卡片或页面，不叠加黑色 Tooltip。 系统状态点确认健康用 `--lc-success`，异常、离线或待确认用 `--lc-danger`，同时保留文字状态。每日健康检查仅显示通过或异常项数，展开显示数据库、媒体目录、运行程序三项，成功项不重复说明，失败项显示原因；最近失败分项单独折叠。

### Embedded editor

剪辑区随可用空间伸缩，窄窗保留可滚动的时间线和操作入口；补充工具关闭时不占栏宽。原生检查器在紧凑空间缩至 260px，关键帧操作换行，预览工具栏可横向滚动。普通窗口、低高度窗口和浏览器 200% 缩放下均保留保存、退出、菜单及时间线操作；具体可用尺寸以实际验收为准。

原生皮肤保留各自底色与强调色，必要文字依据实际背景校验对比度；画面片段标签使用稳定底色，字幕、音频和视频轨道分别采用可读文字色。宿主补充工具沿用当前明暗主题，不用整体提亮或压暗代替逐项可读性处理。

### Four-step production

脚本确认、素材准备与匹配、剪辑工作台、检查与交付为可切换的四个工作区；摘要来自真实脚本、素材、字幕和交付状态。查看步骤不表示完成，也不授予生成或审批权限。四步标题局部为 18px，表格正文为 12px，关键字段保留标签；蓝灰颜色与全局 token 不变。

主工作区保持固定高度：桌面素材准备与匹配为900px，其余步骤及900px以下窄窗为800px；外层滚走标题与步骤导航，不因滚动放大或缩小。专注剪辑由明确按钮进入全屏。内部工作面板各自滚动。主区复用30/24/16px响应式页边距、顶部28px间隔，补偿滚动条占位以与其他页面两侧对齐。主脚本确认后展示可选取文字的锁定预览，修改需要显式进入编辑；保存修订及放弃未保存输入使用二次确认。只填写一次脚本修订原因，确认后复用该原因并自动继续已有工程的素材规划；旧工程保留为历史快照，失败恢复不要求再填写原因。素材选择镜头后，在同位详情栏切换画面、口播、配乐与音效；当前画面读取已保存原生工程中的实际来源、源区间与播放速度，图片／视频各自使用统一预览、上传／AI生成和手动采用流程；新镜头为空占位，多图作为候选左右切换并显示胶囊计数。生成结果不自动采用；图片可单独用作成片或明确选为视频首帧。首帧版本、构图和生成参数在提交时冻结，浏览图片不改变已选首帧，换图不重生已有视频。已采用视频优先，图片可保留为备用。进入剪辑前，界面与服务端均检查实际画面及文件可用性；多行提示词按镜头和类型保存草稿，新版本可重复生成、比较并明确采用。口播显示本期实际接入模型，默认声音、语言与语速可配置。脚本和镜头可填写音效意图；具体内置音效在剪辑台中添加并调整时间和音量，素材准备保留本地声音导入与配乐设置。本期在线制作授权不代表立即提交，上传和本地编辑不依赖该授权。第三步直接连接真实剪辑工作台，保留已有原生工程。四步界面移除工程历史与诊断入口，原工程、保存快照与历史成片文件保留；主脚本待确认且阻止编辑时，持续显示原因与恢复入口；仅排版变化经正文一致性与版本校验后，可明确确认并沿用原工程，保留旧失效记录与审批。普通非阻断提示使用5秒toast，可手动关闭。脚本上传使用基准区上方的文件槽，支持选择及拖入Markdown/TXT，导入仅更新草稿，确认后保存。基准ID直接显示于已确认正文字数下方。交付设置使用左侧封面图片、右侧标题／简介／标签，标题和标签默认单行、简介默认多行。未保存输入在镜头、素材类型及设置标签切换间保留；已保存来源变更时提供明确冲突恢复。编辑设置跟随真实原生片段，保存与重开使用真实工程版本。原生保存同步当前字幕时序，第四步按导出内容和文件指纹一次确认成片与字幕，不要求逐镜头重复核对；交付包只展示实际验证文件。历史只读单据保留版本、预览和下载，写入控件禁用。

### Historical continuous phase track

历史诊断中的横向连续轨迹包含输入与脚本、视觉准备、分镜审核、逐镜头制作、预渲染审核、合成与 QC、交付。已走过节点使用绿色勾和绿色连线；当前阶段通常为蓝色，仅真实待决时改用琥珀色，未来阶段使用中性色。当前项具备 `aria-current="step"`，窄窗可横向滚动。该轨迹保留旧阶段证据，不替代当前四步工作区导航与真实审核操作。

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

品牌标志采用Owner参考图的开口环形矢量标记和19px Loop Control字标，沿用原蓝色导航背景与rail-ink浅色；删除创作工作区副标题，折叠仅显示环标。脚本必填错误通过字段红框、焦点及可访问关联表达，确认弹窗不使用内部分隔线。前置检查与紧凑重规划提示纳入四步区域内，不占额外页顶布局。

连接编辑表单只在本次保存/测试明确成功后收起，成功反馈显示于列表上方；失败或未知结果保留表单且不回显密钥。连接表的能力列只显示生产能力，服务及模型系列名称显示于“模型 / 服务”列，未配置具体模型时不虚构模型ID。


### 2026-11-07 已批准模板的素材与声音区域

本期素材使用紧凑的自适应方形缩略图网格，图片与视频完整显示；提供全部、图片、视频、音频、脚本筛选。单击选取、拖放沿用，右上角独立预览，弹窗用无底色叉号关闭；面板只保留底部收起入口。面板默认高度 360px，仍可伸缩；主脚本可预览，导入脚本沿用脚本确认页。

生成输入区将参考图入口与提示词合并在同一浅色输入面内，参考图空容器不撑高输入区；工具栏统一 32px 高、13px 字号，窄窗自然换行。图片配置弹层按内容区分宽度：模型 384px、规格 344px、数量 224px、构图 288px，内部主要控件统一 32px 高；主体构图和字幕留白上下排列。图片与视频候选缩略栏放在大预览左侧，图片与视频均宽 60px，与预览同高 260px；超出独立竖向滚动，选中项自动滚入视野。图片完整显示，支持上下键、原左右键及 Home/End，保留采用标记与环形等待；“用作视频首帧”作为外部主操作，“采用到当前镜头”收进更多操作，取消确认后回到菜单入口。视频候选继续在外部提供采用操作。

口播先显示本镜模型、音色、语速及正文，生成操作之后是候选试听和明确采用；本期默认继续由独立设置保存。本镜参数草稿不覆盖本期默认，生成时冻结当前选择。字幕设置保留独立保存入口，既有正文与字幕关系不变。

配乐与声音使用紧凑来源选择、上传和可拖入控件，取消大面积空拖入区。试听候选采用文字、时长、试听与采用按钮；完整播放器按需展开。整期配乐继续按生产单保存，逐镜音效意图仅出现在音效页。验收记录：`docs/verification/template-sections-20261107/REPORT.md`。


### 2026-11-08 口播音色选择

逐镜及本期默认音色使用同一可搜索下拉框，优先显示中文名称，支持按名称或原始 ID 筛选。显示名不改变供应商请求值；未知旧 ID 保留，搜索与取消不提交变更。音色、语速与试听按钮统一 38px 高并对齐底边，原试听缓存及首次合成确认流程保留。

图片生成输入框最小高度 259px，增加的空间用于提示词输入；参考图入口为 52×80px。该尺寸适用于不同面板宽度，工具栏自然换行、参考图和校验信息可继续撑高容器。空提示词不额外显示填写提示，保留禁用生成、超限校验及其他阻断状态。

图片参考图加入后，添加入口与已选缩略图横向同排，提示词独占下一行；多图超出时只滚动参考图行。缩略图与用途总高 80px，提示词保持至少 72px，整体沿用最小 259px 并随工具栏和展开设置增高。无参考图时保留添加入口与提示词并排；视频输入沿用相同的素材行结构。

视频生成与图片生成共用 259px 最小高度、52×80px 添加入口和横向素材行；有素材时提示词独占下行，多图/视频只在素材行内滚动。保留角色顺序、首尾帧、参考图/视频地址、构图与模型特定能力。
视频模型选择菜单同时列出 Pexels 检索连接，不再单设 AI/素材检索切换条。Pexels 是检索来源，不作为生成模型提交：选中后显示检索词及方向、尺寸、页码，隐藏参考素材和生成时长等配置；切回模型恢复生成草稿。两种来源的浏览器草稿分别保存，兼容旧检索选择，结果继续经下载预览、导入候选和显式采用。
视频生成时长摘要与只读值最多显示两位小数；有主声时跟随当前实际口播或视频原声窗口，配置中说明实际使用与服务请求时长。只格式化显示，不舍入提交值；无主声时保留模型约束及可修改默认值。

上传批次结果使用 5 秒可关闭的浮动提示，不在画面准备底部长驻。上传进度、逐文件原因和手动重试收进右上角“上传记录”；提示消失不删除文件、回执或恢复状态，重开后不重播过期提示。导入及候选登记失败由该区域反馈，不重复显示父级常驻错误。

图片/视频的画面类型切换使用有底色的分段按钮；裁剪与时长在候选操作里显示次级说明。跟随已采用主声的视频时长明确标为只读并说明原因，无主声时可编辑，不改变实际生成或采用时序。
口播配置统一放入齿轮设置，按本镜/本期默认区分作用域，页面不再常驻重复表单。本镜参数只供下一次生成使用并保留浏览器草稿，本期默认明确保存。候选默认单行显示正文摘要、时长、试听和采用状态，完整正文与来源信息在已有播放详情里查看；420px 以下容器可换行，确认与警告完整保留。字幕模式、保存字幕与口播动作合并在正文下的操作区。
