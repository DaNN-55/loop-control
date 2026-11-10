# 隐式状态机盘点与确认生命周期验证

日期：2026-11-10。初始 HEAD：`491a123a`。初始工作区干净。

## 结果与决定

从 542 个 Git 跟踪源文件扫描出 240 个含状态候选信号的文件、1474 个信号。扫描范围、排除项与限制见 [census.json](census.json)；React ref、静态选项、配置联合不是状态机证明。结合主 Agent 与两路只读探索，按实际权威归类为 [44 个状态机族](../../architecture/state-machines.md)，记录触发事件、守卫、代码与测试入口。按族归类，不按每个复选框计数。

选择局部显式化客户端逐次调用确认。现有数据库事务、任务租约、供应商提交与文件发布协议已经分别承担权威职责；集中到一个大枚举或引入状态库会增加迁移成本。本次不改变它们。决策见 [ADR-0033](../../adr/0033-workspace-call-confirmation-lifecycle.md)。

- UX：离开当前工作版本立即结束本地等待；旧回包不会关闭、污染或解锁新确认；失败后不能重复确认。
- DX：`idle / preparing / review / submitting / failed / closed` 类型联合取代分散的 proposal、submitting、error、busy 和 pending 状态；同步转换防重复事件。
- AX：状态权威清单、可重复扫描脚本、ADR 与公开 hook 行为测试提供定位入口；无需凭组件名猜测恢复边界。

## 缺陷复现

新增三条延迟回包回归在修改前失败：准备中切换身份不会立即结束原调用（等待超时）；旧确认成功关闭新弹窗；旧确认失败把错误写入新弹窗。后两者在同一 hook 实例身份变化时复现，不代表已观察到真实付费事故；生产页面还通过 episode key 隔离重挂载。独立 owner 同时覆盖工作版本变化、卸载及 A → B → A 再进入。

原确认 hook 的七条用例修改前通过，修复后仍通过。最终确认文件共 15 条用例，覆盖上述竞态、准备／提交期间卸载、StrictMode、同周期确认与取消、事件时到期、React Activity 暂停／恢复，以及原有金额、费用说明、命令参数、取消和失败行为。

## 实际验证

| 检查 | 实际结果 |
| --- | --- |
| `npx vitest run src/local-app/useWorkspaceCallConfirmation.test.tsx --reporter=dot` | 15/15 通过。 |
| `npm run check` | 通过。 |
| `npm run build` | TypeScript 与 Vite 构建通过；保留现有 bundle 大小提示，未做无关拆包。见 [build.log](build.log)。 |
| `npm test -- --reporter=dot` | 首轮 251 文件通过、1 文件失败，1816 通过、7 失败、1 跳过。见 [full-tests.log](full-tests.log)。 |
| 失败原因及重跑 | 主 Agent 将前端构建与全量测试并行，Vite 清空 `dist`，导致依赖 `dist/local-app` 的运行工厂测试缺少模块。读取失败后执行 `npm run backend:build`，再单独运行 `scripts/runtime/application.test.mjs`，7/7 通过。见 [backend-build.log](backend-build.log)、[runtime-recheck.log](runtime-recheck.log)。合计已通过 1823 条，保留 1 条原有跳过；未把首轮描述为全绿。 |
| 独立只读审查 | 核对 owner、phase、StrictMode、晚到回包、重复事件与公共协议，未发现已证实的正确性问题；主 Agent 补充 Activity 恢复验证。 |
| 浏览器 | 独立 Chrome 会话、loopback Vite、真实 hook／ConfirmationModal／正式样式，受控命令，无 API proxy。10 项断言通过，另测 Escape 关闭及触发按钮焦点恢复。 |
| 文档与差异 | 44 族编号、相对源码链接及指定测试文件存在性核对；`git diff --check` 通过。 |

浏览器断言包括：正常打开与取消不提交；A → B → A 的旧准备不弹窗；旧准备不能解锁新调用；新准备仍可用；旧确认成功与失败分别不污染新确认；同周期双确认只发一次；完成后可打开下一次调用；390px 弹窗在 viewport 内。事件与几何读数见 [browser-events.json](browser-events.json)，截图见 [桌面](confirmation-desktop.png)、[窄屏](confirmation-mobile.png)。交互验证使用同一真实组件，但受控命令不能证明真实供应商行为。

## 范围与恢复

产品实现仅改 `src/local-app/useWorkspaceCallConfirmation.tsx`，保留公共 `request/dialog` 接口、确认文案、金额及服务器命令协议。其他变更为同名回归测试、计划、ADR、清单及本目录验证材料。没有数据库迁移、业务数据写入、供应商请求、费用、依赖变更、日常服务重启、Git 提交或推送。

本次未运行 PostgreSQL／Owner HTTP 付费授权集成用例，未进行真实供应商生成，也未重新部署日常运行包。已发出的服务端命令不能由客户端取消撤回；离开后的结果从服务端权威状态恢复，不能自动重复确认。静态盘点不是完整性证明，不能保证今后所有修改都同时改善 UX、DX、AX 或绝无回归。

本目录 `serve.mjs` 和 `browser-fixture.tsx` 可复用核对本地确认边界；预览只监听 `127.0.0.1:5173`，不连接业务库。验证结束关闭本轮 Chrome 会话及预览进程，清理本轮 Vite 缓存，保留日常 5174。
