# Worker 预检采用最小结构化契约

为让蓝图页、生产前检查和任务阻塞共享同一状态，沿现有 `runCodexWorker` 执行链复用冻结的 `WorkerTaskPackage`，由 CLI 在资产和输入校验、实际执行之前调用 preflight，并将最小结构化检查项 `{ capability, check, phase, status, reason, action, scope }` 作为现有 `worker-result/v1` 的可选 `preflight` 字段回写；未通过的 preflight 跳过执行并保持任务 `blocked`，由 action 决定人工下一步；`phase` 为 `preflight` 或 `execution`，`status` 为 `passed`、`blocked`、`retryable` 或 `unavailable`，`action` 为 `none`、`edit_blueprint`、`retry` 或 `contact_environment_admin`，`scope` 为 `blueprint`、`episode` 或 `worker`。
Worker 环境是注册、Adapter / Provider 发现、模型权限、凭据存在性、工具权限、网络和资产目录状态的权威来源；注册、静态配置和工具白名单可在 preflight 检查，真实凭据有效性、网络请求、Provider 接受模型以及下载和产物验证只能在 execution 阶段确认，结果只返回状态和原因，不返回秘密；蓝图声明缺失或无效走 `edit_blueprint`，实际挂载、操作系统权限、秘密和运行环境故障走 `contact_environment_admin`。
四项能力 token 固定为 `a_roll_generation`、`b_roll_generation`、`narration_generation`、`soundtrack_generation`，配置缺失或无效可修复受阻 Episode，临时连接故障走 `retry`，未注册能力走 `contact_environment_admin`；旧 `blockers` 的 `code/detail` 继续兼容，本票不新增 Provider、凭据存储、插件平台或侧边面板。
