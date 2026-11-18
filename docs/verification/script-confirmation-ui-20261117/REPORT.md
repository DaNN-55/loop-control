# 正式脚本确认页 UI 验收

2026-11-17。基于已批准的三栏 demo，仅迁移正式脚本确认区域。正文 13px／1.9 行高；中栏分镜及折叠控件；右栏上传槽、纵向参数、搜索模型、拍法操作和下一步。保留双示例、历史、修订备注、还原、只读和全部错误／恢复路径。

## 边界与差异审查

- `WorkspaceScriptPanel.tsx` 的 `setField`、`validate`、`startSaved`、`confirm`、`resume`、`readScriptFile` 处理函数逐字与任务开始的 HEAD 一致，摘要见 [scope-check.json](scope-check.json)。API、请求回执、原文与拍法合同、草稿、审批、数据库与其他页面未修改。
- `ScriptStudioProposal` 负责中栏展示；仅在本页使用的 `ScriptStudioTools` 复用现有 Button／Tooltip／WorkspacePopover／ConfirmationModal，承接右栏原操作。没有新增依赖或套用 demo 的模拟分镜逻辑。
- 拍法按需出现；加载时保留原文编辑能力，仍由原 hook 丢弃过期结果。原文表单有待采用方案时不会通过隐式 Enter 提交原方案，两个继续入口保持显式点击。
- 大胆改编增加二次确认；取消不派发，确认仍调用原 `send('adapt','',undefined)`，结果仍需一次采用。新请求完成后保留已填写的修改要求，失效／切换原文时按原行为重置。
- CSS 均限定于 `.script-studio`／`.script-studio-popover` 及专属动画名。局部覆盖共享重要样式，未修改全局设计组件或其他步骤。

## 验证

- 新增 UI 回归先失败后实现；脚本三组定向 **57 项通过**。覆盖双示例位置与原时长语义、按需加载与中栏折叠、改编取消、已有方案不隐式提交，并保留原文直接制作、一次采用、编辑失效、迟到响应、Owner／版本草稿、导入保护、只读及保存／启动失败恢复。
- 修改要求保留新增断言使用不同请求 ID，先复现新结果导致输入被重置的问题，再使用稳定的 UI 实例身份修复；原请求参数未改。
- `npm run check`、`npm run build` 通过；构建仍有主包超过 500kB 的现有提示，没有修改打包策略。
- 前端构建会清空 `dist`，后续全量复跑曾出现缺少 `dist/local-app` 模块，导致两个运行时测试文件失败；补 `npm run backend:build` 后先复跑失败项，再执行全量。未修改测试或运行时源码。
- 最终全量 **328 文件／2,398 项通过**，见 [full-test.log](full-test.log)；13 项运行时复查、定向、类型、构建日志在同目录。
- 日常正式页 `127.0.0.1:5174` 只读观察已显示新布局及原有正文，前端热更新生效；未在真实生产单中编辑、上传、优化、采用或启动。
- 浏览器写操作在独立端口的合成 HTTP 夹具内完成：使用实际正式组件、草稿 hook、助手 hook 和 client，所有 HTTP 由夹具接收，未连接日常数据库或 Provider。请求证据见 [browser-requests.json](browser-requests.json)。它验证 UI 和 HTTP 参数衔接，不代表本轮重新验证真实供应商或真实数据库。测试浏览器与临时服务已关闭，临时夹具和上传文件已清理；日常服务与独立 demo 保留。
- Chromium 实际验证：模型搜索筛选／选择；加载；全部展开／中栏收起恢复；修改携带上一请求；改编取消零请求与确认后发送；采用恰好一次确认＋一次启动；两类示例不提交、完整模板保留当前时长；上传槽导入、刷新恢复、还原取消与确认；只读无编辑入口。1506／900／390px 无横向溢出，未捕获页面异常。

## 截图

[默认页](default.png) · [三栏及改编变化](desktop.png) · [模型搜索](model-picker.png) · [加载](loading.png) · [改编确认](adapt-confirmation.png) · [双示例](examples.png) · [390px](mobile.png)。均为合成数据，不是生产单内容。

未运行 Safari／Firefox 或真实付费调用；未重新执行数据库迁移／Worker／Studio 写操作。本次不改变相关实现。

后续清理（同日）：用户批准移除已不用的独立 demo。原型目录与其 5189 服务、专用测试浏览器及临时日志已清理；本目录为正式页验收证据，继续保留。恢复原型见 `docs/prototypes/README.md`，正式页实现不受影响。
