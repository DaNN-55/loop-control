# 连接额度、近7天消耗与模型发现

检查日期：2026-11-01。研究基于官方文档、当前源码和本轮只读联调。以下结论区分供应商实际数据与本平台预算预留；本轮不调用生成接口。

## 可获取范围

| 服务 | 余量／余额与近7天 | 模型发现 |
| --- | --- | --- |
| MiniMax 国内／国际 | 未找到普通生成 Key 可调用的公开余额、账单接口。应保留控制台入口，不猜测内部接口。 | `/v1/models` 公开 OpenAI 兼容模型 ID；文档未证明它能完整覆盖视频、语音等媒体模型，不能替代媒体能力目录。 |
| 可灵 | `/account/costs` 可查询账号资源包，约12小时延迟；它不是现金余额。`/account/billing/balance` 可分页读取实际扣费，查询范围按任务创建时间，不是扣费发生时间。 | 未找到通用模型发现接口，仍须维护官方能力目录。 |
| 火山方舟／火山语音 | 云费用中心提供余额与账单查询，需要有权限的云 AK/SK；普通生成 Key 不能替代。账号余额不能标为单连接独享。 | `ListFoundationModels` 支持模态筛选，但明确要求 AK/SK；语音模型与音色列表也不是同一个目录。 |
| 阿里百炼 | BSS OpenAPI 的余额／账单另需云账号 AK/SK/RAM 权限，DashScope Key 不直接提供账务权限。 | 新版 `GET /api/v1/models` 支持现有 API Key，能按 IG/VG/TTS、输入输出模态等筛选并返回定价；国内地址需正确的业务空间。 |
| OpenAI | Costs 需要 Admin API Key；未找到官方公开的预付余额查询接口。组织费用可按 Key 或项目筛选，普通生成 Key 权限不足。 | `/v1/models` 返回基础 ID 等信息，没有完整媒体能力字段，仍需映射到本项目已适配能力。 |
| Pexels | 请求剩余量来自实际请求响应头；未找到近7天历史查询。它是素材 API 的请求限额，不是资金余额。 | 无生成模型，应显示检索服务。 |
| Freesound | `/apiv2/usage/?num_days=7` 返回当前请求限流与7天请求历史；不是费用。限流按用户共享，历史按 API client。 | 无生成模型，应显示检索服务。 |

官方依据：

- [MiniMax 国内账户](https://platform.minimax.cn/docs/faq/about-account)、[国际账户](https://platform.minimax.io/docs/faq/about-account)、[模型列表](https://platform.minimax.cn/docs/api-reference/models/openai/list-models)。
- [可灵资源包](https://kling.ai/document-api/api/assets/account-usage)、[扣费明细](https://kling.ai/document-api/api/assets/billing-deduction/balance)、[新版与旧版鉴权](https://kling.ai/document-api/api/get-started/authentication)。
- [火山账号余额](https://docs.volcengine.com/docs/billing-center/query-balance-acct-query-user-account-balance-information?lang=zh)、[费用中心鉴权](https://docs.volcengine.com/docs/billing-center/api-call-instructions?lang=zh)、[基础模型查询](https://docs.volcengine.com/docs/ark/list-foundation-models-api?lang=zh)。
- [阿里云账号余额](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)、[账单](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbill)、[百炼模型目录](https://help.aliyun.com/zh/model-studio/list-models)。
- [OpenAI Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)、[模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)。
- [Pexels 官方文档 Request Statistics](https://www.pexels.com/api/documentation/)、[Freesound Usage](https://freesound.org/docs/api/resources_apiv2.html#usage)、[Freesound 限流](https://freesound.org/docs/api/overview.html#throttling)。

## 本轮实现与实测

新增额度列采用供应商数据：可灵接资源包与7天创建任务的实际扣费，Freesound 接日请求余量和7天请求次数；其他服务给出未接入／需权限状态。不使用本机 `paid_generation_reservations.reserved_cents` 冒充实际扣费。可灵现金扣费、试用额度、CNY 与 USD 分开，金额以微单位累计；分页未完成不返回一个看似完整的合计。

正式 Key 只在服务端原秘密存储中读取，不回传前端；Owner 与当前连接版本校验后才查询。按 Owner／版本缓存5分钟并合并并发请求，版本改变不复用旧结果；普通连接目录读取仍不读取 Keychain。供应商异常只显示固定脱敏提示。

只读联调：Freesound 返回 `num` 与 `"2000/day"` 的真实形状，与文档中的 `num_requests`／数字形式有差异，边界均支持。实测最近7天8次、日已用2次。可灵扣费查询 HTTP 200、code 0、空明细、无后续页；资源包查询 HTTP 200、code 0，但没有列表字段，因此显示「未返回」，不推断余额为0。

## 服务、连接与模型的关系

当前技术链路为 `registeredAdapters.productionChoices()` → `serviceCatalog` → 连接表。模型来自 `videoProviderCatalog.ts` 与 `registeredAdapters.ts` 的固定 `models/modelCatalog`；当前模型列表示本项目已适配目录，不是这把 Key 能调用的完整目录。连接还绑定 Provider 与 Adapter，创建选项使用「MiniMax H3」等模型名，确实容易让人误以为连接属于单个模型。

建议调整为：

1. **服务与连接**：先选择供应商、站点／业务空间、填写 Key，管理身份与认证。模型选择不创建另一份相同 Key。
2. **可用能力与模型**：连接下按图片、视频、语音等能力展示模型。支持官方发现的服务先读取目录，再与本项目执行器已适配的模型取交集；来源、读取时间、未适配原因可在详情中查看。
3. **制作时选择**：本次制作选连接与模型，明确提交后冻结连接版本、模型、参数和费用依据；新目录不改写旧任务。

「官方目录中存在」「该 Key 有权限」「本项目支持该协议」「实际生成成功」是不同证据，不能用一次列模型成功替代全部检查。发现模型或改筛选也不自动生成。

优先从百炼动态发现做起，因为官方目录有媒体能力字段；OpenAI／MiniMax 的基础模型 ID 需要额外能力映射。先保留已适配模型保证可用，再逐个增加执行器支持。Pexels 与 Freesound 继续作为素材检索服务，不放入生成模型筛选。

这是后续模型管理的建议，本轮没有改变模型协议、放开未适配模型或重构已有执行链路；与 ADR-0018 的按次制作选择和不可变快照原则一致。

## 后续具体改动建议（待实施）

以服务管理入口重排现有界面，先保留执行器和不可变任务边界，再逐步增加模型。

| 位置 | 具体变化 | 完成条件 |
| --- | --- | --- |
| 新建／编辑连接 | 服务选项使用供应商名称；先填站点／业务空间、名称、Key。模型移到连接详情中管理。 | 更换模型不要求重复保存同一 Key；现有连接、版本和凭据仍可读取。 |
| 连接详情 | 增加「模型」区域及显式「同步模型」操作；图片／视频／语音筛选、名称搜索、默认模型与启用范围。 | 能区分官方目录可见、已适配、未适配；目录读取失败有原因、时间和重试，不清空上次有效目录。 |
| 百炼模型来源 | 服务端使用该连接版本的地域／空间和现有 API Key 调用官方媒体目录，按能力标准化。 | 返回分页完整、字段经过校验，浏览器不接触Key，不提交生成请求。 |
| MiniMax／OpenAI／可灵 | MiniMax、OpenAI 的基础模型ID结合维护的媒体能力目录；可灵没有确证的通用发现接口时使用官方维护目录。 | 不因远端接口缺少媒体字段而误称“没有视频模型”；不把未适配ID放进可执行选项。 |
| 制作准备 | 把当前「连接与模型」合并下拉拆为「服务连接」和该连接下的「模型」，再展示对应参数。 | 切换连接更新模型范围；保留原选择不可用时的提示，不静默换模型或提交。 |
| 保存与执行 | 连接模型偏好只影响后续新选择。提交仍固定 connectionVersionId、provider、adapter、model、参数及费用依据。 | 旧任务不随同步、筛选、默认值或启用范围改变；预算、成本规则及协议未适配的模型不可生成。 |

建议分两步交付：第一步完成服务命名、连接详情模型管理、百炼动态发现和制作入口双层选择；第二步按实际需要增加其余媒体模型的执行协议与价格适配。每步均走正式UI → Owner HTTP → 临时真实数据库 → 受控Provider的验证，真实生成单独验收。

当前源码证据：`src/connections/ConnectionWorkspace.tsx` 使用执行器生产选项生成连接类型；`src/worker/registeredAdapters.ts` 和 `videoProviderCatalog.ts` 提供固定模型；`src/connections/serviceCatalog.ts` 投影到连接；`src/local-app/WorkspaceVisualPreparation.tsx` 当前把连接／模型拼接为同一下拉的选项。

## 后续补充：Pexels 已接入（2026-11-01）

用户要求逐个测试额度后，已只读联调现有 Pexels 连接：官方视频检索响应 HTTP 200，`X-Ratelimit-Limit=25000`，`X-Ratelimit-Remaining` 返回真实剩余请求数，另有重置时间。现已把这部分响应头接入额度列，取代上文“Pexels 尚未接入”的验收时状态；近7天仍显示「未提供历史」，不估算补数。查询本身会使用一次素材检索请求额度，没有生成或付费模型请求。

## 最终实施范围（用户确认，2026-11-01）

以上大范围界面重排方案不实施。保留新建连接表单和制作的「连接与模型」合并下拉，只在更多操作中增加「模型设置」：建立连接后显式读取供应商目录、搜索／按能力筛选，并勾选本平台已适配模型。未适配模型只展示；保存启用范围不创建凭据版本。目录读取结果仅保留本次窗口，失败不清空本地选择；未配置范围时保留原有默认模型。实现边界见 ADR-0020。

补充官方协议核查：

- 百炼北京目录要求带业务空间的主机 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/models`，按 `page_no/page_size` 读取 `output.total`；普通生成域名不能当作新目录地址。缺空间ID时说明限制，不猜地址。`capabilities` 只映射 TG/IG/VG/TTS，不当作推理授权。[模型目录](https://help.aliyun.com/zh/model-studio/list-models)、[独立模型权限接口](https://help.aliyun.com/zh/model-studio/list-model-permissions)。
- MiniMax 国内／国际 `/v1/models` 返回 `data[]`，没有分页或媒体能力字段。保留已适配视频模型，即使此目录未列出它。[国内目录](https://platform.minimax.cn/docs/api-reference/models/openai/list-models)、[国际目录](https://platform.minimax.io/docs/api-reference/models/openai/list-models)。
- OpenAI `/v1/models` 没有分页或媒体能力字段；读取和模型请求为不同权限。[目录](https://developers.openai.com/api/reference/resources/models/methods/list)、[RBAC](https://developers.openai.com/api/docs/guides/rbac)。
- 火山目录只接受 Access Key 管理鉴权，现有 Bearer 生成Key不能替代；可灵官方文档未提供通用目录，因此本期使用项目已支持目录。[火山目录](https://docs.volcengine.com/docs/ark/list-foundation-models-api?lang=zh)、[可灵官方接口索引](https://kling.ai/document-api/llms.txt)。

正式页面只读 MiniMax 国内目录返回9个基础模型，不含 `MiniMax-H3`；页面保留 H3，并把其余9个未适配模型明确禁用。没有发起生成或变更正式启用清单。
