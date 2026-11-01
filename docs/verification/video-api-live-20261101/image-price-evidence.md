# 替代图请求与费用依据

2026-11-01：用户要求为Seedance、Kling各用图片模型生成一张替代图，并明确选择复用现有gpt-image2连接。沿用本轮总30元、单条10元上限，追加两次独立图片请求，各预留1元；全部6次生成请求预留合计13.40元，不表示实际扣费。

模型gpt-image-2，size=864x1536、quality=medium、n=1、PNG，每个目标仅一次请求，均不附私人参考素材。原正式执行器为generateOpenAiImages，使用现有Keychain凭据及createProviderFetcher白名单和私有账本，成功后完整PNG解码核验。

[OpenAI官方图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)：GPT Image2支持自定义尺寸；864×1536两边为16的倍数、9:16比例在支持范围。官方1024×1536 medium对照价0.041USD仅用于量级参考，不冒充864×1536的精确报价。

[OpenAI官方价格](https://developers.openai.com/api/docs/pricing)：gpt-image-2输入文字2.50USD/百万tokens、输入图片4USD/百万tokens、输出图片15USD/百万tokens。若响应返回usage，则保留token统计；供应商实际账单仍为扣费依据。本轮每张1CNY为预算占额，不是汇率或账单声明。
