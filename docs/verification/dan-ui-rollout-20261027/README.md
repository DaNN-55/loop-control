# Dan UI 全量迁移验收

2026-10-28 完成当前 local 应用的 Dan UI 迁移，保持 `main`、起点 HEAD 和全部未提交状态。浅紫浅色为默认，保留深色；日常应用已在右侧打开。原有工作区改动保留，未提交、推送、合并、部署或重启日常服务。

## 覆盖范围

静态 import 图从 `src/local-app/main.tsx` 出发，覆盖 51 个 TSX 文件，包括采用的官方组件。产品源码中剩余的 4 个原生输入均为文件选择；文本输入、按钮、选择、文本区、勾选、切换、单选、菜单和 tabs 均使用采用组件。媒体 range 保留专用交互。详见 [可达源码与原生控件清单](reachable-ui.json)。

| 区域 | 实施内容 | 验证证据 |
| --- | --- | --- |
| 登录与应用壳 | 登录、错误、pending、导航、收起、移动入口、Owner、安全、状态面板、OpenChatCut 启动反馈 | 应用/安全回归；真实账号与运营入口；login/status/security 浅深色夹具 |
| 账号与系列 | 新建、菜单、重命名、归档/恢复/删除确认；蓝图分节、能力、连接、Prompt、未保存退出、配置修复、系列版本历史 | 账号 33 项末轮回归；真实账号；长内容、系列深色、键盘 tooltip 截图 |
| 运营与列表 | 阶段分布、待审/阻塞、筛选、分页、空态、长标题、生产单操作与删除范围确认 | 列表/运营回归；真实运营、列表与详情；合成长内容、空态与窄屏 |
| 创建与生产 | 创建/预检；输入、脚本、视觉、分镜到完成；材料导入、预览、逐镜头声音/字幕/构图/对齐/BGM/TTS、生成、审核成员、QC、任务证据、历史只读 | 全部 16 阶段浅/深色截图；相关审核/字幕/生成/生产回归；镜头构图和声音弹层；真实 QC 只读详情 |
| OpenChatCut 与交付 | 自有打开入口、工程替换冲突与修订、产物预览、发布包和完成确认、归档/删除/清理反馈 | 冲突弹窗焦点/Tab/Escape；完成浅深色及 ready 夹具；交付与预览回归 |
| 维护与密钥 | 官方维护 tabs、连接管理、历史列表/内容/来源、密钥元数据/权限/密码确认/错误 | 已认可连接/历史页面保留；秘密查看仅打开验证窗；授权/清敏/剪贴板边界由现有组件回归验证 |

独立「审核」导航、自助注册及忘记密码不是 local 入口现有功能，不新增。legacy `App` 独有页面与第三方 OpenChatCut 编辑器内部排除；被 local 复用的生产、预览及状态组件仍在范围内。

## 来源与实现

采用免费 MIT Untitled UI 固定 commit `1d410cb8facde8d50869e7bbb5f3d048e2267466`，对齐已就绪的 Dan UI 0.5.0 模板。许可证、原始/当前哈希及适配分别保存在 `src/ui/dan-ui/LICENSE`、`UPSTREAM.json`、`LOCAL-PATCHES.md`。未携带 PRO、演示目录或新增依赖；`package.json`、lock 与本任务起点 SHA 相同。

官方控件 utility 在 `.dan-ui` CSS scope 内生成；项目组合负责布局，html 主题同步保证 portal 深色正确。统一折叠 chevron、紧凑字段、语义色、键盘焦点和 reduced-motion。保留业务请求、权限、校验和持久化边界；[请求调用对照](business-call-diff.json) 中 10 个模块的 35 处调用文本与起点一致。

重点交互修正：使用实际桌面/移动 Owner 触发元素恢复焦点；嵌套弹窗仅由活动弹窗处理 Escape/Tab；pending 创建不退出；账号 tabs 重新挂载对应面板以保证 aria-controls/labelledby；关闭抽屉按钮显式使用 absolute utility；字幕锚点 Tooltip 的 key 放在列表外层。说明提示支持 hover、聚焦与键盘激活，隐藏的镜头菜单展开后再挂载说明触发元素。普通元数据 title 保留原有补充用途。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过，见 [check.log](check.log) |
| 隔离夹具 TypeScript | 通过，见 [fixture-check.log](fixture-check.log) |
| `npm run ui:build` | 通过，见 [ui-build.log](ui-build.log) |
| 正式构建 | 通过，输出到 `/private/tmp/loop-dan-ui-build-20261027`，保留运行时 dist，见 [build.log](build.log) |
| 完整非集成测试 | 142 文件通过、2 文件失败；1068 项通过、9 项失败，见 [final-tests.log](final-tests.log) |
| 最后交互修正 | 账号/审核/守卫 109 项通过，提示/连接 16 项通过，见 [last-ui-tests.log](last-ui-tests.log)、[final-tooltip-tests.log](final-tooltip-tests.log) |
| 视觉与布局 | 71 组布局记录无页面横向溢出；900×1000、390×844 共 12 个响应式组合；89 张截图 |
| 浏览器日志 | 最后夹具与真实页面的 warn/error 均为空，见 [browser-last-logs.json](browser-last-logs.json)、[browser-real-logs.json](browser-real-logs.json) |
| 设计机械扫描 | 扫描 38 个改变目标，8 个厚边线提示已收为 1px；原始命中片段在最终源码均不存在，未重复扫描 |

完整测试的两处失败均存在于 [起点日志](baseline-tests.log)：`scripts/local/application.test.mjs` 缺少 `dist/local-app/local-app/secretAdministration.js`；`src/orchestration/loopOrchestratorCli.test.ts` 的 9 项报 `Invalid tsconfig.worker.json`。未将它们当作通过，也未修改无关后端或放宽断言。起点另外的沙盒监听 EPERM 在获准的本机测试环境中不再出现。末轮小改动使用上述聚焦回归验证，不重复完整测试。

构建主 JS 955.17 kB / gzip 287.24 kB，CSS 471.89 kB / gzip 69.63 kB；大于 500 kB 的 chunk 提示保留，未调高阈值。未启动调度器、Provider 或内容生成，未以 UI 验证代替实际媒体产出验证。

[截图索引](SCREENSHOTS.md) 区分真实页面 `real-` 与合成夹具 `fixture-`。[visual-results.json](visual-results.json) 保存布局结果；阶段截图按 stage 名称命名，深层操作另有截图。对齐后复查发现的抽屉遮挡、运营行对齐、Tooltip key 与 tabs 关联均已修正。

## 审查与安全边界

三轮独立只读审查覆盖计划、实施遗漏和最终残留；末轮无功能阻断项，主 Agent 复核关键路径。早期「QC resolve/ignore 会提交创建 form」疑点被源码复核排除：按钮原本已在 form 外。本次只显式补 `type=button` 并增加保护回归，不能称为复现并修复了旧双提交故障。

真实浏览仅访问页面、详情和主题；没有保存业务表单、创建/归档/删除记录、查看密钥值、修改密码或调用 Provider。隔离夹具拦截所有业务 fetch，拒绝持久化写入。密钥超时清敏、剪贴板失败、导入与发布等写路径通过合成回归覆盖，未在真实数据上提交。

原有 5174 应用仍由 PID 93487 提供，未重启。临时纯前端 5188 服务与标签已结束。基线、源文件恢复副本位置见 [baseline.json](baseline.json)；[results.json](results.json) 为机器可读交付结果，[PLAN.md](PLAN.md) 记录完成状态。
