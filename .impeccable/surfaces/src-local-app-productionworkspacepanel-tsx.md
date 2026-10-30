---
version: 1
slug: "src-local-app-productionworkspacepanel-tsx"
primary_target: "src/local-app/ProductionWorkspacePanel.tsx"
related_targets: ["src/local-app/EmbeddedStudioHost.tsx","src/local-app/WorkspaceScriptPanel.tsx","src/local-app/WorkspaceExportPanel.tsx","src/local-app/LegacyProductionSteps.tsx"]
---

# 四工作流紧凑生产工作区

Mode: Operate。单 Owner 在桌面连续完成脚本、素材、剪辑、检查交付；默认1440px，保留窄窗访问和真实业务边界。

## Direction contract

THESIS: 以镜头和当前操作对象组织工作，将重复纵向表单改为镜头列表与同位详情；首次生成前移，候选比较和最终文件确认仍需明确操作。

OWN-WORLD: 延续 Loop Control 冷蓝灰、钴蓝、系统字体和细边界。颜色来自既有 lc 语义 token，不建立新主题；不使用模拟媒体、凭据或业务数据。

STORY: 用户能巡视整期镜头，就地完成当前镜头设置，再进入真实原生编辑器、确认准确成片并交付。历史内容、错误、恢复、只读与版本围栏完整保留。

FIRST VIEWPORT: 紧凑生产单头与44px四步导航；素材左表右详情，可拖拽调宽并记住比例；脚本正文占主区；剪辑由镜头导航、真实OpenChatCut和可收起设置栏组成，专注剪辑扩大编辑区；交付左成片、右检查问题和交付表单，表单内部左封面右标题／简介／标签。

FORM: 用户明确选择本会话 production-compact 四页 HTML 原型，要求正式对齐，编辑区尽量扩大；不进行新的视觉方案竞选。seed: none (user-approved prototype)。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 验收

保留所有原有按钮设置、旧单内容与真实引擎能力。隔离真实HTTP/PG/Worker/Studio/渲染完成普通页面新建至交付；在线Provider连接单独验证，余额/生成质量不混作通过。保存逐步截图和文字日志，用户已授权全量迁移。

第二轮交互：已确认脚本预览锁定；本期真实模型设置、逐镜上传／AI画面与多音效；当前预览以保存原生工程为准；版本记录收纳右栏底部；第三步直接连接原生编辑。新增拖拽比例仅保存浏览器，不改生产数据。

第四轮：四页工作区默认800px，外层滚走标题/导航后铺满窗口，原生编辑器同步伸缩；单次脚本修订原因随确认动作复用并自动接续规划。整期工程快照缩短与原工程备份同排，移除右栏旧整期成片/交付面板，仅移除界面且保留历史文件。

第五轮：右栏原工程与历史快照统一选择、统一查看，移除诊断入口；基准ID直接显示于已确认正文下方。脚本基准上方设置文件槽，支持点击及拖入脚本，保留确认/取消边界。

第六轮最终决定：四页不显示工程记录入口，保留全部工程快照文件；待确认提示用5秒toast。800px画布与全窗在同一布局连续衔接，不再滚动阈值切换；主区页边距与其他页面30/24/16px一致，标题顶部84px。
