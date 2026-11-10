# 四步工作区操作转换验证

日期：2026-11-10。基线 HEAD：`951a368e`。用户批准第 5 项：只集中 `prepare / open / save / close` 转换，保留导航、只读和工程有效性维度，验证深链接、刷新、浏览器返回、保存返回及失败恢复；保留原业务规则和恢复限制，不提交、不推送。

## 实现

新增 `useWorkspaceOperations`，集中 `ready / preparing / opening / editing / saving / closing`、每次进入生产单的 owner、同步互斥及会话归属。主入口保留步骤、加载、草稿、只读、工程有效性、镜头选择及命令错误展示，消费四个明确操作。准备保留首次／replan 参数、旧工程 preserve／fresh 决策、兼容响应和显式重试；打开保留占位及缺失来源拦截；保存／关闭失败恢复同一会话，不重建编辑器。

浏览器返回只把 opening 的目标从 editor 改为 stay，保持在途锁直到返回。成功回包仍经过当前 owner、来源与 revision 校验，接收完整工程读回，但不创建新会话或改变步骤。因此后端打开时产生的新 revision 可供下一次显式打开使用。取消后失败抑制旧错误，触发原加载流程读回，不重发打开命令。卸载或切换生产单后的回包不能发布结果。

保存仍由真实 `EmbeddedStudioHost` 先请求 iframe flush，然后携带来源文件、projectId、预期 revision 和文件 SHA 调用原命令。关闭使用保存后的当前 revision，成功后才离开会话并恢复所选镜头。Host 消息协议、SDK 写所有权、原生文件验证、服务端事务、Owner／CSRF、历史材料与恢复限制均未修改。无新增依赖、SQL、服务端协议、通用状态机或持久化恢复存储。设计依据见 [ADR-0037](../../adr/0037-workspace-operation-transitions.md)。

## 验证结果

| 检查 | 结果及证据 |
| --- | --- |
| 新增公开组件回归 | 10/10，通过真实主入口、导航上下文与宿主消息链验证；见 `recovery-green.log` |
| 定向回归 | 最终 8 文件，122 通过、1 失败；见 `targeted-final.log`。前期同组 120 条通过记录见 `targeted.log`，不重复累计 |
| 类型 | 最终 `npm run check` 通过，见 `check-final.log` |
| 构建 | 前端、后端顺序构建通过，见 `build.log`、`backend-build.log`；Vite 既有体积提示保留 |
| 完整测试一次 | `npm test -- --maxWorkers=4 --reporter=dot`：255 文件中 254 通过、1 失败；1904 条通过、1 跳过、1 失败。见 `full-tests.log` |
| 失败隔离 | 当前其他源码不变的隔离副本，换回本批改动前 `ProductionWorkspacePanel.tsx`，仅跑同一 MP3 用例，仍出现相同失败；见 `baseline-mp3.log` |
| 浏览器 | 7 条受控操作路径通过；真实主入口、Host、客户端与 loopback HTTP／iframe 协议。见 `verify-browser.py`、原始 JSON、`open-return-manual.json` 和 `browser-check-rest.log` |
| 布局 | 1280×900、390×844，关闭失败后原 iframe、文本与保存入口保留；宽屏宿主高度、窄屏无横向溢出通过，见截图、`layout-final.log` |
| 差异与保护 | `git diff --check` 和 `git apply --reverse --check batch.diff` 通过；见 `protected-files.json`、`protection-result.json` |

新增回归覆盖迟到打开成功／失败、浏览器步骤保留、重复外部打开、保存失败保持原 iframe、保存后关闭使用最新 revision、关闭失败保持已保存文件身份、返回镜头选择、深链接刷新、只读变化、取消后 revision 更新、取消后仅权威读回，以及准备失败后的显式重试。测试没有 mock 操作模块或真实宿主。

浏览器路径为：准备失败后显式重试；打开失败后重试并保存返回；保存失败保留同一 iframe／正文后继续；关闭失败保留已保存文件身份后继续；flush 失败不调用宿主保存；浏览器返回后接收迟到 revision 且下一次显式打开使用新 revision；编辑深链接刷新不自动创建会话，明确打开后可保存返回。

## 唯一测试失败

`ProductionWorkspacePanel.test.tsx` 中 `accepts one unassigned MP3 for voice and queues local audio candidates without adopting them` 仍查找 `combobox`「口播来源」。当前并行模型选择界面通过 `WorkspaceModelPicker` 展示同名按钮和菜单，旧断言找不到下拉框。最终定向和全量均因此失败。隔离副本换回本批改动前主入口后，相同断言仍失败，证明它不依赖本批操作模块。

该控件及旧用例不属于本批范围，未修改或放宽断言，不把本轮全量描述为全绿。执行期间观察到独立的模型／口播／生成活动界面修改，均原样保留。

## 审查

### Standards

初审及修复后复核均无可行动规范发现。审查提出旧请求 finally 可能释放新请求 pending 的并发提醒；通过取消后继续保持同一在途锁解决，公开用例验证取消期间重复外部打开不会再发命令。

### Spec

初审发现 1 项：取消打开后若全部丢弃返回工程，会忽略后端打开时产生的新 revision，下一次可能持续版本冲突。已改为只取消导航意图，接收同 owner 的完整工程并保留原守卫；补充 revision 2 → 下一次 expectedRevision 2 及取消后失败仅读回的回归。复核通过，无剩余可行动问题。

## 验证方法与限制

浏览器夹具先前一次性发送 ready 状态可能早于宿主监听器，后改为重复状态直到首次 select 确认；CLI 的 frame CSS 定位及 iframe 编辑后的按钮点击未稳定激活，改用新快照内联 ref 编辑、返回主 frame 并以聚焦／Enter 激活，随后完整验证剩余路径。前期输出保留；准备成功路径不因后续夹具修正而重复计数。截图夹具按正式可用高度补齐 flex 容器；一次 HMR 重载导致 ref 失效，页面稳定后重新截图。上述均为隔离夹具／自动化调整，无相应产品逻辑修改。

iframe 是受控消息适配器，仅保留测试文本与 HTTP 状态，不能代表真实 OpenChatCut 数据库刷盘；没有运行真实 PostgreSQL、原生存储或供应商集成。未操作正式业务、媒体、目录、迁移和付费调用，未重启日常服务，未暂存、提交或推送。

130 个先前变更文件中，126 个字节不变；PLAN、ADR 索引和工作区主入口仅本批限域修改。`WorkspaceVisualPreparation.tsx` 执行期间由外部更新，未还原或纳入本批差异；其他并行新文件保留。本轮 5194 预览、专用浏览器和临时副本／缓存已关闭或清理；日常 5174 保持 HTTP 200。
