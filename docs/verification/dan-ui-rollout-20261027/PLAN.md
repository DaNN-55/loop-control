# Dan UI 全量迁移计划

范围：当前 local 入口的全部自有界面，以及被其复用的共享界面。保留业务处理、权限、数据请求、持久化和安全边界；浅紫浅色与现有深色，PC 优先。所有改动未提交，不切分支、不启动调度器、不写真实业务数据。

## 基线与成功条件

- 起点与文件 SHA：`baseline.json`；全部既有改动：`baseline-status.txt`；可恢复源码副本见 JSON 的 `sourceBackup`。
- `src/local-app/main.tsx` → `LocalCatalogApp` 是日常入口；`src/main.tsx` 的 local 分支同样进入它。legacy `App` 自有路由不迁移，共享组件仍在范围内。
- 每个入口、深层组件和状态均记录到下表；完成实际迁移、相关回归、类型检查、正式构建及浅/深色视觉核对。真实写操作只在隔离组件测试中执行。
- 真实登录不可用时，用真实组件的合成隔离夹具验证，并明确区分真实页面与夹具证据。

## 批次与覆盖矩阵

| 批次 | 页面入口 / 源码 | 共享组件与深层状态 | 验证 | 进度 |
| --- | --- | --- | --- | --- |
| A 基础 | `src/ui/dan-ui`、`styles.css`、`ui/*` | 官方 Button/Input/NativeSelect/TextArea/Checkbox/Tooltip；确认窗、分页、Markdown；现代 chevron、portal 主题、focus/reduced-motion | 官方来源核对、共享回归、构建 | 已完成，见 README 验收证据 |
| B 应用壳 | `LocalCatalogApp`、`WorkspaceViews`、`LocalSystemStatus`、`SystemStatusSurface` | 登录/失效/错误、主导航/收起/深色/移动入口、Owner 菜单、登录与安全、状态弹层、OpenChatCut 独立打开/禁用/失败 | 应用回归、只读真实入口、隔离登录和状态 | 已完成，见 README 验收证据 |
| C 账号 | `AccountForm`、`AccountWorkspace`、`ConfigurationForms`、`WorkerBlockerCard` | 新建/重命名/归档/恢复/永久删除；蓝图分节、Prompt/连接嵌套编辑、未保存退出、配置修复、就绪轨；系列新建/版本/历史 | 账号/表单/配置回归；合成危险操作、长文本 | 已完成，见 README 验收证据 |
| D 列表与运营 | `WorkspaceViews.EpisodeWorkspace`、`OperationsWorkspace` | 账号/系列/归档筛选、分页/空/加载、生产单操作菜单、重命名/归档/永久删除范围读取及失败重试、运营展开和配置修复入口 | 列表/运营回归；真实只读浏览、键盘 | 已完成，见 README 验收证据 |
| E 创建与生产 | `EpisodeForm`、`LocalEpisodeDetail`、`EpisodeProduction`、`WanShotGenerator`、`TaskProgressPanel` | 创建步骤/预检；waiting_input→完成全部阶段；导入/模板/媒体预览；脚本/视觉/分镜审核；逐镜头、字幕/对齐/声音/BGM/TTS/生成；预渲染成员审核/QC；任务证据、历史产物、只读历史生产单；studio 打开/替换冲突 | 生产/审核/媒体相关回归；各阶段合成夹具、只读真实详情 | 已完成，见 README 验收证据 |
| F 交付与管理 | `LocalDeliveryPanel`、`ProductionCompletionModal`、`LocalMaintenancePanel`、`LocalSecretAdministration` | 发布包/完成/归档/删除及清理重试；维护 tabs；密钥元数据/权限/查看确认/剪贴板/错误；连接与历史已认可页面对齐紧凑布局、tooltip、折叠 | 管理/交付/连接/历史回归；只读与隔离状态 | 已完成，见 README 验收证据 |
| G 收尾 | 全部当前入口 | 模板 ready 对齐、残留旧控件扫描、浅/深色、长内容/空错加载禁用、键盘、布局溢出；只读独立完整性审查 | 完整类型检查、正式构建、相关/全量非集成测试、截图清单 | 已完成，见 README 验收证据 |

状态维度：默认/hover/focus、selected/expanded、pending/disabled、empty/loading/error/retry、long-content、light/dark。每批在结果文件记录测试与截图，禁止把代码覆盖推定为浏览器通过。

## 排除与 N/A

- legacy `App` 的独有认证/云端页面、已退役云端 API / n8n 页面：非当前 local 入口，不迁移。
- 独立「审核」导航：`navigation` 只有 operations/episodes/accounts；审核嵌在生产单详情，按 E 验证，不新建页面。
- 自助注册/忘记密码：local 登录仅邮箱密码，无这些入口，不新建。
- OpenChatCut 第三方编辑器内部及仓库外源码：排除；本项目的入口/工作区冲突/打开反馈在 B/E。

## 顺序与审核

1. 保存基线，独立只读 Agent 对照真实 import/入口审查矩阵；吸收遗漏后开始 UI 编辑。
2. A→B→C→D→E→F 分批执行；复用官方源码，单一控件外观。合成夹具不发真实请求、不进入生产入口。
3. 读取 `/private/tmp/dan-ui-rollout-20261027-tmf0ch06/template-ready.json`；若未就绪先推进，最后对齐一次。
4. G 独立只读核对与修正，生成结果/截图索引，右侧打开真实应用。

## 记录

- 已保存初始 UI 源码与全部 Git 状态。5174 有已有监听进程；沙盒 curl 无法连接，后续通过获准的浏览器/本机接口检查，不重启或加开日常消费者。
- Impeccable 缺 PRODUCT.md；用户已固定视觉和实施范围，本次以已认可页面及 Dan UI 模板作为权威，不执行风格访谈或修改全局 Skill。

## 独立计划审查（已吸收）

只读 Agent 沿实际 local 入口核对后补入：共享 ExternalConnectionPicker/ConnectionTestButton；维护 tabs 的 historyVisited 懒挂载与方向键/Home/End；密钥密码验证、30 秒/visibility/pagehide/session-expired 清敏与剪贴板失败；生产工作台预算、文件导入、预览、逐镜头设置/结构修订/手工对齐/字幕/BGM/TTS/QC/渲染重试；交付自定义事件与封面/发布校验；状态 hover/unknown/offline/attention/refresh。

明确 N/A：EpisodeProductionContainer、SystemStatusPanel、ReviewWorkspace 仅 legacy 调用；其依赖的 EpisodeProductionView、ArtifactPreview、EpisodeDetailDrawer 和 SystemStatusSurface 仍全部迁移。生产子域在阶段夹具及回归中逐项列出，不能只用首页截图替代。

### 执行进展

- A–F 已将当前界面的按钮、文本输入、选择、文本区、勾选/开关切换至官方组件；菜单与 tabs 使用官方 collection 与焦点交互。file/range 等专用原生控件保留原生行为并按主题呈现。
- 接口适配已验证：选择器支持既有 option/optgroup 子项；拖放事件保留在原生 draggable 包裹层，内部继续官方按钮；字段 tooltip 采用可聚焦 span，避免 label 内增加第二个可标记控件。
- 同一路径两轮失败后调整：菜单外部点击逻辑移除，交给官方 Popover；弹窗初始焦点与菜单关闭交互冲突，改为记录实际触发元素并交由 Aria 及同步 focus hook 管理；嵌套弹窗只由当前活动弹窗处理 Escape/Tab，无延迟焦点补丁。旧 title/busy 断言迁移为 tooltip/pending 对应 API，不删除行为断言。
- 基线全量：143 文件，124 通过，19 失败；55 失败、988 通过、28 跳过，主要为沙盒 listen EPERM。完整类型基线通过。最终 HTTP 回归将在允许本机监听下复核。

### 完成记录（2026-10-28）

- Dan UI 0.5.0 ready 记录已对齐，官方来源与本地补丁分别记录；无新依赖或全局 Skill 修改。
- 只读独立审查三轮完成，最终无功能阻断项。QC resolve/ignore 按钮原本已位于创建 form 外：早期重复提交疑点经源码复核排除；新增 type=button 和回归保护，不能称为已复现的旧缺陷。
- 浅/深色全部 16 个生产阶段、核心页面与深层弹层已截图；900/390px 共 12 个组合无页面横向溢出。真实 Chrome 只读核对账号、生产单及当前 QC 详情。
- 最终检查、资源大小、完整测试基线故障与范围限制见 README。全部保持未提交，不推送、不部署、不重启既有日常服务。

- 末轮实际浏览补齐：抽屉关闭按钮 absolute、运营待审行左对齐、字幕 Tooltip 外层 key、账号 tabs 的面板 key/ARIA 关联、镜头菜单提示按展开挂载及键盘 keyup 激活。109 项和 16 项聚焦回归通过；临时 5188 服务关闭，真实 5174 PID 不变。
