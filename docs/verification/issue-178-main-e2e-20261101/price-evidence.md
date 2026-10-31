# 本轮价格依据与自限

查询时间：2026-11-01。本轮不充值；费用问题尚未回复时，仅以10元合计作为更保守的自限，不推定OpenAI复用批准。真实计费以服务账单为准。

- 豆包语音合成2.0：官方3元/万字符，字符计费；本轮单次不超过100字符，每次保守预留0.1元。https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh
- 百炼北京 wan2.6-i2v-flash 720P无声：官方0.15元/秒，最短2秒样本0.30元。https://help.aliyun.com/zh/model-studio/wan2-6-i2v-flash
- MiniMax H3 768P：官方0.08美元/秒，前5输入图片免费；4秒输出0.32美元，跨币种保守预留另记，不等于实时汇率。https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise

暂未核定的其他SKU不据猜测放行；鉴权探测、生成提交、远端任务、结果与费用预留分别记录。

- Seedance 2.0官方720p无视频输入为46元/百万token；估算公式为输出秒数×宽×高×帧率/1024。4秒720p/1280×720/24fps估算3.9744元；本轮预留4.5元，仅属保守预算，不等于已扣费。官方5秒720p示例4.97元亦交叉核对。https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1
- Kling 3.0 官方API价格Markdown已实际下载：720P无声0.084美元/秒，3秒0.252美元；本轮只能在跨币种保守总占额不超10CNY时提交。原文保存在临时provider-samples/kling-official-pricing.md（文档查询，不含凭据）。https://kling.ai/document-api/pricing/base/video.md
- 跨币种预算：本轮把1美元按8CNY占额，故MiniMax预留2.56CNY、Kling预留2.016CNY；加Wan0.30、Seedance4.50及主流程TTS0.50，总占额9.876CNY。8为偏保守预算换算，非实际结算汇率。参考中国银行2026-10-31公开美元牌价，100美元现汇卖出667.28CNY、折算671.38CNY。https://www.boc.cn/sourcedb/whpj/index_4.html
