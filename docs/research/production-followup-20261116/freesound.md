# Freesound 三次失败与免费音频 API 兜底研究

日期：2026-11-16。范围只读：任务证据、现有适配器、已采用流水回执和少量无凭据网络探针；未修改连接、生产单、素材或产品代码。原始摘要在 [freesound-evidence.json](freesound-evidence.json)。

## 结论

三次失败均已越过本地预检，失败点是 **Freesound 搜索后的 MP3 预览下载**，不是脚本、音频裁剪或付费 API。候选 0 在 122.368 秒后超时；候选 1、2 分别在约 5、4 秒时未完成。两条短失败的底层错误码没有保存，不能断言是 DNS、CDN、代理还是远端断连。

当前路径将预览下载超时设为 120 秒；实际超时与该上限吻合。随后已按现有搜索结果采用 CC0 的 `river (loop).wav`（source ID `368299`），回执已保存。对同一预览的 2 KiB 范围读取在本次探针中为 HTTP 206、1.17 秒，说明当前可达，**不能倒推历史三次失败的具体网络原因**。

Openverse 的首条匿名检索结果实际仍是 `provider=freesound`，所以**替换检索 API 不等于替换下载源**，不能称为 Freesound CDN 故障的兜底。本轮用官方 stats 中的 `wikimedia_audio` source filter 与 `CC0` 再检索，返回 170 条；其中一条 Wikimedia Commons 的 `433589_jackthemurray_stream-river-water-up-close` 原站 WAV 已做 2 KiB 范围读取（HTTP 206、0.78 秒）。这仅证实一个非 Freesound 的 CC0 候选当前可达，未被导入、采用或用于生产。

更重要的是：Freesound 的免费 API 条款仅限非商业用途；即使某个声音本身是 CC0，不能据此把 Freesound API 当作商业生产的免费自动兜底。Freesound 官方 API 允许 API key 搜索及无需 OAuth 的预览下载，但商业 API 使用需另行取得 Freesound 许可。[API 概览](https://freesound.org/docs/api/overview.html) / [API 条款](https://freesound.org/docs/api/terms_of_use.html)

## 根因证据与代码边界

| 任务 | 候选 | 时长 | 记录的结果 | 可确认结论 |
| --- | --- | ---: | --- | --- |
| `720b7622…` | 0 | 122.368 s | 预览下载超时 | 与当前 120 s 下载 deadline 一致；搜索已完成、预览未完成。 |
| `fdcf1d05…` | 1 | 4.994 s | 预览下载未完成 | 下载阶段发生网络/响应中断；无底层 errno，不能细分。 |
| `a9e5b598…` | 2 | 3.954 s | 预览下载未完成 | 同上。 |

- `src/local-app/providerNetwork.ts:208-216` 对 Freesound search 使用 30 秒、download 使用 120 秒；`src/worker/controlledMediaExecutor.ts:163-182` 先搜索，再下载 `preview-hq-mp3`，并将超时与一般未完成分开报错。
- 三个请求受 `provider:freesound` 与适配器并发 1 限制，因而不是三条预览并发争抢造成的证据（任务快照的 `runtime_constraints`）。
- `src/worker/mediaProviders.ts:121-145` 读取 `license`，但只按时长、可用 MP3 预览和 `candidateIndex` 返回；没有许可白名单。因此它目前**不能**安全自动选择“可商用”结果。这是许可控制缺口，不是这三次连接失败的根因。

## 可用候选与许可判断

| 来源 | 可调用 API / 凭证 | 商业可用结论 | 适合作为自动兜底？ |
| --- | --- | --- | --- |
| Freesound | API key；搜索、预览下载可用 | **免费 API 不可用于商业**；商业 API 使用需与 Freesound 另行许可。内容还须逐条按 CC 许可处理。 | 否，除非先取得商业 API 许可、落实许可筛选与采用流程。 |
| Openverse | 官方 `/v1/audio/`；匿名可查，注册可提高额度；有 rate limit | 是开放许可的聚合搜索，不是统一素材授权。必须逐条验证返回的 `license`、归属 URL、实际下载与署名。 | 只可作候选搜索；须限定 `source` 且验证实际 `url`，不能静默下载/采用。当前无此适配器。 |
| Wikimedia Commons | 公共 MediaWiki API / 文件页 | 每文件单独许可；可商用重用通常要署名，部分为 CC0。 | 可作为非 Freesound 候选来源；仍仅人工候选或后续严格适配器，不作无提示替换。 |
| Pixabay | 官方 API 只文档化图片与视频检索 | 站内可能有音频内容，但官方 API 文档没有音频 endpoint。 | 否；不能把免费网页或内容许可误称免费音频 API。 |

Openverse 的官方 API 说明其提供匿名/注册访问、音频搜索及返回许可、归属和源 URL；本轮匿名 `river` 探针返回 240 条，但首条 `provider=freesound`，故明确排除为独立下载源。`/v1/audio/stats/` 列出的合法 `wikimedia_audio`（Wikimedia Commons）source 有 3,986,828 条，受限查询 `q=water&source=wikimedia_audio&license=cc0` 返回 170 条；选中的 CC0 文件页为 [Wikimedia Commons 条目](https://commons.wikimedia.org/w/index.php?curid=117971232)，其 `upload.wikimedia.org` 原文件探针为 HTTP 206。它证明检索和这个源站文件当时可达，不证明内容质量或商业场景适配性。[Openverse API](https://api.openverse.org/v1/)

许可默认规则应为：CC0 可作商业候选（仍保存来源与 SHA）；CC BY 可作商业候选但必须持久化作者、标题、许可链接和是否裁剪/改动；CC BY-SA 会把衍生/传播许可义务带入交付，默认排除；CC BY-NC / BY-NC-SA 明确不得作商业制作；含 ND 的音频不应自动裁剪或混音。CC0、CC BY 与 CC BY-NC 的官方含义见 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)、[CC BY](https://creativecommons.org/licenses/by/4.0/deed.en)、[CC BY-NC](https://creativecommons.org/licenses/by-nc/4.0/deed.en)。Wikimedia 也强调媒体逐文件许可和来源可达性。[Commons 重用说明](https://commons.wikimedia.org/wiki/Commons:First_steps/Reuse)

## 建议顺序（不自动越权）

1. **已获许可的本地上传素材**：优先；保留原文件、许可/授权回执、SHA 和明确采用。
2. **Freesound 原冻结任务重试**：仅在确认商业 API 许可及候选条目许可后，重试同一候选/同一任务语义；不重新搜索、更换候选或自动采用。当前 120 秒已覆盖慢下载，先记录 HTTP/传输错误再讨论重试策略。
3. **Openverse 候选搜索（后续单独接入）**：先限制 `source` 为非 `freesound`（本轮验证过 `wikimedia_audio`），再仅检索 `CC0`；若允许 CC BY，必须生成可交付的 attribution 条目并在 Owner 明确采用后下载。每次下载前后复核 `provider/source`、`url` 主机、`license`、`license_url`、`foreign_landing_url`、真实文件类型/时长、SHA。返回 Freesound 或同一 CDN 的结果不算兜底；源站不可达则失败，不换源静默重试。
4. **Wikimedia Commons 人工选择**：同样先保存文件页、许可、作者、归属文本和 SHA；仅在 Owner 明确采用后导入。
5. **无合规候选时阻塞**：提示上传已授权音效或取得供应商许可；不得以网页抓取、CC-NC、未知许可、生成的占位音频或自动改选绕过。

所有后续自动化都应把“搜索/下载成功”与“Owner 采用”分开：候选不得进入工程或替代旧音轨，除非许可策略通过、文件验证成功、费用/请求快照完整且 Owner 明确采用。本文不授权实现这些变更。
