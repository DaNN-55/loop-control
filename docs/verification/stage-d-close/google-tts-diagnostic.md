# Google TTS 单次诊断：项目计费不可用

2026-10-25，Asia/Shanghai。固定优化 worktree，HEAD `bca697bbc1e12626771d1283ec87a17bf85f02fe`。用户仅批准追加 1 次音色列表诊断，不合成、不自动重试，承接累计预算 17 次 / 2 元。

**本次 Google 403 的明确原因是 `BILLING_DISABLED`，不是仅凭 HTTP 状态码猜测。** 真实响应中的 `google.rpc.ErrorInfo` 为 `domain=googleapis.com`、`service=texttospeech.googleapis.com`、`reason=BILLING_DISABLED`，错误状态为 `PERMISSION_DENIED`。[脱敏原因](evidence/google-tts-diagnostic/google-error-result.json)

这表示 Key 所关联项目的计费当前不可用。它不等于证明 Key 写错，也不能单凭这个原因码区分「尚未关联计费账号」「账号停用」或其他计费状态；本轮未查询账号详情、账单、付款方式或余额。Google 的[错误原因定义](https://github.com/googleapis/googleapis/blob/master/google/api/error_reason.proto)区分计费停用、服务未启用和 Key 限制；[TTS 启用说明](https://docs.cloud.google.com/text-to-speech/docs/get-started)要求项目启用计费及对应 API。

建议 Owner 到 [Google Cloud 计费控制台](https://console.cloud.google.com/billing)，确认选择的是这把 Key 所属项目，并检查项目是否关联有效的计费账号、计费账号是否处于启用状态；项目归属可在[凭据控制台](https://console.cloud.google.com/apis/credentials)核对。本轮未启用服务、关联或启用计费、充值、修改限制、轮换 Key。修正云端设置后仍需单独授权复验，不能把诊断完成记作 Google 成功验收。

## 唯一请求与正式入口

沿用原 Keychain 记录和固定 Google 连接版本，通过正式 `npm start`、正常应用工厂、Owner HTTP `connections.verify` 和共享生产预算端口，执行唯一的 `GET https://texttospeech.googleapis.com/v1/voices?languageCode=zh-CN`，使用原有 `X-goog-api-key` 鉴权。没有替换专用 HTTP 服务，也没有直接绕过正式探针调用 Provider。

Owner HTTP 返回 200 表示命令执行完成；内部结果仍是 `live / invalid / ready=false`，Google 实际返回 403。没有调用 `text:synthesize`、没有派发语音任务、没有 Worker，也没有自动重试、重绑或继续生成。[执行回执](evidence/google-tts-diagnostic/diagnostic-result.json)

诊断仅增加验收层的响应采集封套，产品源码、SQL 源码、探针分类及请求超时均未改变。封套只放行固定的 Google GET，排除其他 Provider、路径和方法；独占单次标记补充正式跨进程预算。响应在内存中提取白名单 `status / reason / domain / service`，不保存消息正文、项目标识、帮助链接、查询串、认证头、凭据或原始响应。响应解析上限 65536 字节，未知字段丢弃。新验收源码仅以非执行 `.txt` 副本公开。

## 旧账本继承与收尾

旧累计 9 次 / 预留 0.03 元账本继续保持原字节、`halted=true`，原 2 次停止账本及全部历史阶段也不变。新诊断账本完整继承旧次数、费用、操作计数及全部事件；只将 `google_tts.verify` 的上限从已用 1 次提高到 2 次，其他操作上限等于其已用次数，不新增任何执行额度。总上限始终 17 次 / 2 元，操作上限合计只允许本次再用 1 次。

本次新增 1 次后，累计 **10/17 次**；Google 累计为 2 次，其余仍是 Pexels 4、Freesound 1、豆包 3、Cloudflare 0、OpenAI 0。费用预留仍为 **0.03 元 / 上限 2 元**，该 GET 的声明预留为 0；未查询实际平台账单，不把预留称为实际扣款。没有退款、清零、覆盖旧事件、缩小累计口径或复用独立零账本。

收到 403 后立即正式 `npm stop`，确认自建诊断进程退出，再封存账本；当前恢复原 OS loopback 闭网录入服务，Provider 请求禁用、无 Worker，Keychain 引用保持。新诊断没有新增任务或改变既有任务行、输入开关。[封存](evidence/google-tts-diagnostic/seal-result.json)、[闭网与历史数据核对](evidence/google-tts-diagnostic/closed-final-result.json)

## 离线检查与证据边界

新增离线检查通过：已知原因码正确提取且不保存合成消息、项目或 Key；未知字段丢弃；65536 字节上限有效；通过真实生产探针重放合成 403 得到 invalid；继承 16 次后仅允许第 17 次，第 18 次不触达传输，语音合成被拒绝，父账本 SHA 不变。该检查只使用内存 Response，不是新增在线资格。[离线回执](evidence/google-tts-diagnostic/offline-check-result.json)

首次准备的验收只读查询多一个右括号而失败；原失败说明保留，仅补齐缺失的输入基线，不重建已准备账本，不修改产品 SQL，之后才执行唯一在线请求。[准备失败记录](evidence/google-tts-diagnostic/setup-failure-note.json)

旧 1108 项公开 / 1752 项私有证据逐项 SHA 保留；活动阶段首页和复核报告另存原文，新随访不覆盖历史结论。首次 Google 403 当时没有保存具体原因，仍按原记录保留，不能补造当时的原始响应；本次相同 Key 引用、版本和接口得到的 `BILLING_DISABLED` 是当前诊断依据。Freesound 401、其他跳过、历史 5 秒失败、首次模型 30 秒冷启动失败、120 秒诊断不算验收、错误正文高分 `.838` 反例、裸 npm test 档案发现问题、锁网轮换按钮 P3，以及全部其他历史失败和未验收门禁均不关闭。

Google 仍未通过资格及真实合成、产物、重绑验收；完整六适配器验收仍开放。Pexels / 豆包既有结论仍限于指定样本。根 PLAN、43 个无关文件和 HEAD 不变，暂存区为空，未提交、未推送、不进入 E/F，SQL 一致性建议继续暂缓。本轮未重复完整回归，产品与测试源码字节未变；收尾采用索引身份、预算链、脱敏扫描、相对链接及运行状态检查。[证据索引](evidence-index.json)

收尾核对通过：旧 1108 项公开 / 1752 项私有证据及原门禁对象、全部旧随访保持；本轮开始前已有的 5510 条任务行哈希和 87 个输入启用标志均未变，无新任务。6 个已保存真实凭据值及其 URL 编码、Base64 形式扫描未命中公开材料或本轮额外私有文本，Google 固定版本仍可解析；索引文件身份、私有文件 Git 忽略状态和相对链接有效。[收尾复核](evidence/google-tts-diagnostic/package-verification-result.json)

复用验收 CLI 的停止回执原将模式标签命名为 `modelPhase`，容易误读为模型执行。两次实际命令都是 `npm stop`，现仅改回执标签为 `modeLabel`，原回执私有保留，不改变请求或验收结论。[标签更正说明](evidence/google-tts-diagnostic/receipt-label-note.json)
