# 状态机优化第 5、6 项交付

2026-11-11。按用户批准完成规划设置失败接续及字幕／上传真实集成验收，在当前 `main` 本地提交，不推送。基线 `1f530224`，产品及测试提交为 `e47691a5`、`e24ff95d`、`b68fb1bc`。范围见 [SPEC](SPEC.md)，决定沿用并补充 [ADR-0039](../../adr/0039-workspace-local-recovery-and-polling.md)，审查见 [REVIEW](REVIEW.md)。

## 第 5 项：规划设置接续

全局规划默认值和本期规划保存直接消费命令已确认的配置／revision，移除随后重复 GET；不再因这个额外读取失败，把已保存的操作误报为失败并用旧 revision 重新提交。服务端 CAS 与规划选择规则保持。

全局 Harness 登记后列表读取失败，保留已创建版本和提交内容，显示「重新读取版本」；继续仅读取，不再创建。账号 Harness 管理对同一输入保留已确认创建结果，列表读取失败显示错误，重试只补读。同周期重复事件由同步锁拦截；访问结束后不发起旧阶段的后续读取、不覆盖新访问、不选择已关闭弹层的旧结果。

共享 `PromptVersionManager` 捕获登记异常、保留输入并以 alert 公告，避免未处理 Promise 异常。没有新依赖、SQL 迁移、通用恢复框架或供应商调用。

首次有效失败证据：[保存后读回](planning-save-red.log)、[全局登记后读回](planning-registration-red.log)、[本期保存及离开访问](planning-visit-episode-red.log)、[账号 Harness](account-harness-red.log)、[错误公告](registration-alert-red.log)。最终公开组件／真实 localCommand HTTP 边界 3 文件、13 条回归全部通过：[planning-targeted.log](planning-targeted.log)。

## 第 6 项：真实恢复验收

使用专属无网络 PostgreSQL 容器、空业务数据库、随机临时文件目录、复制的 OpenChatCut 和独立 Chrome 会话。SDK 来源提交为 `72ddb3300cda4ed31cbd0bccbfc94fb29b8cffca`，没有读取日常 deployment、秘密配置或业务数据。复用真实 Owner 会话、CSRF、HTTP handler、命令事务、文件 IO 和 SDK document store；供应商执行由 fixture 明确拒绝。

验收主体为 [workspaceRecovery56.browser.integration.test.ts](../../../src/local-app/workspaceRecovery56.browser.integration.test.ts)，只在 HTTP 边界注入指定 503。通过证据见 [integration-final.log](integration-final.log)、[recovery-boundaries.json](recovery-boundaries.json)。该测试是 1 条连续场景，覆盖以下检查，不将其虚报为多条独立测试：

| 故障／动作 | 实际结果 |
| --- | --- |
| 原生字幕写入及 Owner 保存成功，字幕登记前 503 | 真实文件已含新字幕；继续沿原键登记，`saveWorkspaceStudio` 总计 1 次，没有再次保存原生工程。 |
| 完成后关闭 Studio、重启 Owner 服务、重开 | SDK project-store 返回的字幕正文保留，不只检查备份 JSON。 |
| 非原生字幕保存已提交，向客户端返回 503 | 已提交工程 SHA／revision 已变化；重试原键获成功回执，revision 保持 6，没有再次写入。 |
| 素材导入成功，候选登记前 503，关闭并重开素材面板 | 导入 1 次；同键补登记候选，最终只有 1 个图片候选。 |
| 全局 Harness 创建成功，列表 GET 503 | 重新读取版本后选中，默认配置保存至 revision 1；全局版本只创建 1 个。 |
| 账号 Harness 创建成功，工作区列表 GET 503 | 表单显示错误并保留输入，重试只读列表，版本只创建 1 个；本期选择保存至 revision 1。原 fixture 已有 1 个版本，最终总数为 2。 |

浏览器工具连续两次无法定位跨域 OOPIF，所以通过该 iframe 对应的 `origin/source/channel/projectId` 注入「打开字幕面板」通知。仅此导航入口为模拟；可写状态来自真实编辑器，后续 inspect／apply／save 均经真实宿主和 SDK。不能把本轮描述成「在原生 iframe 内自动点击字幕按钮」。

宽窄屏实际查看：[全局登记失败宽屏](planning-interrupted-1440.png)、[窄屏](planning-interrupted-390.png)、[保存后宽屏](planning-1440.png)、[窄屏](planning-390.png)、[账号登记失败窄屏](account-harness-interrupted.png)。1440／390 px 无横向溢出，见 [宽屏尺寸](planning-layout-1440.json)、[窄屏尺寸](planning-layout-390.json)。

验收夹具调试期间的失败保留在 `integration-first.log` 至 `integration-seventh.log`：默认依赖扫描包含旧 Demo、跨域 frame 定位、恢复开始时按钮暂时隐藏导致等待过早、允许域名限制拒绝 about:blank、上传 input 为 hidden、CLI JSON 字符串编码，以及 fixture 已含一个 Harness 的计数基线。分别修正验收入口／等待／断言后，完整真实链路通过；这些不是被掩盖的产品失败。

复跑先执行 `node docs/verification/state-machines-56-20261111/isolation.mjs`，等到 READY，再在另一个终端执行 `node docs/verification/state-machines-56-20261111/run-acceptance.mjs integration-final.log`。前者仅创建本任务的隔离环境；完成后向它发送 SIGINT，按 label 校验后删除容器与临时 SDK。`isolation.json` 是本次已清理环境的历史定位，复跑会重建。

## 最终检查与交付边界

- 类型检查通过：[check.log](check.log)。
- 默认全量仅运行一次：259 文件全部通过，1949 条通过、1 条跳过，无失败：[full-tests.log](full-tests.log)。默认命令排除数据库集成文件；上面的真实恢复验收单独运行并通过。
- 前端、Worker、后端按顺序构建通过：[build.log](build.log)、[worker-build.log](worker-build.log)、[backend-build.log](backend-build.log)。保留现有大于 500 kB 的 chunk 提示、测试中的 React act／jsdom 媒体提示，以及验收 Vite 的大依赖代码生成提示，均未计作失败。
- Standards／Spec 两路审查完成，唯一错误公告问题已红绿修复并复核关闭；全量在此修复后运行。
- 先核对随机 fixture 数据库全部删除，再停止专属容器并清理 SDK／文件目录；本轮浏览器和 Vite 均关闭，见 [cleanup.json](cleanup.json)。日常 5174 仍由原 PID 46204 监听，未重启日常服务，未激活新的运行包。
- 远端 main 核对仍为 `1bedac1035a38a6399b931ad8cb4e42781a5216d`，没有推送。两份无关研究文件保持未暂存，保护清单见 [protected.json](protected.json)，[最终 SHA 核对](protected-final.json) 一致；其中 ClickStack 研究在本轮执行期间由其他会话新增。

本轮未验证付费生成、真实生产数据或全流程最终成片。已确认创建回执的客户端接续仍限于当前访问内存；关闭后重新读取服务端既存版本，不新增跨整页刷新恢复协议。字幕关闭重开验收发生在恢复完成后，失败时仍在原访问继续；不把它描述成未完成客户端 attempt 的跨重启持久化。
