# 全页面一致性整理验收 · 2026-10-28

已完成原生应用13类页面的独立只读审查、主 Agent 汇总实施，以及后续图标、侧栏、阶段分布、下拉菜单与标题移除要求。保持未提交，保留本轮开始前的全部改动。

## 交付内容

- 重复入口：待审核仅保留刷新和审核动作；移除工作台重复的首条审核快捷入口，保留审核队列及独立分页。侧栏分组与底部工具沿用已认可结构。
- 对齐与文案：统一顶部操作间距、长名称操作对齐、镜头工作台标题、系列版本说明和交付中文命名；删除无关安全说明及重复帮助，保留错误、冻结规则、删除范围和确认。
- 生产详情：每期只有一个视频生成预算入口，每镜头仍独立生成。命令参数保留；补齐预算草稿、保存等待和切换生产单时异步响应隔离。
- 图标根因：legacy `.icon` 的21px flex-basis与按钮文字包装padding共同导致偏移。动作图标固定18×18，纯图标按钮默认36×36，侧栏/制作工具/行操作32×32，移除文字包装额外padding。
- 底部四工具默认无边框，保留轻悬停、激活与键盘焦点；OpenChatCut分隔线移至其下方。系统状态只保留一个主题化摘要浮层，移除重复黑色Tooltip。
- 工作台阶段分布：名称与数量对齐，下方细轨迹显示真实生产单数量占比，无虚构完成进度。
- 所有当前原生选择下拉采用内嵌图标、12px浮层圆角、8px选项圆角。保留真实select作为表单值与change事件边界；支持分组、禁用、受控/非受控值、reset、required/name、多选及键盘操作。声音建议使用可自由填写的ComboBox。
- 最新要求：移除下拉前方/上方可见标题和空标题列；关联label/aria-label继续可访问。必要帮助移入框内右侧，错误和说明保留。普通文本/数字输入标签保留。

逐页发现与取舍见 [AUDIT.md](AUDIT.md)，本轮相对起点的差异见 [implementation.diff](implementation.diff)、[changes.json](changes.json)。采用控件的本地适配另记录在 `src/ui/dan-ui/LOCAL-PATCHES.md`，未增加依赖。

## 验证

| 检查 | 结果与证据 |
|---|---|
| TypeScript | `npm run check`通过，`check.log` |
| UI回归 | 33文件313项通过，`ui-tests.log`、`final-ui-targets.json`；覆盖导航、审批、材料、剪辑宿主、配置、历史、安全、预算异步、新选择器与声音自由输入 |
| 隔离夹具类型 | `tsconfig.fixture.json`类型检查通过，`fixture-check.log` |
| Vite构建 | 通过，`build.log`；输出到独立临时目录，未覆盖运行时dist。仍有原有大chunk告警，未调高阈值。最终入口JS gzip306.05kB/CSS81.55kB |
| 请求源码契约 | 7个本轮变更文件的29个直接localRequest/localCommand调用参数与起点完全一致，`request-contracts.json`；此项不等同真实写入验收 |
| 真实应用 | 5174只读浏览工作台、生产单、待审核、账号与系列、连接配置、历史资料，`real-page-checks.json`及`real-*.png`。历史实际加载7条；未修改记录 |
| 图标几何 | `icon-baseline-home.json`记录原偏移；`icon-after-home.json`记录修复。六个真实主页面及新建/安全/密钥/交付/制作等夹具测量，无采样中的纯图标水平偏移或图标垂直偏移，见`icon-audit-details.json`、`icon-span-controls.json` |
| 下拉最终检查 | 真实Owner菜单外层12px、项8px；真实系列下拉选项8px。新建表单无外部下拉标题，帮助图标内嵌。声音自定义`custom-voice-demo`可输入，Escape只收列表，父弹窗保留。见`final-controls.json`、`new-episode-titleless.png`、`voice-custom-titleless.png` |
| 阶段与主题 | 16个生产阶段浅/深色夹具均显示详情、无Vite错误遮罩，`stage-results.json`；新增账号/生产单、登录浅深色、交付及密钥弹窗见`dialog-results.json`。这些使用模拟状态，不写真实API |
| 源码空白 | `git diff --check`通过 |

测试日志包含现有React act提示，不影响313项断言通过。未运行整个后端测试集合；本次未改后端、认证、Provider或数据库。

## 边界与交付

- 实际入口是`src/local-app/LocalCatalogApp.tsx`，退役`src/App.tsx`未作为本轮业务迁移目标。
- OpenChatCut独立编辑器位于忽略目录`.loop-control/local/OpenChatCut`，本轮只整理本仓宿主标题/间距/路径，未替换其编辑引擎、工程或媒体。
- 真实页面仅导航、展开和关闭控件；保存/审批/生成/删除等行为通过隔离夹具和测试验证，未修改真实数据、密码、凭据或授权。
- 手工Impeccable detector曾在早期整理后运行，`detector.json`无发现；该记录早于新增下拉控件，不作为最终控件验收依据。自动hook未启用。
- 右侧保留真实应用工作台；最终画面`real-final.png`，展开下拉的画面`real-final-dropdown.png`。仅关闭本轮QA标签及停止本轮5191夹具服务，不停止真实5174服务。
- 未提交、推送或部署；既有未提交工作保留。
