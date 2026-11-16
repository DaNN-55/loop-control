# 已完成作品查看改版

> 历史验收记录：其中专用只读剪辑页已按用户后续决定退役。当前入口、隔离副本与最新验收以 [STUDIO-COPY.md](STUDIO-COPY.md) 为准。


2026-11-16。分支：`codex/completed-works-review`。用户已批准实施，合并等待用户后续确认；本次不提交、不推送、不合并，保留起始工作区差异。

## 行为

- 仅 `production_completed` 显示“脚本确认／分镜台／检查与交付”。未完成单、普通归档与历史只读入口保留原有流程。
- 分镜台按用户选定 C 展示全片表格，一次打开一个镜头抽屉。画面／字幕与口播／声音使用相同结构，默认展示采用结果与预览，保存参数按需展开。
- 未采用候选、曾采用、已放弃及失败请求集中查看；有重试的原失败任务仍保留。图像、视频与声音可预览，原始素材架继续只读开放。
- 同一个参数窗口切换制作输入、实际提交和原脚本。请求原快照缺少脚本片段时，明确标为“本期已确认原脚本”，展示匹配的冻结基准分镜或全文；不拿当前剪辑文案冒充原脚本。缺少实际提交正文时明确未知，不从输入推断。
- 顶部“查看剪辑工程”进入专用只读页面。可播放成片、选择片段、缩放时间线和查看保存参数；不挂载 OpenChatCut 编辑器、不获得写连接、不接收业务命令回调。
- “交付对应工程”按导出工程 SHA 读取；“最近保存工程”明确区分。关联未核实时不以片段位置驱动成片定位。文件读取失败显示原因与只读重试，不自动补造工程。
- 浏览器返回与“返回分镜台”均恢复镜头及详情标签；关闭抽屉焦点回到原镜头行。隐藏抽屉卸载媒体，子窗口关闭不连带关闭父抽屉。
- 无当前 workspace 的旧完成单仍可从分镜台进入、返回原 `LegacyEditing` 查看，保留原工程下载和版本选择，不接入编辑。
- 已交付标题、简介、标签分区，可选中文本；复制按钮悬停或键盘聚焦显示，触屏常显。

## C Demo 视觉校准

用户指出首次实现未贴合认可的 Demo：复核长块、额外搜索和纵向抽屉使布局偏离。已移除额外搜索行，恢复 37 × 52 缩略图、约 69 px 镜头行、两行声音状态及蓝色查看入口；六镜总览不再被空白面板拉长。复核事项常驻短摘要，正文按需展开。

抽屉恢复 920 px、四周留白的双栏：左侧成片和使用区间，右侧采用参数、提示词、候选缩略图和保存配置；窄屏改为单栏。请求时长与实际使用区间分别标明，候选数量按真实记录显示。正式系统侧栏、真实标题和已批准的三导航／只读入口保留，不用 Demo 占位文字覆盖生产记录。

已在正式页实际打开并截图对照，见证据目录 `formal-c-overview.jpg`、`formal-c-drawer.jpg`。本轮 9 文件／90 项相关测试通过，11 组真实浏览器动作回归通过，未捕获 JS 错误 0；第三轮只读审查无 P1/P2。本轮视觉修改后未重复整套 2,280 项测试，整套结果为下述此前功能验收。

## 只读边界

当前本机 OpenChatCut 0.2.17 没有完整只读 Editor 模式，其文档变更会自动保存。此次采用已批准替代方案，不用隐藏保存按钮或可编辑工程副本冒充只读。

复用现有 Owner 鉴权、READ ONLY 事务、按 SHA 验证的 `/workspace/project` GET 和受控媒体读取。现有完成态写拒绝保持；不修改共享 SDK、数据库结构、生产数据、规则、根 PLAN.md、模板、日志或 Freesound 实现。

## 质量与历史

两单原始质量观察位于 [原复核报告](../../../verification/repo-cleanup-production-20261115/REPORT.md)，不在数据库问题表。新增的只读观察按生产单和成片 SHA 匹配：事业首镜三行字幕仍标未解决；乔迁旧开场标已替换，旧候选与导出仍可查看。局部挂绳／边缘出框的原记录未明确具体成片和镜头，展示为同批测试的待核对事项，不断言每片均已复现。

这批观察只作为导入的复核证据显示，不新建、解决或改写生产问题记录，也不以交付完成代表质量全部通过。

## 验证

- 类型检查、前端生产构建、后端编译通过。前端仍有大 chunk 提示，未降低构建阈值。
- 相关回归 82 项通过；新增只读、提示词、媒体卸载与嵌套对话框测试通过。视觉校准前串行全套单元测试 **314 文件、2,280 项全部通过**（172.54 秒）。
- 真实隔离 HTTP／PostgreSQL 集成通过：重复读取冻结工程、跨 Owner 拒绝，以及 Studio、生成、导出和交付命令完成态 409；关联记录和冻结文件不变。
- 新建浏览器会话完成 11 组验收：320／768／1024／1440 总览无整页横向溢出，表格窄屏独立滚动；实际视频播放、图像预览放大、三种提示词、三条原 Freesound 失败、只读时间线定位、浏览器与按钮返回、交付文案复制、深色及窄屏交付；0 条未捕获 JS 错误，0 次写命令。
- 视觉校准前 axe WCAG A／AA：0 violations，1 组 incomplete（成片字幕需要人工判读），不宣称完整无障碍验收。
- 两张真实生产单验收前后：55 组关联表记录、387 个文件指纹全部相同，未发现新增、删除或改写。
- 三轮独立只读代码审查未发现 P1／P2（含本轮视觉差异）。

第一次全量测试中的旧四导航断言已更新并通过定向回归。另一次测试与前端构建并行时，Vite 清空 dist 使运行时／备份测试找不到后端编译文件；已恢复编译产物并改为串行测试，不删测试或放宽断言。

浏览器验收使用真实只读投影与现有 Demo 中 SHA 完全相同的样本；未收录样本保持不可用，不替换字节。完整原素材库未逐文件播放，Safari／Firefox 未验证。正式 Chrome 已实际打开分镜台、单镜头抽屉与对应成片。

证据：[/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-2a03-7be0-8b14-06d31b956521/completed-works/evidence/](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-2a03-7be0-8b14-06d31b956521/completed-works/evidence/)。包含生产保留比对、测试／构建日志、浏览器检查、axe 及各状态截图。

## 重现

`capture-readonly.ts` 使用已安装 SDK 的 tsx，仅在只读事务中查询两单并对原文件计算指纹，输出保存在私有证据目录。`serve-preview.mjs` 使用独立 Vite 缓存和记录投影，不连接日常写 API；`browser-check.mjs` 使用 agent-browser 可信鼠标／键盘动作重放。

```sh
.loop-control/local/OpenChatCut/node_modules/.bin/tsx docs/research/production-followup-20261116/completed-works/capture-readonly.ts before <private-evidence-directory>
node docs/research/production-followup-20261116/completed-works/serve-preview.mjs <private-evidence-directory>
node docs/research/production-followup-20261116/completed-works/browser-check.mjs <private-evidence-directory> <isolated-browser-session>
.loop-control/local/OpenChatCut/node_modules/.bin/tsx docs/research/production-followup-20261116/completed-works/capture-readonly.ts after <private-evidence-directory>
```

## Modern Web Guidance

- **`responsive-table`**：我保留真实表格及表头语义，让有名称、可键盘聚焦的外层区域独立横向滚动，沿用 C 的表格对照方式而非在窄屏重复生成卡片（“Use standard `<table>` elements”）。
- **`dialog`**：我用 `showModal()` 保留原生模态语义、焦点约束和返回；只隔离子窗口关闭事件，不重复手写焦点陷阱或 Escape 逻辑；图片放大也留在同一原生 top layer（“DON'T add `role="dialog"`, `aria-modal`, a focus trap”）。
- **`css-layout`**：我用可收缩 Grid 轨道和容器内滚动承载长文件路径与表格，避免裁掉数据掩盖溢出（“Set `min-inline-size: 0`”）。
- 检查了 `tabs` 指导；沿用现有项目的方向键、Home／End 与 roving tabindex，不为实验性 focusgroup 新增依赖。选择态同时使用文字色与下划线，面板与标签关联。
