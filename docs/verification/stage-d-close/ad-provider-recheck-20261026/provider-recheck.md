# 四家 Provider 同配置复测

Owner 本轮明确授权：沿用之前配置再测试一次，仍不可用就记录原因、跳过完整测试并关闭对应 Issue，之后执行 #149。本次未修改业务源码、注册连接、凭据、模型或端点。

| Issue / Provider | 本轮结果 | 真实请求数 | 处理结论 |
| --- | --- | ---: | --- |
| #137 / Google TTS | HTTP 403，允许列表中的错误原因为 `BILLING_DISABLED` | 1 | 计费仍不可用；按 Owner 豁免关闭，不计验收通过 |
| #138 / Freesound | HTTP 401，`HTTP_401_UNAUTHORIZED` | 1 | 原认证仍不可用；按 Owner 豁免关闭，不计验收通过 |
| #139 / Cloudflare | 三份原有材料均不满足 `Account ID:API Token` 组合格式 | 0 | 本地前置失败；未拼接历史材料、未更改配置，按 Owner 豁免关闭 |
| #140 / OpenAI | 当前测试 Owner 没有既有测试连接 | 0 | 缺少原有测试 Key 前置；未读取生产秘密、未新建连接，按 Owner 豁免关闭 |

Google 和 Freesound 的连接 ID、版本 ID 与 immutable secret reference 均核对为此前固定版本，实际由原 Keychain store 读取，再调用当前生产探针实现。Cloudflare 只检查原有三份材料的格式；OpenAI 只确认现有测试配置缺失。不能将后两项描述成向 Provider 发请求后失败。

本轮的「配置未改变」指原登记版本、引用和端点，以及本轮没有写凭据；原始回执中的 `credentialUnchanged` 也按此范围解释。本次新增指纹用于公开材料防泄漏，不能反向证明所有凭据与历史时点逐字节相同。

本轮总计 2 个真实资格 GET 请求，无自动重试、合成、图片生成、素材下载或真实模型任务。每家使用独立的一次请求上限，保留旧账本原样；未延长旧过期策略或借用旧余额。新一次性授权已用完或关闭，密钥只经过内存和原 helper，不写入报告或请求日志。错误诊断仅保留允许字段，没有保存 Google 原始错误消息、云项目标识、请求头或 token query。

专用测试 Keychain 在开始前处于锁定状态，读取后已恢复锁定；默认 Keychain、搜索列表和凭据内容未修改。没有启动正常应用或 Worker，也没有修改旧测试数据库中的资格记录。

## 保留的本轮执行问题

第一次私有验收脚本尝试把本次 Provider 凭据与前轮 #141/#142 范围的 9 个私有指纹相匹配，因该指纹集合不能覆盖本次凭据而提前停止。当时实际请求为 0，Keychain 已恢复锁定。随后只修正新建的私有验收脚本：沿用原始固定版本与引用，并为本次读取的值新增私有 SHA-256 指纹。没有改业务源码或凭据，旧 marker、零请求账本和失败说明均保留；原进程输出仅留在工具记录，未捕获为独立 raw 文件，不能将说明冒充原始日志。

这些关闭属于 **Owner 接受的范围豁免**，不是服务恢复、真实媒体闭环通过或外部能力就绪。四票原始验收清单、历史失败、旧账本以及旧报告中的开放门禁快照均保留，由新关票说明解释状态变化。

[本轮汇总](v2-provider-retry-results.json) · [Google](google_tts-retry-result.json) · [Freesound](freesound-retry-result.json) · [Cloudflare](cloudflare-retry-result.json) · [OpenAI](openai-retry-result.json) · [Keychain 恢复](keychain-restored-result.json)
