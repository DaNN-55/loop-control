# OpenAI GPT Image 2 接入验证

日期：2026-10-30。

## 接入范围

沿用已注册的 `openai / openai_images` Adapter、外部连接版本、Keychain、Worker 与生成请求预算。可选模型改为 `gpt-image-2`；连接测试读取 `GET https://api.openai.com/v1/models/gpt-image-2`，不生成图片。实际生成使用 `POST /v1/images/generations`，明确请求一张 `1024x1536` PNG，解析 `data[0].b64_json` 并登记本地产物。保留原有 1200 字符提示词边界。

不增加依赖或数据库迁移，不改写既有蓝图、Episode、连接或任务快照。旧 `gpt-image-1` 选择需要 Owner 在蓝图中显式更新，不静默替换。Owner 已创建 Personal 组织下的 `loop-control-image2` project 与 `loop-control` API Key；本轮未读取或写入真实 API Key。

官方依据：[Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)。官方接口支持本次使用的尺寸和默认 base64 图片响应。

## 验证结果

- 6 个文件、125 项定向测试通过：模型目录、蓝图校验、只读连接测试、请求预算、单张生成请求、PNG 响应和本地产物。
- 5 个文件、67 项受影响路径回归通过：生产前检查、媒体执行器、连接页面和账号工作区。
- `npm run check` 通过。
- `npm run runtime:prepare` 通过，包含 Worker 与后端构建；`assertPreparedRuntime` 完整性校验通过，已编译模型目录确认为 `gpt-image-2`。
- 重启前待执行与运行中任务均为 0；本地服务重启成功，`http://127.0.0.1:5174/` 返回 HTTP 200。
- `git diff --check` 通过。未提交、未推送。

首次网络测试中的两项本机 HTTP 测试被沙箱拒绝监听 `127.0.0.1`；授权本机监听后，该文件 30 项全部通过。任务状态首次使用 Worker 数据库角色读取时因权限不足失败，随后使用项目既有 `runtimeContext().sql` 维护入口完成只读核查，未更改数据库权限。

## 限制与后续使用

更新前已实际打开本地工作台；更新后浏览器控制连续两次超时，因此未完成连接表单和模型下拉框的更新后实机核验。组件回归与已编译目录检查均通过，但不作为实机操作通过的替代。

未发出真实 OpenAI 请求；真实密钥、模型权限和图片生成效果待 Owner 填写密钥后验证。连接测试成功仅确认认证及模型可访问，不代表图片生成已验收。

在「连接配置」新建连接，选择「OpenAI Images」，填写 API Key 后保存并测试。随后在账号蓝图的「静态视觉 / 图片生成」中选择外部路径、该连接和 `gpt-image-2`。模型配置属于蓝图；OpenAI project 由 API Key 自身绑定，无需在 Loop Control 另填 project 名称。
