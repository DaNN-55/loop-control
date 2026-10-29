# Loop Control：PC 全量视觉与极端数据审查

2026-10-28 · 以下保留修复前审查证据。

更新：用户已授权并完成16项修复，见[PC修复与复验报告](../visual-fixes-20261028/REPORT.md)。原有问题表与评分不代表修复后状态。

## 实现完整性结论

**本轮不通过。** 现有 Dan UI 已形成统一的导航、表单、弹窗和状态体系，但组件接入存在重复失配：强制挂载页签没有隐藏非活动面板，按钮内部包装改变了旧 CSS 的作用范围，InputBase 的禁用外观没有传递给原生输入。这些问题会直接影响实际操作，不能按一般视觉润色处理。

Impeccable 源码检测器本轮运行一次，返回 **0 项**，见 [detector.json](detector.json)。这个结果只表示检测规则未命中；页面截图、原生键盘操作和 DOM 尺寸测量仍复现了下列问题，不构成视觉通过证据。

## 结论与优先级

共 **16 项：P0 0、P1 7、P2 8、P3 1**。P1 是影响操作或关键内容可见性的缺陷；P2 有替代路径或属于规模风险；P3 是局部体验修整。Break UI 的 Broken / Ugly / Fragile 单独描述故障表现，不与 P0–P3 等价。

最先处理：**页签内容错位、系列名称覆盖表单、保存中仍可编辑、深浅主题文字对比度、收起侧栏后入口消失**。继续保留紧凑的 PC 工作台方向，不建议为了修复这些问题全局放大间距、堆叠卡片或重做视觉风格。

| 维度 | 分数 / 4 | 当前证据 |
| --- | --- | --- |
| 可访问性 | 2 | 已有标签、焦点与错误提示；关键文字对比不足，禁用状态与可操作性不符 |
| 性能 | 2 | 有分页；系列一次渲染1284项，构建仍有大 chunk 提示，未做运行性能剖析 |
| 主题 | 2 | 浅深主题与 token 已建立；实心品牌色误用于说明／选中背景，局部白底未适配深色 |
| PC 尺寸适配 | 2 | 1280–2560px 的多数框架可用；实际栏宽内有覆盖、局部横滚和弹层越出视口 |
| 实现完整性 | 2 | 组件视觉基本一致；页签、按钮包装、输入禁用三类共用边界失配 |
| **合计** | **10 / 20** | **需要明显修正（技能分段：10–13）** |

该评分是本轮 PC 审查的工程判断，不是 WCAG 合规认证；响应式维度按用户要求限定 PC，未将移动端表现拉低桌面优先级。

## What broke：逐项问题与建议

每一行都包含触发值、可见后果和修复位置。源码行号以本次工作区快照为准。

| # | 优先级 / 表现 | 字段、状态与触发值 | 实际后果 / 用户影响 | 修改建议与定位 |
| --- | --- | --- | --- | --- |
| 1 | **P1 / Broken** | TabPanel：切到「历史资料」或「画面与构图」 | 非活动面板带 data-inert=true，却仍可见并占高度。历史前残留约479px连接表单；画面面板前残留约966px声音表单，用户看到内容与选中页签不符 | 在共用 TabPanel 正确隐藏非活动内容，同时保留挂载以保留草稿。`src/ui/dan-ui/components/application/tabs/tabs.tsx:145`；调用点 `LocalMaintenancePanel.tsx:20`、`EpisodeProduction.tsx:2018`。`$impeccable harden` |
| 2 | **P1 / Broken** | series.name：「城市日常与跨境生活观察：Aleksandra Wiśniewska-Kowalczyk 的联合拍摄记录」 | 1440px 下左栏230px，系列按钮实际约463px，进入从x=488开始的右侧编辑区，文字与输入框互相覆盖 | 左栏、按钮、文字列约束 min-width:0 / max-width:100%，名称正常换行；去掉继承的 nowrap。保留完整名称。`src/accounts/AccountWorkspace.tsx:208`；`src/ui/dan-ui/styles/product.css:193`；`src/styles.css:769`。`$impeccable layout` |
| 3 | **P1 / Broken** | InputBase：isDisabled=true，新建账号 pending | 输入框变灰，但 disabled=false；原生 Chrome 键盘粘贴仍把名称改成 test-pending-name。用户会误以为提交中改动属于本次提交 | 将禁用状态传到实际 AriaInput；核查独立 InputBase 的所有 pending 调用。修复后再验焦点停留／返回。`src/ui/dan-ui/components/base/input/input.tsx:53,129`；`src/accounts/AccountForm.tsx:46`。`$impeccable harden` |
| 4 | **P1 / Broken** | 深色：蓝图说明、活动导航、选中密钥、选中配置项 | 小字号文字与实心紫底对比不足：说明约1.91:1，导航约2.24:1，配置项约3.35:1；选中密钥引用／分类约1.36:1。影响识别和阅读 | 使用对应主题的弱品牌背景与匹配前景成对定义；不要把 solid token 直接作为说明底色。`src/styles.css:664,794`；`src/ui/dan-ui/styles/product.css:26,96,129`；`src/ui/dan-ui/styles/theme.css:691`。`$impeccable harden` |
| 5 | **P1 / Broken** | 浅色：12px「分镜生成与审核」「合成与 QC 审核」 | 警告文字黄600配黄50，约2.83:1；普通字号应达到4.5:1，审核状态不够清楚 | 换用测量达标的深警告文字 token，保持浅底和语义；浅／深主题分别复测。`src/ui/dan-ui/styles/product.css:71`、`theme.css:280`。`$impeccable harden` |
| 6 | **P1 / Broken** | 收起侧栏：OpenChatCut 入口 | 共用 Button 的 data-text 包装 span 被旧选择器整体隐藏，图标与名称一起消失。剩下36×16px空按钮；真实页面与合成工作区均复现 | 通过 iconLeading 放置独立图标，或只隐藏实际标签；收起态保留明确方形入口及 tooltip。`src/styles.css:237`；`src/local-app/LocalCatalogApp.tsx:115`。`$impeccable harden` |
| 7 | **P1 / Broken** | 深色：历史产物「放大查看」按钮 | 保留白色半透明底，按钮文字使用深色主题浅灰；约2.35:1，图上操作入口不清楚 | 局部定义成对前景／背景，必要时使用稳定遮罩；灯箱关闭按钮也应核查同类组合。`src/styles.css:178`；产物按钮 `src/episodes/EpisodeProduction.tsx:2324`。`$impeccable harden` |
| 8 | P2 / Ugly | 运营阻塞项：长但小于200字符的生产单标题 | 1440px 下列表 clientWidth=561px、scrollWidth=838px；标题 nowrap 导致局部横滚，用户需横向移动才能读完 | 标题列 min-width:0、正常换行，操作列不收缩；不用横向滚动承载单条标题。`src/operations/OperationsWorkspace.tsx:93`；`src/ui/dan-ui/styles/product.css:191`。`$impeccable layout` |
| 9 | P2 / Ugly | 生产单账号列：长中文账号、带重音人名 | 正常头像22×22px；长中文行缩成约6.7×22px，重音名行约13.2×22px，账号列视觉锚点变形 | 头像 flex-shrink:0；文字列 min-width:0，根据名称换行行数决定顶部对齐。`src/styles.css:53`；头像尺寸覆盖 `src/ui/dan-ui/styles/product.css`。`$impeccable layout` |
| 10 | P2 / Fragile | 当前账号选择器、Harness摘要 storyboard-planning-v1 | 账号选择器在宽桌面仍仅约160px；1280px三栏配置里普通 Harness 标识已省略。完整值需打开下拉／配置才可核对 | 账号选择器给出随空间增长的上限；关键标识可换行或提供键盘可用的完整值提示，路径／文件名优先中间省略。不要截断版本数字。`src/ui/dan-ui/styles/product.css:134`；`src/styles.css:335,724`。`$impeccable layout` |
| 11 | P2 / Fragile | 第二个折叠镜头：「另4项…」菜单靠近视口底部 | 1440×1000下菜单顶部约682px、底部约1033px，尾部操作部分落到视口外；可以滚动到达，但增加查找成本 | 使用现有 Popover 的碰撞检测、翻转和位移；保留键盘退出与返回焦点。`src/styles.css:1305`。`$impeccable harden` |
| 12 | P2 / Fragile | 2560px：账号定位、规则等正文表单 | 表单随视口无限拉宽，单行阅读距离过长；紧凑字号与超长行叠加，不利于逐项校对 | 为叙述性字段设合适最大宽度，按实际中文内容校准；建议正文约65–90ch作为起点，表格仍使用可用宽度。`src/styles.css:743,769` 与 `.account-configuration-form`。`$impeccable typeset` |
| 13 | P2 / Ugly | 密钥列表 purpose：一段真实多语言制作说明 | 每个列表项完整重复长用途，单项约180px高，1000px窗口里只能扫到少量条目；右侧详情已重复同一内容 | 列表保留名称、状态、1–2行用途摘要，详情展示全文；引用编号仍应可完整读取／复制。`src/local-app/LocalSecretAdministration.tsx:64`；`src/ui/dan-ui/styles/product.css:95`。`$impeccable distill` |
| 14 | P2 / Fragile | series.length=1284 | 实际渲染1284个系列按钮、6607个DOM节点，页面高度87658px；查找成本已明显增加。未测得帧率，不声称已复现卡顿 | 先增加系列搜索与分页；在真实性能测量后再决定是否虚拟化。`src/accounts/AccountWorkspace.tsx:208` 的 series.map。`$impeccable optimize` |
| 15 | P2 / Fragile | 新建生产单 title 长度边界 | 前端无 maxLength、无计数，后端超过200字符拒绝；用户可以先录入无法保存的标题。此项为源码边界确认，不是线上超长提交实测 | 前端与后端统一200字符策略，给出明确剩余长度／超长提示；兼顾既有数据，避免静默裁剪。`src/episodes/EpisodeForm.tsx:68`；`src/local-app/episodeCommands.ts:66`。`$impeccable harden` |
| 16 | P3 / Ugly | 字段标签与帮助动作 | 可访问名称包含「版本名称 版本名称说明」「版本摘要 版本摘要说明」，密码标签还混入「显示密码」。可操作，但读屏播报冗余 | 把关联 label 文本与帮助／显示密码动作分开，帮助正文通过 describedby 关联，保留独立按钮名称。`src/platform/ConfigurationForms.tsx:71`；`src/ui/dan-ui/components/base/input/input.tsx`。`$impeccable polish` |

### 证据与复现入口

| 问题 | 证据 | 复现步骤 |
| --- | --- | --- |
| #1 | [维护页截图](screenshots/maintenance-history-selected-1440-light.png)、[DOM](maintenance-panels.json)；[镜头截图](screenshots/shot-visual-selected-1440-light.png)、[DOM](shot-panels.json) | maintenance → 历史资料；drawer，stage=storyboard_approved → 第一个镜头 → 画面与构图 |
| #2 | [覆盖截图](screenshots/series-worst-overlap-1440-light.png)、[精确尺寸](series-overlap.json) | accounts + worst → 系列；1440px |
| #3 | [键盘截图](screenshots/chrome-pending-editable.png)、[Chrome AX](chrome-pending-keyboard.txt) | new-account + mode=pending；Tab 到变灰的账号名称后输入。仅使用合成名称，未提交 |
| #4–5 | [深色蓝图](screenshots/app-worst-1280-dark.png)、[密钥选中态](screenshots/secret-selected-1440-dark.png)、[浅色阶段](screenshots/episodes-worst-1280-light.png)、[对比度候选](contrast-candidates.json) | app/accounts、secrets选中首项、episodes；对应主题 |
| #6 | [收起侧栏](screenshots/collapsed-sidebar-1440-dark.png)、[DOM](collapsed-sidebar.json) | app → 收起侧栏；下方剪辑入口变为空白 |
| #7 | [产物预览](screenshots/artifact-preview-1440-dark.png)、[DOM](artifact-dark.json) | historical + dark，选择视频产物 |
| #8 | [运营截图](screenshots/operations-settled-1440-light.png)、[DOM](operations-settled.json) | operations + worst，1440px，查看阻塞列表 |
| #9 | [生产单列表](screenshots/episodes-worst-1440-light.png)、[头像尺寸](avatars.json) | episodes + worst，比较长名称与 Jo 的图标 |
| #10 | [1280px账号](screenshots/accounts-worst-1280-light.png) | accounts + worst，查看当前账号和分镜规划摘要 |
| #11 | [底部菜单](screenshots/shot-2-collapsed-menu-1440-light.png) | drawer 第2镜头收起状态 → 另4项，1000px高窗口 |
| #12 | [2560px账号](screenshots/app-worst-2560-light.png) | app + worst，2560px |
| #13–14 | [密钥列表](screenshots/secrets-worst-settled-1440-light.png)、[系列规模](series-huge.json) | secrets + worst；accounts + huge → 系列 |
| #15–16 | 源码边界、[字段索引](rendered-values.json) | 新建生产单标题、Prompt新建版本、密钥详情验证输入；不调用真实写入 |

对比度由页面 computed CSS 计算，OKLCH 转为线性 sRGB，透明色先在 sRGB 合成，再计算相对亮度；忽略图片／渐变背景的候选。数字取两位小数，属于正常静止状态，未把禁用文字按普通文字报错。#4、#5、#7适用 WCAG 1.4.3 普通文字4.5:1；其余项不直接宣称违反某条 WCAG。原生鼠标／键盘和截图观察与源码推断已在表中区分。

## Decisions for you：需要明确的设计取舍

1. **系列名换行，次要用途摘要截断。** 推荐识别性名称最多先展示两行并提供完整名称，规则编辑页标题可完整换行；密钥用途在列表中限制1–2行，全文保留在详情。不能全局给所有文字套 ellipsis。
2. **系列先搜索＋分页。** 当前生产单已有20条分页，可复用操作习惯；先改善找得到，再用性能证据决定虚拟列表。
3. **超宽屏限制正文宽度。** 保持导航和检查栏结构，限制长文本表单的阅读宽度；数据表继续利用宽屏，不将全页面塞入统一窄卡片。
4. **保存中真实锁定输入。** 外观与行为一致；失败后恢复编辑并保留草稿，成功后再关闭。不要通过隐藏输入回避。

这些是建议，尚未执行，也未据此增加产品约束。

## 共性原因与建议顺序

问题主要集中在**旧 CSS 与新组件 DOM 边界**、**前景和背景 token 配对**、**只验证页面总宽度而未验证内部尺寸**。原有迁移检查中「没有整页横向溢出」不足以证明布局正确：#2在根宽度完全正常时仍跨栏覆盖，#1的 inert 内容也不会出现在普通可访问角色查询中。

建议按下列顺序处理，每批完成后在同一夹具中复验 Demo / Worst / Empty / One / Huge，并核查真实容器；这是后续建议，不是本轮已完成的修复：

1. **P1 `$impeccable harden`**：共用页签隐藏、InputBase禁用、收起侧栏入口与主题对比度（#1、3–7）。
2. **P1–P2 `$impeccable layout`**：系列跨栏、运营局部横滚、头像收缩、关键标识宽度（#2、8–10）。
3. **P2 `$impeccable harden`**：菜单碰撞与标题长度边界（#11、15）。
4. **P2 `$impeccable typeset` / `$impeccable distill`**：超宽屏正文与密钥列表摘要（#12–13）。
5. **P2 `$impeccable optimize`**：系列规模与构建拆分，先补真实性能测量（#14）。
6. **`$impeccable audit`**：复查上述实测尺寸、主题、状态和原生键盘路径。
7. **`$impeccable polish`**：最后处理标签播报、对齐与节奏，避免润色掩盖结构问题。

可以逐项、一次全部或自行安排顺序执行；修复后重新运行 `$impeccable audit` 核对结果。

## What held up：已确认保持有效的部分

- **PC整体框架多数稳定。** 已记录PC宽度案例未发现 document 整体横向越界；这不覆盖#2、#8的局部缺陷。
- 长中文、带重音人名、Vietnamese、emoji组合、J/Jo、缺失标题均能显示；空标题有「未命名生产单」回退。用户输入字面标记按文本显示，没有执行为 HTML。
- **分页20／21边界正确。** 20条不显示翻页栏；21条首屏20条、下一页1条，页码为1/2→2/2，见 [分页结果](pagination-boundaries.json)。没有为了压力测试把本来有分页的生产单表一次塞入1284行。
- **原生Chrome 200%缩放的新建账号表单可读可操作。** 见 [AX](chrome-zoom200.txt) 和 [200%截图](screenshots/chrome-new-account-zoom200.png)。root字号32px另做了混合px/rem压力检查，两者没有混为同一测试。
- 合成提交失败时，错误提示位于弹窗之上且草稿保留，见 [失败截图](screenshots/create-account-rejected-1440-light.png)。没有复现“toast被弹窗遮住”，不列为问题。
- 编辑配置后的未保存离开保护有效；取消编辑后可正常导航。镜头卡片打开菜单时通过 :has(open) 允许溢出，未出现“被卡片自身裁切”；#11只记录视口边界问题。
- 密钥核查具备列表、详情、禁止查看与空态；本次没有读取任何真实明文、输入登录密码或改密码。

## 覆盖、验证与限制

- **范围**：27个当前可达产品TSX文件的值索引；18个夹具入口覆盖系列运营、生产单、账号蓝图／系列、连接、历史、密钥、登录安全、创建／确认、状态、实际生产抽屉、分镜／声音／画面、AI生成、交付与完成。16个生产阶段均有浅深色首屏记录；部分阶段内的媒体／QC／弹层另行交互核查，不声称所有组合都完成端到端操作。
- **PC尺寸**：1280×900、1440×1000、1920×1080、2560×1440。以 measurements.json 的实际 width/height 为准。另有320×844早期补充记录，仅作附录；移动布局与触摸手势不在本次结论中。
- **数据／状态**：Demo、Worst、Empty、One、1284总数、20／21边界；正常、加载、503、pending、禁止查看、可完成、预渲染审核成员。状态覆盖按组件实际生效，不把静态props组件在loading参数下的画面称为异步加载验收。
- **证据质量**：初版探针误用了接口未提供的 childElementCount，早期clipped/colorSamples为空，不作为通过证据；已改为children.length，后续PC尺寸和逐项复现重新取证。密钥初次采集早于加载完成，已补 settled 测量。少量试图改成1280×720的记录仍实际1440×1000，已改名为actual1440并标记，不宣称检查过低高度PC。
- **机械／编译验证**：detector一次，0命中；夹具TypeScript检查通过；产品Vite构建通过，输出在独立临时目录，不覆盖日常运行产物。主JS955.17kB/gzip287.24kB、CSS471.89kB/gzip69.63kB，仍有>500kB chunk提示；这是资源观察，未据此断言页面卡顿。
- **未执行**：第三方OpenChatCut内部、真实Provider网络生成、真实保存／删除／归档、真实密钥取回、物理设备、触摸、全应用读屏流程、所有键盘路径、长时性能分析。产品是中文LTR，没有新增RTL产品要求。
- **变更边界**：仅新增本目录的夹具、测量与报告，更新根PLAN。未修产品源码；起点哈希复核见 [results.json](results.json)。日常5174服务保留。

完整证据目录见 [SCREENSHOTS.md](SCREENSHOTS.md)，字段边界见 [FIELD-MAP.md](FIELD-MAP.md)，原始尺寸见 [measurements.json](measurements.json)。截图数量和自动测量次数不等于逐状态人工通过数量。

## 可切换的 Break UI 演示

[打开本地演示](http://127.0.0.1:5189/docs/verification/visual-audit-20261028/fixture.html?scene=accounts&data=worst&theme=light)。底部保留 Demo data / Worst case / Empty / One / 1,000+ rows / 20 rows / 21 rows，页面、主题、状态、文字缩放均持久化到URL。将scene选为app可看真实应用壳，accounts可查看蓝图与系列；该入口未接入产品导航或产品构建。

服务只监听127.0.0.1:5189；浏览器业务fetch由夹具拦截，写操作返回409，唯一放行资源为本服务的合成媒体。当前预览进程15672，启动源为本轮临时Vite配置；可重复启动的仓库脚本为 `node docs/verification/visual-audit-20261028/preview.mjs`。当前预览停止命令：`kill 15672`，只针对5189本轮预览，**不要停止5174日常服务**。进程号可能过期，执行停止前先用lsof核对。

回复 `fix all` 或 `fix 1, 3`，可按上表编号实施并用同一组数据复验。
