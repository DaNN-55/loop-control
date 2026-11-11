# 状态与操作反馈修复

日期：2026-11-11。对应最初 Browser Comments 1／2。只修改反馈及目录中的当前阻塞说明，不清除真实阻塞、不重发任务、不修改生产数据、不重启日常服务。保留其他 Agent 的全部改动。

## 结论与改动

「检查与交付」是流程位置，「需处理」是操作状态，可以同时出现。已知咖啡两镜头仍有 `provider_result_unknown` 口播任务；不能因已到交付就把它改成完成。

工作台现在在「需处理」下显示具体原因，例如「口播结果待核对」，右侧显示当前阻塞的实际说明。未知口播结果使用「核对口播结果」，有任务队列入口时打开任务队列；不会再直接称为「处理交付问题」。原有阶段、状态和任务权限没有改变。

目录 `operationRows` 增加可选 `blocker`，从当前生产单的 `task_blockers` 直接生成，优先显示未知供应商结果。它不依赖另一个独立分页的 `blocked.items` 恰好包含当前生产单，搜索和目录第二页同样有原因。旧响应没有此字段时，只从同一生产单的已返回 `blocked.items` 回退；没有可靠原因时保持原泛化状态，不猜测。

工作区收到 `local_service_unavailable` 写入错误时，显示发生的操作，如「打开剪辑工作台结果暂未确认」，并提供「重新读取已保存工程」。已存在工程时复用 `useWorkspaceReading.read()` 默认 GET，保留其访问与 revision 保护；没有工程时只 GET 当前工作区，不再次自动准备。读取成功后明确保留「原操作是否完成仍未确认」，读取失败可重试读取。核对不调用原写入或生成命令。

新写入开始时同步使旧核对失效，并清理核对忙碌状态；旧 GET 的错误、结束或 AbortError 不会归到下一次未知操作。切换生产单或卸载也使原核对失效。

## 修复边界

这修复了已复现的展示和核对不足。原截图的通用 503 没有可关联请求／异常日志，本轮不能证明它的服务端根因，也不宣称读取成功就确认了那次写入。

5174 的后台当前运行已准备版本，本轮未重启。新的 `operationRows.blocker` 后端字段需将源码准备并重载后才会生效；前端能兼容旧响应，但旧响应某一独立阻塞页没有当前生产单时，仍只能保留泛化原因。

## 验证

- 两条最小公开组件回归先红：delivery + 当前未知口播没有原因；503 没有只读核对入口。
- 并发回归也先红：A 的核对 GET 在 B 操作后结束时，曾把 `Workspace reading ended.` 显示到 B 的未知提示；同步失效与 AbortError 处理后变绿。
- 最初 6 个关联文件共 92 条通过。最终定向 `npx vitest run src/operations/OperationsWorkspace.test.tsx src/local-app/ProductionWorkspacePanel.operations.test.tsx`：41 条通过，包含新增无工程核对、读取失败恢复、并发反馈归属及旧响应回退。
- `DOCKER_HOST=unix:///Users/dan/.colima/loop-control/docker.sock LOOP_CATALOG_FILTERS_TEST_DATABASE=loop_ui_catalog_test_status_feedback_20261111 npx vitest run src/local-app/catalogFilters.integration.test.ts`：6 条通过。只用显式临时数据库，结束后测试自行删除；包含阻塞队列第二页与搜索后的每行原因，不触碰日常数据库。
- 最终 `npm run check` 通过。未运行默认全量测试或重建日常运行版本。
- 实际浏览器在 1440／375px、浅／深色共 4 场景通过：阶段与阻塞原因并存；原操作错误可见；点击核对仅产生 1 个 GET、0 个写入／重放；页面无横向溢出或浏览器运行错误。证据 `browser-results.json`，截图 `status-*.png`、`error-*.png`。人工查看截图确认层级、换行和按钮可用。
- 已有测试仍打印 jsdom 媒体 pause、嵌套封面按钮和 act 警告；测试通过，未顺手修改无关模块。

`fixture/` 只用于验收，所有请求与命令都是本页的合成边界。重跑可先运行 `npx vite --config docs/verification/browser-comments-20261111/status-feedback/fixture/vite.config.mjs`，再运行 `node docs/verification/browser-comments-20261111/status-feedback/browser-check.mjs`。本轮独立 5221 服务与浏览器会话在验收后关闭；5174／5201／5199 保持。
