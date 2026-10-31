# 真实 Provider 最小样片测试

执行时间：2026-11-01 05:49—05:51（Asia/Shanghai）。本轮使用当前 Owner 已保存的连接和 Keychain 引用；秘密仅在进程内读取。所有提交串行执行，每个生成 Provider 最多一次提交，未充值、未修改连接或调用 OpenAI。鉴权探测与本表的生成提交分别记账，HTTP 200 探测不视为生成成功。

| Provider / 实际模型 | 本轮操作 | 结果 | 远端任务 / 请求标识 |
| --- | --- | --- | --- |
| Pexels | 搜索 quiet forest，下载短素材 | HTTP 200；下载、MP4结构与 ffprobe 通过 | 素材 28830547；文件 12488809 |
| 百炼 / wan2.6-i2v-flash | 首帧图生视频，720P无声，2秒 | 提交、轮询和下载均 HTTP 200；实际生成通过 | task `7c019f96-1782-4b4d-af9a-41be00d92f1b` |
| MiniMax / MiniMax-H3 | 首帧图生视频，768P，4秒 | HTTP 402；`insufficient balance (1008)`；无任务ID | request `073595c991ece6a2d4e1714800fd13e2` |
| Seedance / doubao-seedance-2-0-260128 | 首帧图生视频，720p无声，4秒 | HTTP 404；`ModelNotOpen`，当前账号未开通该模型；无任务ID | request `021793483480497a4e0bfe9b623ca70f9090a72d521bae2630bff` |
| Kling / kling-v3 | 首帧图生视频，std无声，3秒 | HTTP 429；业务码 `1102`、`Account balance not enough`；无任务ID。该次429应按余额不足处理 | request `d1388ef3-c50c-49ac-9d4b-6ab114862d0d` |

后三项在提交时直接被拒绝，未自动重试、未充值、未改模型。并无“所有视频生成API都不可用”的证据：本轮百炼实际成功。OpenAI尚待用户选择是否复用现有密钥，不在本轮调用范围；豆包语音由主流程通过正式应用生成。

## 实际素材

所在隔离目录：`/private/tmp/loop-control-main-e2e-20261101/provider-samples/`。

| 文件 | 大小 / 时长 / 格式 | SHA-256 |
| --- | --- | --- |
| `pexels-source.mp4` | 904168 bytes；4.56秒；720×1280；H.264；50fps | `b72e65982976866522fcabe5e0ecaf1c2daaee01ca7f30b866b3d7458fc20498` |
| `bailian-sample.mp4` | 2823743 bytes；2.00秒；720×1280；H.264；30fps | `7cc17e17abe1b0360931ecb995571ed83f26556ea19dedc5a363310f29e72c91` |

`first-frame.png` 从本次下载的 Pexels 素材提取，并统一传给以上4个视频 Provider；未使用日常账号素材。Pexels 作者、公开来源网址与下载文件ID保存在 `provider-samples-results.json` 的 `source` 中。

## 费用边界

网络授权采用生产 `createProviderFetcher`，每个 Provider 使用单独的私有策略和持久账本。视频生成调用采用当前编译源码的 `generateWanVideo` / `generateOfficialVideo`；搜索下载采用 `queryPexelsVideos` / `downloadPexelsVideo`。没有替换成模拟生成，也没有绕过生产请求白名单。

预留按最短样本和官方价格设定：Wan 0.30CNY、MiniMax 0.32USD、Seedance 4.50CNY、Kling 0.252USD。美元统一按8CNY占额，合计9.376CNY，另给正式流程留0.50CNY（新增一次Wan 0.30CNY与两次TTS各0.10CNY），总计9.876CNY。8为保守预算折算，不是实际结算汇率；价格与折算依据见 [价格记录](price-evidence.md)。

这些数字是请求预算预留。失败提交的网络账本仍保留预留，没有重置或冒充退款；未读取供应商实际账单，不能据预留声称已扣款。成功Wan按2秒公开单价估算约0.30CNY，实际扣费仍以供应商账单为准。

- [万相官方规格与价格](https://help.aliyun.com/zh/model-studio/wan2-6-i2v-flash)
- [MiniMax官方API价格](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise)
- [Seedance官方计价与token估算](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1)
- [Kling官方API视频价表](https://kling.ai/document-api/pricing/base/video.md)

## 运行记录与恢复

- `provider-samples-events.jsonl`：逐请求 method、host、path、状态、耗时；提交任务ID；脱敏业务错误；实际文件指纹。
- `provider-samples-results.json`：每个 Provider 最终结果、任务/文件/媒体元数据及预算。
- `provider-samples-network-manifest.json`：5份不可变策略SHA、审批与价格证据SHA、请求次数、预留、每次网络结果。私有策略目录保留对应当时价格与授权文本，已逐份校验SHA一致。
- 本轮没有遗留生成中的远端任务；Wan已下载成功，其余3个生成提交无任务ID。两个本地执行进程均已结束。
- 没有打开浏览器、Finder或原生窗口；没有新建分支/工作树或修改日常服务、数据库和Keychain。

正式应用后续若复用以上片段，应按文件SHA核对，并通过普通素材导入保留公开来源；不要把这组独立Provider样片测试当作Owner任务、候选采用、原生工程或交付流程已经通过。
