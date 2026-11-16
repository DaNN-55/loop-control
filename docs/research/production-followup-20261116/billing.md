# 真实费用核查

结论：**已实际查询供应商，但仍无法给出两单可信的逐次费用或单据合计。** 下面的美元／人民币数据是供应商返回的账务值，不是估算；账号汇总不等于这两单费用，不按数量比例分摊，不把本地 0 当作免费。

## 两单范围

| 生产单 | 视频 | 图片 | 豆包 TTS | 真实费用合计 |
| --- | ---: | ---: | ---: | --- |
| 事业前程 | 6 | 1 | 6 | 未取得，不能报金额 |
| 乔迁送礼 | 7（含一次重生） | 2 | 6 | 未取得，不能报金额 |

[28 次生成明细 CSV](generation-ledger.csv) 保留每次本地任务、供应商／模型、起止时间及状态；实扣字段保持“未取得”。其余任务属于字幕对齐、音频检索与交付等，不冒充付费生成。

另有 3 次连接验证，不属于任何一单；OpenAI 验证读取模型，豆包验证实际合成固定短句“这是一条测试。”（`providerNetwork.ts:285-294`）。即使本地验证策略把成本写成 0，也不能证明供应商免费。验证费用未强行均摊到两单。

## 实际外部查询

核查由账务子 Agent 使用项目正式 Keychain 解析器及既有只读账务接口执行；未新增生成、充值或修改配置。脱敏查询时间、URL、HTTP 状态和字段摘要见 [billing-evidence.json](billing-evidence.json)。

| 供应商 | 实际读到的结果 | 为什么不能直接作为两单费用 |
| --- | --- | --- |
| MiniMax | `query_balance` HTTP 200，账号可用额 **¥24.50** | 余额包含现金、代金券及信用额度，不是消耗；现有接口未返回逐任务费用。没有制作前后独占余额快照，也不能用余额差倒推本单。 |
| OpenAI | 11/15 UTC 的 Costs HTTP 200；其中 `gpt-image-2.6-sunburst`、同一 Key/Project 的模型账务汇总 **US$0.112594** | 没有请求 ID／调用次数，不能证明这组恰好只包含本次 3 张图；不能拆给事业／乔迁。 |
| 火山／豆包账务 | 余额查询 HTTP 200，可用额 **¥14.21**；近 7 天入账 **¥0.18**，分为 11/12 ¥0.09、11/15 ¥0.09 | 返回行缺产品、资源、模型、请求信息，不能证明当天 ¥0.09 就是 12 次 TTS 或任意一单。 |

OpenAI 进一步查询了 11/15 UTC 全天的 Images Usage，按小时、模型和 API Key 分组：HTTP 200、24 个桶、`has_more=false`，全部 `results=[]`；按账单 Key 过滤仍为空。**空用量不能当作费用为 0。**

### OpenAI 供应商直接返回的模型费用行

同一账务 Key 和 Project 的脱敏别名一致：

| line_item | 账务金额（USD） | 数量 |
| --- | ---: | ---: |
| gpt-image-2.6-sunburst image, cached input | 0 | 0 tokens |
| gpt-image-2.6-sunburst image, input | 0.034704 | 4,338 tokens |
| gpt-image-2.6-sunburst image, output | 0.075180 | 2,506 tokens |
| gpt-image-2.6-sunburst text, cached input | 0 | 0 tokens |
| gpt-image-2.6-sunburst text, input | 0.002710 | 542 tokens |
| **模型／Key／Project／日窗聚合** | **0.112594** | 不等于逐请求费用 |

实际生成路径为 `api.openai.com/v1/images/generations|edits`，独立账务凭据绑定同一个本地图像连接。但“本地绑定相同连接”不能单独证明账务 Key 与生成 Key 属于相同供应商组织／项目，也不能证明当天没有其他调用。

MiniMax 连接数据库 endpoint 为 `api.minimax.io`，而正式凭据 region 为 `cn`，实际余额查询及本次生产走国内站 `api.minimax.cn`；本轮只记录差异，未改配置。

## 能否取得每次真实费用

**目前不能。** 本地只留下本地任务／制作请求 ID 和媒体，未保留足以对账的供应商 task/request ID、原始用量／计费回执；目前查到的供应商费用又是账号或日窗聚合。

建议以后分别保存：供应商请求 ID、任务 ID、用量、Key/Project 的非秘密标识、币种、账务周期与结算状态；若供应商有请求级账单，才按 ID 对账。只有聚合接口的供应商，仍只能展示聚合实账，单次／单据费用保留未知，不能按单价或调用比例填“真实费用”。过去已经丢失的映射不能靠补埋点自动恢复。

OpenAI 官方明确 Images Usage 支持小时／分钟及模型、Key 维度；Costs 只支持日桶，可按项目、Key、line_item 分组。这些维度有助于缩小范围，但接口本身不返回请求级费用。[Images Usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/images)、[Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)。
