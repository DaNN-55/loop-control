> 后续续验（2026-10-25）：Owner已明确改为「单家失败只停该家，其余继续」。旧2次/停止账本保持原样，新账本逐家继承累计计数与全部事件；最终累计9次、预留0.03元。Pexels剩余与豆包固定样本验收通过，Google资格403后停止。原文所述第2次全局停止是当时阶段事实，详见[单家止损续验](provider-continuation.md)及[本报告当时原文](provider-online-acceptance-before-continuation.md)。

# Pexels 路径对齐与有限在线验收：第2次请求后停止

2026-10-25，Asia/Shanghai；固定优化 worktree，HEAD `bca697bbc1e12626771d1283ec87a17bf85f02fe`。

**Pexels 官方 v1 路径已离线对齐，真实资格探针通过。随后 Freesound 返回401，按用户「失败即停」要求停止；本轮共2次 Provider 请求，没有重试。** Google与豆包未执行；Cloudflare因本机保存材料不符合单条组合格式而零请求跳过，OpenAI缺Key继续跳过。没有派发媒体/语音任务，没有实际生成、下载或重绑复验通过结论。[验收摘要](evidence/provider-online-acceptance/verification-result.json)

## 授权、上限和停止条件

用户授权先离线对齐Pexels并验证，再执行五家最多17次、总费用上限人民币2元；Cloudflare若仍失败则与OpenAI一样跳过、先测其他；其他失败即停。不提交、不推送、不进入E/F，SQL一致性建议继续暂缓。

本轮先本机核对当前连接与Keychain，不输出真实凭据。四家当前版本可取用；Cloudflare存在多个单段条目，没有一条符合生产探针要求的 `Account ID:API Token` 组合。格式检查按实际探针的split/trim规则复核；没有将分开的材料自动拼接、覆盖秘密或在线试错。依据用户跳过授权，将Cloudflare与OpenAI都设为0请求。四家操作配额合计14次，全局上限仍为17次，未分配的请求不用于重试。

新建独立 `provider-network` 批准策略及账本，绑定批准文本与本日已核对官方价格摘要的SHA；币种CNY，费用上限2,000,000微单位（2元），有效期1小时。原离线准备的关闭策略与零账本完全保留，不重置旧T15或先前任何账本。实际API请求仍由正式工厂探针经共享预算发送，发送前持久预留，失败后停账本，不回退次数。

费用沿用本日官方价格核对：Pexels免费；Freesound仅限本机非商业技术预览验收，商业授权未处理；Google标准音色$4/百万字符；豆包2.0官方计费索引¥3/万字符。美元项目按$1折算¥10作为保守预算口径，并非市场汇率。四家完整计划的Google生成预留¥0.01、豆包三次各¥0.01，共¥0.04；不是实际账单计量。本轮只到Pexels/Freesound元数据探针，**账本预留0元，未调用收费生成接口，也未查询平台账单或免费额度**。不购买套餐、不充值、不新增订阅。

价格来源：[Pexels](https://help.pexels.com/hc/en-us/articles/47677890260761-Is-the-Pexels-API-free-to-use)、[Freesound条款](https://freesound.org/docs/api/terms_of_use.html)、[Google](https://cloud.google.com/text-to-speech/pricing)、[豆包](https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh)、[Cloudflare（本轮跳过）](https://developers.cloudflare.com/workers-ai/platform/pricing/)。Cloudflare上一方案的金额预留没有变成实际配额；本轮没有对其发请求。

## 最小路径修改与离线验证

将正式 `providerProbe`、预算端点白名单、`mediaProviders`实际视频搜索和已有 `runtimeProbes`的Pexels搜索统一为 `/v1/videos/search`，更新相同接口的精确路径断言。没有保留旧路径自动回退、跟随重定向或追加探路请求；原历史探针与证据不改。迁移依据为[Pexels官方说明](https://www.pexels.com/api/documentation/)。

探针路径断言先红后绿；执行器路径断言另先红后绿。最终相关4文件51/51，实际产品全量105文件807/807，默认每测5000ms不变；构建、真实Worker/编排准备、本地服务编译通过，Node2通过1既有跳过。没有调大模型30000ms检查、改变正文阈值、修改SQL或降低断言。[全量日志](evidence/provider-online-acceptance/full-default-01.log)、[范围](evidence/provider-online-acceptance/scope-result.json)

首次路径红测还被Vitest误匹配到公开证据中的同名 `.test.ts` 源码副本，出现额外suite缺模块；第一次绿测中实际产品断言已通过，但档案副本仍导入失败。两份原始失败都保留。随后验收命令显式排除 `docs/verification/**/source/**`，实际产品105文件和807条断言完整保留，仍排除原有私有历史副本和既有integration范围。本轮没有修改Vitest配置；**裸 `npm test` 对历史证据副本的发现问题未修复，不能据本轮命令宣称该入口完整通过。** 新证据源码均以 `.txt` 归档，避免继续扩大该问题。

首次本机凭据预检未取到Pexels秘密，显式解锁专用Keychain后四家可取用；失败前未采集锁状态，不能独立证明自动上锁原因。该步骤未调用Provider。前端构建按既有行为清理dist后，纯策略预检曾报模块不存在；经正式runtime准备与本地编译恢复，未跳过完整性校验。初始新策略草稿对零配额generation使用零费用元数据，被现有严格校验拒绝；在首次传输前保留草稿原文，只为禁用操作补正费用元数据，配额仍0、Provider仍排除，已用计数仍0，没有放宽校验。[配置预检](evidence/provider-online-acceptance/policy-preflight-result.json)

## 真实探针结果

通过正常 `npm start -- --deployment …`、`createNativeApplication`、Owner HTTP命令与真实Keychain执行，没有另建替代资格服务器，也没有把模拟响应写成live资格。在线入口不装配Worker，避免自动消费队列；没有调用在线规划器。

| 顺序 | Provider | 实际结果 | 累计请求 | 结论 |
| --- | --- | --- | ---: | --- |
| 1 | Pexels | Provider HTTP200；3119字节；native返回live/verified/ready=true | 1 | 仅当前连接版本的元数据资格通过；未搜索执行任务、下载或验证可播放产物 |
| 2 | Freesound | Provider HTTP401；26字节；native返回live/invalid/ready=false；账本halted=true | 2 | 当前材料与现有鉴权请求组合未被服务接受；停止，不重试 |
| — | Google TTS | 未调用 | 2 | 未验收 |
| — | 豆包TTS | 未调用 | 2 | 未验收 |
| — | Cloudflare | 本机组合格式不兼容，0请求跳过 | 2 | 未验收，不称服务端鉴权失败 |
| — | OpenAI | 缺Key，0配额、0请求 | 2 | 未验收 |

[逐步资格回执](evidence/provider-online-acceptance/qualification-result.json)、[停止与网络对账](evidence/provider-online-acceptance/network-stop-result.json)。native HTTP命令本身返回200是命令已处理，不代表Freesound通过；401取自真实Provider响应。脱敏网络记录仅两条，目标为 `api.pexels.com` 和 `freesound.org`，与账本的 `pexels.verify` / `freesound.verify` 两次预留及完成/失败事件一致。

前次只读复查发现的P3文案仍未处理：锁网时「轮换认证版本」按钮仍写「创建新版本并测试」，实际会跳过测试。本轮不修改该文案；新增连接仍使用「仅保存凭据」。

Freesound401不足以区分凭据类型/内容、账户状态或适配器鉴权方式不符。本轮不进一步在线探测，不替换认证材料，也不将剩余预算当作继续重试授权。需要后续先核对鉴权路径与材料类型，再另行决定重测。此次失败不意味着Google/豆包失败；它们尚未执行。

## 收尾、凭据与保留范围

Freesound失败后立即通过正式 `npm stop` 关闭在线配置，账本保留 `used:2`、`halted:true`，费用预留0；然后恢复原 `--offline-test` 闭网录入配置，便于Owner后续在页面维护凭据。当前页面 `networkAvailable:false`、`externalReady:false`，没有Worker或任务派发。原始日志通过私有轮转保留，旧索引所指历史日志路径恢复原字节；当前活动闭网日志另存，不作为不可变证据持续索引。[当前闭网状态](evidence/provider-online-acceptance/closed-final-result.json)

真实API Key保留在专用Keychain；本轮未额外保存明文Key，没有.env、HAR、输入截图、认证头、请求正文或带token查询串归档。Provider请求只经受控端口发给对应服务；脱敏网络记录只有host/method。Owner/数据库密码、Cookie/CSRF及私有配置不公开。公开材料与源码在收尾用本机秘密及常见编码形式做精确扫描，结果见最终打包核验。

更新前逐项验证旧1013份公开、1525份私有SHA全部一致。活动旧README/review、离线准备报告另存原文，旧followups和门禁对象保留；43个无关文件、根PLAN、HEAD不动，暂存区为空。模型首次30秒冷启动失败、120秒诊断不算验收、错误正文高分`.838`反例、T21当时740/745、历史默认5秒失败、旧Pexels两次已耗尽预算、恢复资格清零等全部保留，不以本次Pexels资格通过追认历史运行。

**本轮没有完成四家或五家的在线完整链路。** Pexels媒体执行/产物/在线重绑、Freesound401、Google/豆包未执行、Cloudflare材料格式、OpenAI缺Key、完整多能力Worker、档案副本的裸测试入口发现问题、新主机/OS冷启动/默认生产部署、任意正文错误检测、真实通知、容量/性能/切换回退等仍开放。当前已完成的5秒资源策略、自然30分钟租约、指定环境WhisperX和当前主机默认入口的既有狭义结论不扩大。未提交、未推送、未进入E/F，SQL一致性建议继续暂缓。[完整索引](evidence-index.json)
