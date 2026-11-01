# 本轮规格与费用预留

查询：2026-11-01 Asia/Shanghai。每个视频API只生成一条，逐项串行；保留远端任务ID，未知提交不重提。用户已明确同意本轮总额30元、单条10元范围；批准原文与时间保留在私有 approval.json。

| 服务 | 当前模型与最短规格 | 私有调用预算预留 |
| --- | --- | --- |
| Seedance | doubao-seedance-2-0-260128，720p、4秒、无声、单张首帧 | 6 CNY |
| MiniMax | MiniMax-H3，768P、4秒、单张首帧 | 3 CNY |
| 百炼 | wan2.6-i2v-flash，北京720P、无声、2秒 | 0.30 CNY |
| Kling | kling-v3，std无声、3秒 | 先免费查询；若允许提交，预留2.10 CNY，不充值 |

四项预留合计11.40 CNY。预留不是实际扣费；跨币种使用保守占额，供应商实际账务另计。本轮隔离授权不改变账号已保存预算或日常服务网络授权。

- [MiniMax官方价格](https://platform.minimax.io/docs/pricing/overview?tab=api-enterprise)：H3 768P为0.08 USD/秒，前5张输入图片免费；4秒0.32 USD。本轮3元为预算占额，不是汇率声明。
- [百炼官方价格](https://help.aliyun.com/zh/model-studio/wan2-6-i2v-flash)：北京720P无声0.15 CNY/秒，2秒0.30 CNY。
- [Seedance官方价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1)：查询索引可见，全文工具本次超时；沿用同日既有已留证的720p无视频输入46元/百万token及输出公式，4秒1280×720、24fps为3.9744元估算，本轮预留6元。价格快照见 `../issue-178-main-e2e-20261101/price-evidence.md`。没有将其他LAS产品价表当作方舟直连价表。
- [Kling官方价格Markdown](https://kling.ai/document-api/pricing/base/video.md)：网页工具不支持该内容类型，同日已下载的官方原文快照为 `/private/tmp/loop-control-main-e2e-20261101/provider-samples/kling-official-pricing.md`；720P无声0.084 USD/秒，3秒0.252 USD。本轮先免费查询资源包，未获明确可用余量时不提交生成。

本轮只调用当前已验证连接和对应Keychain不透明引用，不读取或记录秘密原文到文件。成功标准为真实提交、轮询、下载和实际MP4解码；只读鉴权或HTTP200不足以证明生成通过。
