# ADR-0070：主脚本格式识别兜底

状态：Superseded by [ADR-0071](0071-confirmed-script-recognition.md)。以下为当时的格式修改建议设计，保留历史。日期：2026-11-17。依据：用户要求接入 GPT 与 DeepSeek，并确认仅做格式和识别兜底、保留原意、预览后采用。

本地解析仍是第一入口。编辑中的非空脚本未通过解析时，Owner 可以显式使用大语言模型，选择已验证的独立文本连接并生成建议。本地解析成功不调用模型。采用建议只更新当前草稿，仍须经过原有脚本修订确认，不保存版本、不创建制作任务。

注册 `language_model` 能力、`openai_responses` 和 `deepseek_responses` 连接。GPT 固定 `gpt-5.6-luna`；DeepSeek 默认 `deepseek-flash`，`deepseek-v4-pro` 需要显式启用。原有 OpenAI 图片连接不作为文本凭据来源。连接验证只读取模型资格，不能证明真实生成成功。文本可用性独立于图片执行开关和图片预算策略。

各连接固定官方 Responses URL，使用系统指令、单次用户输入与 JSON Schema；不注册工具，不连接历史对话，不自动切换供应商。OpenAI 请求带 `store:false` 和 `strict:true`；DeepSeek 按其无状态 Responses 合同省略这两个参数。输入限 20000 字符、响应读取限 512 KiB、超时 45 秒。费用提示位于生成按钮之前；记录实际 token 用量，不推算未确认的金额。

模型结果视为不可信输入。服务端和采用时均验证结果结构、本地脚本格式、原有标题、可识别口播的逐字内容与顺序、制作设置版本及内容值。检查不能代替人工核对原意；无法无损识别时显示提醒，不能采用。范围不含事实纠错、内容合规审核、润色、续写或自动补全缺失素材。

迁移 207 新增 Owner 隔离的 `script_format_requests`。发送前先持久化连接版本、模型、合同版本、源文本、诊断、精确 URL／请求正文快照及发送状态；快照不含密钥。连接密钥继续由 Keychain 管理。请求复用现有 session、Origin／Host、CSRF、生产单归属、回收站／历史／归档和脚本基准检查。

同一请求标识绑定固定内容；同源文本、基准和模型的未失败请求可恢复旧结果。并发合并，发送前落库，网络或响应流中断记为未知，不自动重发；写回失败留下发送中记录，也不重新发送。明确失败后允许用户再次发起。响应到达后重新检查脚本基准，前端还检查组件生命周期与草稿范围，过期结果不采用。请求回执不使用制作队列，也不改变原有生产统计语义。

官方合同核验（2026-11-17）：[OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna.md)、[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs.md)、[DeepSeek 模型](https://api-docs.deepseek.com/quick_start/pricing/)、[DeepSeek Responses](https://api-docs.deepseek.com/guides/responses_api/)、[DeepSeek 模型目录](https://api-docs.deepseek.com/api/list-models/)。

验收及真实调用限制见 [验证记录](../verification/script-format-fallback-20261117/REPORT.md)。
