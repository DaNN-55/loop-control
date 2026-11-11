# Owner 菜单横向滚动修复

范围：最初 Browser Comment 4，仅修改正式 OwnerMenu 的专属类、身份摘要 title 和菜单局部 CSS；保留日志入口及其他已有未提交改动，不迁移七设置统一窗口、不修改真实偏好、不重启日常服务、不提交。

## 原因与改动

共享分隔线同时使用 `width:100%` 和左右各 4px margin，造成菜单内容额外溢出 8px。生成的 utility CSS 将宽度和 overflow 标为 `!important`，因此在 Owner 专属范围内覆盖分隔线宽度为 auto，Menu 使用可见溢出，Popover 作为唯一的纵向滚动容器。

为 Popover 使用全新的 `owner-settings-menu-popover`，避免旧 `owner-menu-popover` 的 bottom/grid/定位样式影响 React Aria。宽度 280px，约束在视口内；名称与邮箱各单行省略并保留完整 title。短窗口仍可纵向滚动访问退出登录。

## 验证

- `npx vitest run src/local-app/LocalSecretAdministration.test.tsx src/local-app/ImpeccableNavigation.test.tsx --reporter=dot`：2 文件、21 项通过，保留权限与各设置入口行为。
- 真实 OwnerMenu 静态夹具：`node docs/verification/owner-menu-comment-20261111/verify.mjs`，19 组通过；数据见 `browser-results.json`。
- 1440×1000、375×812、320×568 的长名称／长邮箱／短名称：Popover `clientWidth=scrollWidth=278`，Menu `clientWidth=scrollWidth=270`；标准高度无竖向滚动。
- 320×260：Popover 高 190px、内容高 398px，保留必要纵滚；End 定位退出登录并滚入可见区，Enter 回调成功。
- 八个菜单动作均实际触发对应夹具回调；Escape 返回所有者设置按钮，深色无横向溢出，无浏览器运行错误，无业务 API 请求。
- layout detector 无确定性问题，人工查看宽窗和低窗截图。没有对真实账户执行保存或退出。
- `WorkspaceViews.tsx` 依赖树独立严格 TypeScript 检查通过（`--lib es2022,dom,dom.iterable --types vite/client,node`）。首次命令遗漏 DOM iterable／Node 类型，补全编译环境后通过，未修改依赖或其他代码。

## 夹具

运行中的临时入口：<http://127.0.0.1:5173/__owner-menu>。启动 `node docs/verification/owner-menu-comment-20261111/serve.mjs`，仅在当前仓库根目录执行。服务保留给主 Agent 复核；完成后仅清理本轮 fixture 服务／浏览器／缓存，不动日常服务。

首次 Vite 扫描了旧历史夹具，因旧导出 `NavigationButtons` 不存在而跳过预构建；目标入口按需加载正常。已在本轮 `serve.mjs` 显式指定 optimizeDeps.entries，不修改旧夹具。初稿使用旧类引发定位冲突，以及普通 CSS 被 utility 的 important 覆盖，都已由最终专属类和局部覆盖修正；以上尺寸和截图均来自最终版本。

截图：`/Users/dan/.codex/visualizations/2026/11/11/01a1c963-5027-7232-9b62-71eaa4fbfb25/owner-menu-formal-1440.png`、`owner-menu-formal-375.png`、`owner-menu-formal-320.png`、`owner-menu-formal-low-height.png`、`owner-menu-formal-dark.png`。

主 Agent 收尾：已额外核对独立夹具和 5174 真实菜单（270/270、8 动作、完整 title）。5173 临时服务已按 PID 和命令核对后停止，专属 Vite 缓存已清理；本目录的夹具与验证脚本保留，需要时可重新启动。
