# 轻阴影、表面层次与控件质感迁移

日期：2026-11-10。用户只批准迁移这三类视觉变化，其他界面与功能保持。

## 产品差异

仅两个产品文件：

- `src/ui/impeccable/surface-polish.css`：新增独立覆盖层。明暗主题的轻阴影、浅色表面与边界、账号规则侧栏与分镜详情底色、按钮与选择控件的接触阴影、生成输入区与参数控件、菜单与弹窗的深度。
- `src/local-app/main.tsx`：在已有样式导入之后增加一条 CSS 导入。与修改前的文件逐字比较，除此之外无差异。

没有迁移 Demo 的页面、数据、导航、表单处理、评审条、固定滚动区域或响应式布局。没有修改字号、间距、宽高、定位、布局、组件结构或业务处理函数。没有提交、推送、准备或重启后端运行包。

可直接查看 [产品差异](migration.patch)。入口备份位于 `.scratch/surface-polish-migration-20261110/backups/main.tsx`，初始 SHA 见 [基线](baseline.json)。

## 验证

- `npm run build` 通过，包含 TypeScript 和 Vite 生产构建。存在构建工具的大分块提醒，未修改分包策略或依赖。见 [构建日志](build.log)。
- CSS 通过 PostCSS 属性范围检查：50 条声明，非自定义属性只包含 `background-color`、`border-color`、`border-radius`、`box-shadow`，没有布局或交互属性。见 [属性范围](property-scope.json)。
- 正式 Button、InputBase、NativeSelect、WorkspacePromptField、WorkspaceGenerationModel、ConfirmationModal 与实际样式组成只读核对页，不连接后端。
- 1440、1024、640、390 像素，分别检查浅色与深色，共 8 组。每组比较 28 个可见控件、标签及容器；样式开关前后的坐标、宽高、文字、值与禁用属性完全一致，没有页面横向溢出。见 [几何对照](geometry-comparison.json)。
- 实际打开两个正式下拉框、选择模型二并观察选值更新；打开与确认正式弹窗，确认回调执行并关闭；提示词超限时原红色边界与禁用状态保留，清空正文后生成按钮禁用。操作只影响核对页内存。
- 浅色和深色控件截图已人工查看。正式控件与弹窗的 axe-core 检查无自动违规；只读输入外层在部分扫描中需要人工判断对比度，未将此当作自动完全通过。正文、提示和焦点继续沿用项目语义颜色。
- 浏览器运行错误列表为空。核对页请求中 `/api/` 数量为 0，没有触发生成、真实连接测试或业务写入。
- 日常 5174 的入口与新增 CSS 均返回 HTTP 200，入口包含新增导入；实际打开日常登录页，确认 Vite 已加载 `surface-polish.css`，浅色背景计算值为 `#f1f3f7`。见 [加载结果](live-loading.json) 与 `daily-login-loaded.png`。

登录后的业务页面没有使用真实 Owner 会话操作；本次验证限于正式控件、实际样式和日常入口加载，不宣称执行过完整生产流程。

## 核对环境说明

`fixture.html`、`fixture.tsx` 和 `vite.config.mjs` 为验证资产，不进入产品入口。专用 Vite 配置只扫描此核对页，避免旧原型中已退役导出影响依赖扫描，不加载本地后端或 `.env`。使用 `npx vite --config docs/verification/surface-polish-migration-20261110/vite.config.mjs` 可重现。

自动化中直接填空曾造成 DOM 值与 React 受控状态不同步；未修改产品处理逻辑。改为显式选择正文后通过真实 Backspace 键删除，已验证生成禁用。选择控件以最新可访问性快照定位，避免将底层原生选项误当作弹层选项。

现有 `DESIGN.md` 与 sidecar 的时间差由设计钩子提示；本任务没有刷新或修复无关设计文档。

## 截图

- `before-light-1440.png` / `after-light-1440.png`：浅色前后对照。
- `before-dark-1440.png` / `after-dark-1440.png`：深色前后对照。
- `before-light-390.png` / `after-light-390.png`、对应深色截图：窄窗对照。
- `select-light-1440.png`、`dialog-light-1440.png`：正式弹层。

迁移结论：已按限定范围落入主项目前端，正常刷新即可加载；业务数据和后端运行环境未因本次迁移改变。
