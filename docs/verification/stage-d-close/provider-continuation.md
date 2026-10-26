# 单家止损续验：Pexels与豆包固定样本通过，Google403停止

2026-10-25，Asia/Shanghai。固定优化worktree，HEAD `bca697bbc1e12626771d1283ec87a17bf85f02fe`。

**按用户澄清的「单家失败只停该家，其余继续」完成本轮三家续验。** Pexels完成剩余媒体任务/产物/回写围栏/重绑复验；豆包完成资格、实际语音任务、产物、围栏和重绑复验；Google首次资格返回403，只停止Google，不重试。Freesound的原401保持，Freesound/Cloudflare/OpenAI均未新增请求。[验收摘要](evidence/provider-continuation/verification-result.json)

## 累计预算与不可变承接

用户明确要求前后累计不超过17次、总费用不超过2元，不重置旧账本。本轮没有把原全局停止账本的 `halted:true` 改回false，也没有清除任何次数、金额或事件：原账本仍是已用2次、预留0、停止。

为落实新停止规则，每家串行使用一份续验账本：先正式停止上一家的应用与全部Worker，核对自建PID已退出；封存上一家的状态，再将累计used、费用、byOperation、全部事件及父策略/状态SHA继承给下一家。新策略只允许当前这一家，其余家不在Provider列表；Freesound历史已用配额保留且不再可用，Cloudflare/OpenAI仍0配额。每家结束均封存，成功也关闭后续请求；不并行分叉，不退款，不接管遗留request.lock或在途reserved事件。

| 记录 | 累计请求 | 累计费用预留 | 封存状态 |
| --- | ---: | ---: | --- |
| 原全局停止账本 | 2 | ¥0 | 原字节不变，保留Freesound401 |
| Pexels续验账本 | 5 | ¥0 | 已停止全部自建进程并封存 |
| Google续验账本 | 6 | ¥0 | 保留403，已停止并封存 |
| 豆包续验账本 | 9 | ¥0.03 | 已停止全部自建进程并封存 |

累计数应取最终9次，或按增量 `2+3+1+3=9` 计算，不能把各阶段累计快照再次相加。全局上限始终17次/2元；剩余请求没有用于重试或探路。费用为声明的保守预留，**未查询实际平台账单，不能将¥0.03称为实际扣款**。沿用前次已核对的同日价格与语音≤10字符限制，不购买套餐、不充值、不新增订阅。

离线续账检查直接调用现有生产预算端口，传输仅用内存Response：继承16次后只允许第17次，第18次拒绝，换下一家仍不能绕过17次；父状态SHA保持。该夹具不是实际请求或在线资格。[离线预算检查](evidence/provider-continuation/carry-offline-result.json)

## 正式入口与固定输入

本轮没有修改产品源码、SQL源码、超时或断言。沿用已核验的Pexels v1路径、预算端口、正常 `npm start/stop -- --deployment …`、`createNativeApplication`、Owner HTTP、真实Keychain、真实原生Worker CLI和同一隔离PG/媒体。既有807/807结果对应的产品源码字节未变，因此不重复完整回归；新增验证为续账离线检查及本轮真实端到端执行。

规划器只用本机固定脚本和自供PNG准备视觉/分镜输入，拒绝TCP/HTTP，不调用在线Codex或其他规划服务，不能据此宣称规划模型质量通过。媒体/语音部分确实调用对应Provider，使用当前固定连接版本和共享跨进程账本。每家独立固定样本，不从已失败家自动改模型、换Key、重试或切换Provider。

为避免误消费历史队列，准备时记录并暂时关闭85个既有原生样本的调度enabled开关，仅让本轮新样本运行。完成后恢复这85个原值，本轮新样本退出调度；5503个既有任务行逐行哈希不变，没有修改claimed_at、租约、时钟、历史任务结果或SQL迁移。[运行数据保留](evidence/provider-continuation/history-runtime-preservation-result.json)

## 三家实际结果

| Provider | 本轮新增请求 | 结果与边界 |
| --- | ---: | --- |
| Pexels | 3：搜索1、下载1、重绑复验1 | 复用此前真实资格，不额外重复首次探针。真实Worker下载20秒MP4、1290222字节；满足冻结最短4秒要求，FFmpeg完整解码及HTTP产物SHA一致。不是裁成4秒的视频，也不是最终成片验收 |
| Google TTS | 1：声音目录资格 | Provider HTTP403，native返回live/invalid/ready=false。只停止Google，未合成、未重绑复验；不能仅据403断言一定是Key填错 |
| 豆包TTS | 3：短句资格1、任务合成1、重绑复验1 | `seed-tts-2.0` / `zh_female_vv_uranus_bigtts`，实际任务文本「这是一条测试。」。真实Worker得到1.224秒MP3、9837字节，FFmpeg完整解码及HTTP产物SHA一致 |

Pexels和豆包分别完成以下本地检查，不新增Provider请求：核对唯一媒体任务与实际产物；使用真实task_run原租约token，在任务完成后再次调用正常回写端口，迟到结果被拒绝，任务行保持；然后使用同一Keychain秘密对同一固定版本做正式HTTP rebind，核对资格先清零，再用1次实际探针恢复资格。真实Key没有导出、复制到.env或回显。任务的 `tasks.attempt=1` 是领取计数，实际Worker attempt索引为0；早期回执标签写成workerAttempt的原文私有保留，后只纠正标签，不改数据库。

[Pexels结果](evidence/provider-continuation/pexels-result.json)、[Pexels迟到围栏](evidence/provider-continuation/pexels-late-result-fence-result.json)、[Pexels重绑](evidence/provider-continuation/pexels-rebind-result.json)、[Google403](evidence/provider-continuation/google_tts-qualification-result.json)、[豆包结果](evidence/provider-continuation/volcengine_tts-result.json)、[豆包迟到围栏](evidence/provider-continuation/volcengine_tts-late-result-fence-result.json)、[豆包重绑](evidence/provider-continuation/volcengine_tts-rebind-result.json)。

三家实际新增7次，加前次2次为9次。按Provider累计为Pexels4、Freesound1、Google1、豆包3、Cloudflare0、OpenAI0。新增网络记录仅含host/method/进程/阶段，不含认证头、查询串、正文或Cookie；Pexels与豆包都观察到应用进程探针和真实Worker进程共用计数。Google失败没有阻止豆包执行，符合本次澄清后的规则。

## 收尾与未关闭范围

各在线阶段全部停止并封存；原闭网录入服务已恢复，`networkAvailable:false`、`externalReady:false`，没有Worker。真实凭据保留Keychain；新样本媒体、任务/审核/运行数据及私有原始证据保留，公开只列脱敏结果与文件身份，不公开实际视频/语音内容。当前资格记录为Pexels与豆包true、Google false；闭网录入状态不等同在线执行已开启。[闭网状态](evidence/provider-continuation/closed-final-result.json)

旧1065公开/1612私有SHA在开始前逐项一致，收尾仍核对；原报告与原账本不追认、不清零，活动旧报告另存原文。43个无关文件、根PLAN、HEAD保持，暂存区为空。全局停止阶段Freesound401、Cloudflare材料格式不兼容、OpenAI缺Key、历史5秒红测、模型首次30秒冷启动失败、120秒诊断不算验收、错误正文高分`.838`反例、T21当时740/745、旧Pexels耗尽预算及其他既有门禁全部保留。

收尾审计同时核对全部索引文件身份、累计事件链、真实Worker进程请求、当前闭网服务、相对链接和私有文件Git忽略状态。6个已保存真实凭据值的原文、URL编码及Base64形式均未命中公开材料或本轮额外私有文本；本轮测试的三个固定版本仍可从Keychain解析。首次审计脚本误把所有历史绑定都当作应可解析，触发断言；修正为逐一统计不可解析历史/空绑定，同时严格要求6个真实值及三个测试版本可解析，原失败检查另存，产品未改。[收尾审计](evidence/provider-continuation/package-verification-result.json)、[首次审计检查记录](evidence/provider-continuation/audit-initial-check-note.json)。

本轮只验收所列Pexels视频样本与豆包短句样本；没有关闭Freesound401、Google403、Cloudflare材料组合、OpenAI缺Key，或完整六家/任意模型输入质量、容量/性能、默认生产部署、新主机/OS冷启动、任意错误正文检测、秒级接管等门禁。既有裸npm test误收集历史源码副本问题、锁网轮换按钮P3文案仍未修复；其他已有狭义验收结论不扩大。本轮Google失败没有重试，后续应先核对权限/服务启用/鉴权材料与方式，另行决定重测。

报告采用tech-doc-style-chinese组织，保留事实和限制；不提交、不推送、不进入E/F，SQL一致性建议继续暂缓。[完整证据索引](evidence-index.json)
