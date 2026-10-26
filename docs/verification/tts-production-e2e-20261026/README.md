# TTS 策略修复与普通多镜头全流程

日期：2026-10-26。结论：TTS 限制已修复；使用当前完整源码完成了三镜头普通长度视频的隔离功能全流程、过程产物核验、最终发布包校验及重启读回。过程中有显式故障恢复和一次人工对齐，不能记为无人干预运行；素材画质、选片和字幕换行仍有改进项。

验收时分支 `codex/ad-closeout-implementation`，HEAD `bbd2987cd61d3444dca962e50d91b11ed1da5fca`，包含当时既有未提交/未跟踪实现。验收阶段未暂存或提交；后续本地归档授权见下一节。未推送、合并、修改 GitHub 或切换生产。Google TTS、Freesound、Cloudflare、OpenAI 继续保留 Owner 豁免，本轮真实请求均为 0；E/F 继续搁置。

## Owner 查看与本地提交授权

Owner 已查看本轮生产单，确认素材清晰度、第三镜头与字幕问题可通过后续设置调整，不阻塞本次分批本地提交。该决定不改写下面的实测观察、Agent QC 身份、人工对齐或 Provider 豁免；本轮不追加质量修复。服务已随后按 Owner 要求重新打开并保持运行，前文及资源收尾证据中的停止状态属于验收结束时点。

当前已授权分批本地提交，未授权推送或合并；具体提交记录见[工作区分批归档](../workspace-commits-20261026.md)。下文原始快照和日志保留当时 HEAD 及“未提交”的历史状态。

## 修复及回归

普通 TTS 通过新批准策略的 `operations.google_tts.generate.tts` / `operations.volcengine_tts.generate.tts` 声明最大字符数、允许音色和语言/资源集合，不再统一限定 10 字及一个音色。`maxCharacters` 为 1–5000 个 Unicode 字符，原请求正文 16 KiB 限制同时生效；缺少 `tts` 的历史策略继续保持原验收范围。新规则在发送与费用预留前检查，原预算、SHA 绑定、闭网、结果未知和停账本机制保留。[部署说明](../../local-native-deployment.md#普通长度-tts-的批准策略2026-10-26)

真实 E2E 首轮另复现了 13,326,115 字节 MP4 的 Base64 导入导致重复正则栈溢出、接口 503。最小补修改用解码后规范 Base64 回编码比较，保留原路径和 100 MiB 材料上限，同时拒绝非规范编码。

| 检查 | 结果与证据 |
| --- | --- |
| TTS 先红后绿 | 两项普通文本/另选音色用例先失败；最终 Provider 网络 39 项及资格探针 26 项共 65/65。[红测](tts-policy-red.log)、[最终聚焦检查](tts-policy-focused-03.log) |
| 大材料导入 | 真实文件系统及 13 MB 内容逐字节检查，8/8。[有效红测](media-import-red-02.log)、[最终绿测](media-import-green-02.log) |
| 完整源码回归 | 113 文件、925/925，默认 5000ms 未改；Node 2 通过、1 项既有 n8n SDK 条件跳过。[原始日志](test-final-04.log) |
| 编译与构建 | TypeScript 项目、本地应用编译和原生构建通过。[检查状态](checks-result-04.json)、[构建日志](build-final-03.log) |
| 独立只读审查 | TTS 与 Base64 补修均无剩余阻断；未引入新依赖。初次“新增授权 CLI”建议经核对既有批准流程后撤回 |

保留测试过程失败：首次材料测试缺少导入函数；随后复现原栈溢出与非规范编码缺口；首个 green 使用大 Buffer 深比较造成超时，一轮全量也出现超时。将比较改为等价的 `Buffer.equals` 后，默认预算最终全量通过，没有放宽超时或删断言。[首次材料测试](media-import-red.log)、[慢比较结果](media-import-green.log)、[该轮全量](test-final-03.log)。原始日志不改写。两条 React `act` 提示和 590.47 kB bundle 提示保留。

## 源码与隔离身份

首轮快照为 728 文件，聚合 SHA `470241153e26bd647bd158a69433ee77f2d644ed65efc363d10442f8472fe6dd`；首轮因导入故障失败，不记为全链成功。[首轮快照](source-frozen-before-e2e.json)

Base64 补修后，从新的数据库、媒体和 Episode 重新开始，未复用首轮成功产物。第二轮开始前固定 `src`、`scripts`、`db`、历史迁移、n8n 兼容文件和根构建配置等全部 728 个源文件，包含未提交与未跟踪代码；聚合 SHA：

`afc8a44b2413eedbe695fa4162a821a0792949a402254dd970db89058ddcbc00`

[第二轮源码清单](source-frozen-before-e2e-02.json)与[收尾逐文件字节/SHA 核验](source-after-e2e.json)全部一致。本轮后续只修改驱动、文档和证据，未在第二轮中途更换应用源码；HEAD 不能代替工作区身份。

使用独立恢复数据库 `loop_t24_restore_ttsproduction20261026_02`、APFS 媒体、测试 Owner、专用网络账本与普通 `npm start -- --deployment …` 入口。原数据库 51 表、28,620 行的 COPY 内容指纹在结束时仍与备份相同；更早账本、首轮策略/账本/CLI 和未知请求孤锁均未改动。[准备](e2e-02-preparation.json)、[保留对象核验](root-final-preservation.json)。生产目录及服务未用于本次写入。

## 全流程结果

Episode：`86f722d2-3675-4732-a8cd-d4276af51e7c`。脚本为森林、河流、山峦三个镜头，口播分别 70、75、76 字，总计 221 字。视觉规划及分镜由真实 CLI 生成，主 Agent 对照冻结输入逐项检查，审核通过正常测试 Owner API 完成。[分镜核验](root-storyboard-review-02.json)、[浏览器分镜](browser-three-shot-storyboard.png)

| 阶段 | 实际结果 |
| --- | --- |
| 素材 | 三路 Pexels 搜索/下载完成，13,326,115 / 19,136,325 / 2,117,738 字节材料均经正常 Base64 接口导入成功；下载原件、导入件和后续裁剪的关联及指纹已检查 |
| 普通 TTS | 三路豆包真实生成，文本未截短；MP3 分别 15.648 / 15.888 / 15.264 秒。[生成结果](e2e-long-tts-result.json) |
| 剪辑与对齐 | 按各路真实音频时长裁剪，不循环凑时长。三路真实 WhisperX；前两路自动完成，第三路低置信度保留，显式人工对齐接续，见下文 |
| 字幕与预览 | 221 字在三路字幕中完整保留；正文、音轨和对齐输入指纹相符，均确认预览。三路代理完整解码，1080×1920；音频与原 TTS 相关系数约 0.987 / 0.990 / 0.990，约 43ms 编码偏移。[字幕核验](root-caption-checks.json)、[预览媒体](root-preview-media-checks.json)、[音频比较](root-preview-audio-comparison.json) |
| Studio | 真实打开 OpenChatCut，3 路视频、3 路 TTS、3 个字幕轨；正常工程写入将首路音量从 1 改为 0.9，读回一致。[浏览器截图](browser-studio.png) |
| 审核与 QC | 正常生成审核视频，逐路抽帧、全文件解码、黑帧检测、完整音频相关检查；Chrome 从头播放到结束且无媒体错误。按授权由 Agent 使用测试 Owner 正常 API 批准 QC，不声称真人观看或听音。[播放](browser-qc-playback.json)、[音频/字幕](root-qc-audio-and-captions.json)、[黑帧](root-qc-blackframes.json) |
| 最终视频 | 冻结工程和导出条件相同，复用已审核视频，SHA 与审核视频一致；46.848 秒，1080×1920、30 fps，H.264 + AAC，136,047,301 字节 |
| 发布包 | 正常接口生成包，重复同幂等键返回相同结果，Episode 进入 `production_completed`。包含 final_render、cover、metadata、final_qc_report；可移植副本再次调用正式 `verifyPublishPackage` 通过 |
| 最后读回 | 39 件产物逐件磁盘/Owner HTTP 大小与 SHA 一致，媒体全量解码通过。普通服务重启后 Episode、产物、任务/运行/草稿/音轨/审核记录均不变，无待执行/运行任务；最终视频与 manifest HTTP 再读一致，Provider/CLI 零新增。[39 件产物](root-artifact-inspection-production_completed.json)、[发布包](root-final-package-verification.json)、[重启读回](root-restart-readback.json) |

最终视频 SHA-256：`6d126321a3939a379037047ef67d0b8f56187613f6541d09b5381f389fd291d4`。

可直接查看[最终视频](../../../output/tts-production-e2e-20261026/final.mp4)；可移植发布包位于[发布包 manifest](../../../output/tts-production-e2e-20261026/publish-package/episodes/86f722d2-3675-4732-a8cd-d4276af51e7c/publish-package/manifest.json)所在目录树。该包只在本机生成，未上传或发布到外部平台。

## 中断与人工接续

1. 首轮在材料导入失败后停止；停止时第三个 Pexels 搜索已预留但无确定响应，账本和孤锁原样保留，不退款、不自动重试。第二轮为明确故障补修后的新样本，新账本以父策略/账本 SHA 继承首轮已用计数，旧任务未重派。[首轮停止记录](e2e-progress-at-media-stop.json)
2. 第二轮本机 PostgreSQL SSH 转发进程退出，导致应用 503；真实视觉规划 CLI 已成功落盘，但未登记。确认旧进程不存在、结果/输入指纹及既有有效租约后，保留原 staging 和孤锁，使用正常原生产物发布器登记该真实结果；未生成替代文件、未新增 CLI 调用。通过普通准备入口恢复专用转发后继续。[转发证据](e2e-native-tunnel-recovery.json)、[结果登记恢复](e2e-interrupted-visual-recovery.json)
3. 第三镜头一句自动对齐平均置信度约 0.679，低于原 0.72 阈值，原 `needs_review` 产物保留。Agent 核对音轨/正文 SHA、完整 cue 文本、顺序、时长边界和波形后，通过正常 `saveManualAlignment` 保存当前时序，再做正文/预览确认。未降低模型阈值；不将能量或文本检查等同于真人听音或独立 ASR 的语义验证。[第三路检查](root-shot3-alignment-review.json)、[波形](root-shot3-waveform.png)

上述人工接续是本次功能流程证据的一部分，不是零干预可靠性或任意故障自动恢复证明。

## 仍存在的问题与建议

| 问题 | 本次证据与影响 | 建议方案（本轮未扩大修改） |
| --- | --- | --- |
| 原素材分辨率低 | 两路 360×640、一路 240×426；1080×1920 成片来自上采样，不能当作真实高清细节 | Pexels 选文件目前使用第一个满足竖屏条件的 MP4（`src/worker/mediaProviders.ts:125`）。应按目标分辨率/宽高比排序并设置最低源分辨率，预算不足时明确阻塞或提示降级，不能静默用低清源 |
| 第三镜头选片不完全符合要求 | 山顶画面含建筑及游客，不是测试要求的无人物纯自然景观 | 检索后增加候选预览与选片确认/语义检查，在下载和后续渲染前拒绝不符素材 |
| 字幕存在孤字换行 | 第二镜头“树木。”末字落到第二行；文字完整且在安全区，但排版不佳 | 在现有字幕布局中增加中文词组/标点与孤字约束，重新核对代表性帧 |
| 对齐与语义仍需审核 | 一路低置信度须人工接续，本轮没有真人听音记录 | 保留低置信度门禁，人工核听并确认该句；后续再评估更好的对齐/切句，不能直接降阈值放行 |
| 转发中断后需人工恢复 | 本次失去 loopback 数据库转发，已恢复并完成；尚未证明无人值守恢复 | 另行补充转发进程存活监测、受控重建及中断产物登记恢复验收；保持租约和未知请求围栏 |

[内容质量观察](root-content-quality-observations.json)。本轮证明的是当前已准备主机上的功能链路和文件交付完整性，不能外推商业成片质量、任意新硬件部署、总体容量或全部 Provider 通过。

## 调用、资源与文档收尾

两轮累计预留 18 次请求：17 次有完成响应，1 次首轮搜索结果未知；第二轮新增 11 次请求均完成（账本 22 个事件是各一次 reserved/completed，不是 22 个请求）。累计费用预留 0.47/1 元，未查询实际账单。真实 CLI 累计 4 次、251,588.087ms，低于 300 秒上限。原失败与未知结果没有清账。[累计账本摘要](root-final-preservation.json)

预算引用的[豆包官方计费](https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh)与[Pexels 官方说明](https://help.pexels.com/hc/en-us/articles/47677890260761-Is-the-Pexels-API-free-to-use)只作为声明预留依据，不是实际扣款证明。

本次 Chrome 会话及测试应用/Studio（55189/55190）已正常停止，专用 Keychain 恢复原锁定状态；隔离数据库、媒体、过程证据和发布包保留。原库 51 表内容与旧账本均未变。[资源收尾](root-resource-closeout.json)

规格、票单索引及 25 票同步本次实际结果；75 条原 AC、依赖与映射保留，73 项已勾选，T18 首项及 T19 第三项仍未勾选，四家豁免未改为技术通过。相关状态见[规格](../../specs/local-first-optimization.md)及[票单索引](../../specs/local-first-tickets/README.md)。未在本轮重跑全部历史 SQL、容量压力或新硬件安装验收，不以旧证据冒称新执行。
