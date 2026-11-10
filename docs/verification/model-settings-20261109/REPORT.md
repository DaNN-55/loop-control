# 图片、视频和配乐 API 核对与修复

2026-11-09；日常服务已更新至 `234cb4743676`，HTTP 200，队列空闲。保留已有未提交修改；未提交、推送或修改用户连接／默认模型，没有自动采用测试产物。

## 已修改

1. 素材区按当前主脚本 ID 只展示一版，历史版本保留。
2. 新的同镜头、同类型任务创建后收起旧失败；未完成核对的未知提交和待发布产物仍提示。仅打开确认或取消不会隐藏旧失败。
3. 修复 Kling V3 首尾帧：序列化器写入 `image_tail`，网络准入原来禁止该字段；现在用真实序列化器核对请求并支持两帧的合法总体积。
4. 修复百炼两个官方结果域名被拒绝：`dashscope-f4de.oss-accelerate.aliyuncs.com`、`dashscope-7c2c.oss-cn-shanghai.aliyuncs.com`。来源为认证任务查询结果；同步执行下载校验、网络准入与路由。两条任务仅恢复下载，没有再次生成。
5. 图片、百炼保留脱敏的供应商错误码、消息和请求号；供应商内部堆栈压缩为有用错误。视频产物不足时显示实际与要求时长；不再被外层通用错误覆盖。

## 在线结果

注册目录共 20 个生成模型，逐个在线调用检查；14 个本轮新产物均经 ffprobe 读取，另复用用户的成功 MiniMax。7 个图片模型、7 个百炼模型以及 MiniMax 成功；5 个因供应商账户或执行问题未通过出片，不能宣称全部模型可用。

| 模型／服务 | 结果 | 端到端抽样 | 说明 |
|---|---|---|---|
| wan2.2-i2v-flash | 成功 | 36.4 秒 | 原任务下载恢复，无重复 POST |
| wan2.2-i2v-plus | 成功 | 56.5 秒 | 原任务下载恢复，无重复 POST |
| wan2.5-i2v-preview | 成功 | 56.4 秒 | 最小规格单次 |
| wan2.6-i2v | 成功 | 56.7 秒 | 最小规格单次 |
| wan2.6-i2v-flash | 成功 | 178.5 秒 | 最小规格单次 |
| wan2.6-r2v | 成功 | 77.4 秒 | 最小规格单次 |
| wanx2.1-i2v-plus | 成功 | 301.2 秒 | 供应商生成约 294 秒 |
| wanx2.1-i2v-turbo | 供应商失败 | 127.5 秒 | AlgoError：供应商插帧执行 TypeError；未重提 |
| freesound-preview | 成功 | 2.2 秒 | 最小规格单次 |
| kling-v3 | 供应商拒绝 | 1.6 秒 | HTTP 429 / 1102：API 余额不足 |
| kling-v3-omni | 供应商拒绝 | 1.7 秒 | HTTP 429 / 1102：API 余额不足 |
| MiniMax-H3 | 成功（复用已有） | 107.8 秒 | 用户已完成任务，未新增费用 |
| gpt-image-2 | 成功 | 13.2 秒 | 最小规格单次 |
| gpt-image-2.5-flare | 成功 | 9.8 秒 | 最小规格单次 |
| gpt-image-2.5-flare-2026-09-08 | 成功 | 11.2 秒 | 最小规格单次 |
| gpt-image-2.5-sunburst | 成功 | 9.4 秒 | 最小规格单次 |
| gpt-image-2.5-sunburst-2026-09-08 | 成功 | 9.8 秒 | 最小规格单次 |
| gpt-image-2.6-flare | 成功 | 5.8 秒 | 最小规格单次 |
| gpt-image-2.6-sunburst | 成功 | 21.5 秒 | 最小规格单次 |
| pexels-video | 成功 | 1.2 秒 | 最小规格单次 |
| doubao-seedance-2-0-260128 | 供应商拒绝 | 0.4 秒 | HTTP 404：账号未开通模型 |
| doubao-seedance-2-5-260628 | 供应商拒绝 | 0.3 秒 | HTTP 404：账号未开通模型 |

这只是各型号一次最小规格实测。单次耗时不是稳定性或平均性能承诺。Seedance 需要在原账号开通对应模型；Kling 需要可用于 API 的余额；Turbo 的 AlgoError 发生于供应商内部。未购买充值、替用户开通服务、改默认选择或反复付费重试。

## 参数覆盖

见 [COVERAGE.md](COVERAGE.md)：图片 2,400 组、百炼 620 组合法设置，其他官方视频全部模式、数量上限、三种比例、参考视频来源及非法字段；同时通过真实 Owner HTTP、数据库快照、Worker 和网络准入验证 13 个视频型号。所有图片型号的参考图、质量和快照有集成覆盖。

配乐是 Freesound 音乐／音效检索；实际在线检索通过，音乐和音效的连接、检索条件、候选、默认项、位置／偏移等本地控制经过相关集成测试。用途、音量、裁切、压低配乐属于本地工程处理，不会误传成供应商生成字段。

在线测试复用现有 Keychain，使用测试图片和官方公开参考图，不发送用户人物素材或提示词给其他供应商；测试产物在临时恢复目录，没有写入用户生产单。

## 费用

用户授权上限 ¥30。按成功任务的供应商返回时长、图片 token 与公开单价估算新增约 **¥14.28**，未核对实际账单／赠额抵扣；不含用户已有 MiniMax 请求。

持久化账本见 `live-results.json`。调度预留累计 ¥31.51，其中未开通模型的两次 404 未创建生成任务，释放 ¥4.50；剩余保守费用上限 ¥27.01（还包含余额不足拒绝的预留），低于 ¥30。下载恢复无新增生成费用；首轮 runner 检测已有账本会拒绝重跑。

价格依据：[OpenAI 图片成本](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)、[阿里云模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[Wan 2.1 Plus](https://help.aliyun.com/en/model-studio/wanx2-1-i2v-plus)。OpenAI 美元金额按 ¥7.2/USD 估算，供应商账单汇率可能不同。

## 验证结果与范围

- 类型检查、前端／后台／Worker 构建、准备产物完整性检查通过；日常服务正常。
- 最终定向 79 项通过；修复后的 7 文件、23 项 Owner HTTP／Worker 集成通过；另一个真实短产物错误集成通过。
- 第一轮图片 2.5／2.6、4 张参考批量与冻结估价集成均通过。
- 全量默认测试最终 1,831 项通过、1 项既有跳过，1 项搜索输入同步的时序断言失败；单文件复跑（连同媒体契约）18 项通过。本轮未改搜索代码。未把这一轮写成全量绿色。
- 广域 `workspaceAudio.integration.test.ts` 有 3 项既有失败：零费检索前的旧授权断言、扩展联动独立原声的范围、删除后完整字幕的保护。失败发生在本轮未修改的前置命令检查；没有放宽这些保护来让旧场景通过。相关配乐／音效设置集成另外已通过，原始日志在 `integration-initial.log`。
- 实际 1427 和 640 像素浏览器：脚本 1 份、旧失败 0 条、无横向页面溢出；已恢复视口。保留用户视频候选及当前输入。

## 如何检查

1. 刷新当前“测试222”分镜台：本期素材只显示一个 `script.md`，仍保留两张图片及已生成视频。
2. 正常发起下一次生成后，上一条已明确失败的提示收起；取消确认不会误隐藏错误。未知请求仍必须核对，不能通过隐藏提示绕过。
3. 点开视频的输入模式，Kling V3 的首尾帧不再由本机拦截；但当前 Kling 余额不足，出片仍需先解决原连接余额。
4. 在现有连接里选 Seedance 或 Kling 时，供应商拒绝会显示具体未开通／余额原因。不要为检查界面而反复付费生成。
5. 需要重新运行免费参数检查：`npx vitest run src/worker/modelSettingsBoundary.test.ts src/worker/officialVideoErrors.test.ts src/local-app/WorkspaceMaterialShelf.test.tsx src/local-app/WorkspaceVisualFeedback.test.tsx`。

## 生成速度建议（尚未修改）

供应商记录显示百炼排队仅 0.039～0.067 秒，主体耗时在模型生成，无法靠前端提速消除。最慢的旧 Wan 2.1 Plus 本次生成 294 秒，端到端 301 秒；Flash 2.6 本次生成 174 秒，因此不能只凭 Flash 名字假定更快。

1. 草稿图片可优先试 2.6 Flare 的低质量单张，本次 5.8 秒；2.6 Sunburst 本次 21.5 秒。先预览草稿、确认提示词再做正式规格。不要据一次抽样自动改默认。
2. 视频先用短片段检查动作和人物一致性，通过后再做目标长度；使用已验证可用的型号，避免在未开通或余额不足连接上等待。
3. 后续若要提高整期吞吐，可考虑受限地并发独立镜头并在等待时继续编辑。它减少整期串行等待，单个供应商任务仍受模型耗时限制。
4. 当前轮询逐渐到 10 秒；更密集轮询最多减少约一个轮询间隔的完成发现延迟，需要遵守供应商限频。它不能把数分钟推理缩成几秒，优先级低于型号和草稿流程。

协议依据：[OpenAI Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Wan 参考素材请求](https://www.alibabacloud.com/help/en/model-studio/legacy-wan-reference-to-video-api-reference)、[Seedance 模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)、[Kling 官方 API](https://kling.ai/document-api/apiReference/model/imageToVideo)。无法抓取的动态官方页面没有作为参数支持的唯一证据。

完整证据：`live-results.json`、`vendor-timings.json`、`artifact-probes.json`、`runtime.json`、`changes.patch`、宽窄截图与测试日志。
