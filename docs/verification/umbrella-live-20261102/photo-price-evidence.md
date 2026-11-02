# 写实版费用修订

2026-11-02：用户明确要求不用手绘卡片，改为先调用主项目现有 gpt-image2 生成首帧，再制作视频。原百炼插画视频不算用户验收通过，其费用仍计入累计上限。

- [OpenAI 官方生成指南](https://developers.openai.com/api/docs/guides/image-generation)：gpt-image-2 的 low 1024×1536 输出参考价 0.005 USD／张；另加文字输入费用。
- [OpenAI 官方价格](https://developers.openai.com/api/docs/pricing)：gpt-image-2 文字输入 2.50 USD／百万 token，图片输出 15 USD／百万 token。无需图片输入，不使用其他模型替代。
- 使用 8 CNY／USD 作为本轮预算保守换算上限，不称其为实时汇率。每个生产单一次 low 1024×1536 请求，各预留 0.10 CNY。
- 百炼 wan2.6-i2v-flash 北京 720P 无声每秒 0.15 CNY，新版 4 秒估算 0.60，预留 0.70。
- MiniMax-H3 国内 768P 每秒 0.50 CNY，新版 4 秒估算 2.00，预留 2.50，覆盖已观察到的编码尾帧余量。
- 原百炼 6 秒估算 0.90，原占额 1.00；未向 MiniMax 提交旧请求。

新旧累计网络占额最多 4.40 CNY，用户上限仍为 5.00 CNY。参考估算约 3.60 CNY，实际以供应商账单为准；既不把占额当扣费，也不因为旧版本被拒收而忽略其费用。所有收费提交均有任务和账本；未知提交只按原 ID 恢复，不重新提交。
