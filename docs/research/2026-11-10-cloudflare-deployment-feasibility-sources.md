# Cloudflare 部署可行性：官方资料与成本边界

核查日期：2026-11-10。价格单位均为美元，采用本次实际打开的官方页面；表内记录页面显示的更新时间，未显示则标为「未标注」。这是一份平台事实备忘，不代表已经完成 Loop-Control 的迁移验证、账号配置或部署。

## 结论

Cloudflare 能覆盖静态前端、API 编排、异步任务和对象存储，也能通过已经 GA 的 Containers 运行完整 Linux 工具链。决定迁移工作量的边界是运行时、数据库与文件存储语义，不能仅依据「GitHub workflow 一键部署」判断现有应用能否原样运行。[Containers GA](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)、[Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[D1](https://developers.cloudflare.com/d1/)。

面向其他用户开放时，Access 邮箱 OTP 可作为受控内测的入口。根据 Access 的产品职责推断，它不能替代应用中的工作区、成员权限、计费、额度和租户数据隔离；身份进入系统后，每个业务请求仍须执行应用授权。[OTP 文档](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)。

## 运行与部署边界

| 项目 | 已核实事实 | 对部署的影响 / 推断 | 官方来源与页面版本 |
| --- | --- | --- | --- |
| Workers / Pages | Pages Functions 按 Workers 计费；未调用函数的静态资源请求免费且不限量。 | 静态前端可独立部署；Pages 不提供另一套完整 Node.js 服务器环境。 | [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)，2026-09-08；[Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)，2026-08-12 |
| Workers CPU | Free 每次调用 10 ms；Paid HTTP 默认 30 秒 CPU，可配置至 300 秒。等待 `fetch`、数据库等 I/O 不计 CPU。 | 调视频 API 的等待时间不能直接当成 CPU 用量；转码需要实际 CPU 预算。 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)，2026-10-29 |
| Workers HTTP 持续时间 | 客户端保持连接时无固定墙钟硬上限；响应结束或断线后工作可能取消，`waitUntil()` 最多额外延长 30 秒。 | 长任务应持久化任务状态，使用异步编排，不能依赖浏览器一直连着。 | [Workers duration](https://developers.cloudflare.com/workers/platform/limits/#duration)，2026-10-29 |
| Workers 内存 | 每个 isolate 128 MB，包含 JavaScript heap、Wasm 和临时文件；同一 isolate 可处理多个并发请求。 | 大视频避免整段缓冲；这不是每个请求独占 128 MB。 | [Workers memory](https://developers.cloudflare.com/workers/platform/limits/#memory)，2026-10-29 |
| Worker 请求体 | Zone 套餐 Free / Pro 100 MB、Business 200 MB、Enterprise 自助上调至 5 GB。 | Workers Paid $5 不等于 Zone Pro / Business，不会自动提高上传上限。 | [Request and response limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits)，2026-10-29 |
| Node 子进程 | `node:child_process` 在 Workers 中是模块 stub。 | 能导入模块不代表能 `spawn` FFmpeg；原生二进制执行放到 Containers 或其他计算节点。 | [Compatibility flags: child_process](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-nodechild_process-module)，2026-09-18 |
| Workers 文件系统 | `node:fs` 是内存 VFS；`/bundle` 只读，`/tmp` 按请求隔离、非持久化且计入内存。 | 本机目录、SQLite 文件、媒体目录不能原样当作 Worker 持久盘。 | [Workers fs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)，页面显示 2026-04-23 |
| 浏览器直传 | R2 预签名 URL 可授权浏览器直接 PUT / GET 某对象，有效期 1 秒至 7 天；它是可持有使用的授权令牌。 | 可绕开由 Worker 代理整段视频；签发前验证业务归属，浏览器需配置 CORS。 | [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)，2026-10-26 |
| GitHub workflow 部署 | Cloudflare 有官方 GitHub Actions 部署指南，使用 Wrangler action 与 Cloudflare 凭据。 | workflow 是构建发布方式，无法消除上述运行时差异；无需因部署就公开代码仓库。 | [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) |
| 静态资源边界 | Workers 静态资源存储无额外费用；SSR / `run_worker_first` 会调用 Worker。当前默认静态响应不提供 Range 部分响应。 | 前端打包资源适合放 Assets；视频播放和下载更适合走 R2，避免将静态前端托管等同于媒体分发。 | [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)，2026-11-03 |

## 异步视频任务

| 能力 | 限制与交付语义 | 适用方式 | 官方来源与页面版本 |
| --- | --- | --- | --- |
| Workflows | 支持持久步骤、sleep 与重试；默认重试 5 次、指数退避，步骤默认 timeout 为 10 分钟，可配置。平台不设步骤墙钟硬上限；配置 timeout 与 CPU 限制仍生效。 | 「提交供应商任务 → 保存外部 task ID → sleep / 等待事件 → 查询结果 → 写 R2」适合此模式。 | [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)，2026-09-24；[Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)，2026-11-04 |
| Workflows 大结果 | 非流式单步结果及事件 payload 上限 1 MiB；单实例持久状态 Free 100 MB / Paid 1 GB；sleep 最长 365 天。 | 工作流传递 task ID / object key；长期视频文件存 R2。 | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)，2026-11-04 |
| Queues | 默认至少一次交付，少量消息可能重复；官方建议唯一 ID、主键和上游 idempotency key 去重。 | 付费生成、余额扣减、结果入库必须设计幂等；队列不是「只执行一次」保证。 | [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)，2026-04-21 |
| Queue 消费者 | 每次 consumer 最长 15 分钟墙钟，Paid CPU 默认 30 秒、可调 5 分钟；消息上限 128 KB。 | 队列发送任务引用；跨越消费者时限的供应商任务拆成提交 / 回调 / 后续查询。 | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)，2026-10-30 |

推断：即使工作流保存了步骤结果，外部 API 已成功、但本地尚未记录成功时的中断仍需要业务恢复策略。对不支持幂等键的供应商，应先查询或人工确认已有任务，再决定是否重发；持久编排本身不能证明外部付费调用绝不重复。

## 存储、数据库与身份

| 项目 | 免费与付费能力 / 费用 | 迁移意义 | 官方来源与页面版本 |
| --- | --- | --- | --- |
| R2 Standard | 每月免费 10 GB-month、100 万 Class A、1000 万 Class B；超出分别 $0.015/GB-month、$4.50/百万 A、$0.36/百万 B；互联网出口 $0。 | 素材、生成结果和导出视频可集中存储；免费出口不代表请求和容量免费。 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/)，2026-10-30 |
| R2 Infrequent Access | $0.01/GB-month，A $9/百万、B $0.90/百万、读取处理 $0.01/GB；出口 $0；无上述免费额度，最短计费存储期 30 天。 | 高频预览和短期生成素材应先按 Standard 算账。 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/)，2026-10-30 |
| R2 计量 | 存储按月均用量；计费单位向上取整，操作以百万次为计费单位。 | 成本示例要同时列容量、写入次数、读取次数，而非只算出口流量。 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/)，2026-10-30 |
| D1 数据模型 | D1 是 SQLite SQL 语义的托管数据库。 | PostgreSQL 现有 schema、驱动、SQL 和事务实现不能原样假设兼容，迁移至 D1 属于数据库适配工作。 | [D1 overview](https://developers.cloudflare.com/d1/)，2026-10-30 |
| D1 价格 | Free：读 500 万行/日、写 10 万行/日、总存储 5 GB；Paid：含读 250 亿行/月、写 5000 万行/月、5 GB，超出读 $0.001/百万行、写 $1/百万行、存储 $0.75/GB-month。 | 这是行扫描 / 写入计费，不是 SQL 请求次数；不可套用 Durable Objects SQL 的 $0.20/GB-month。 | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)，2026-10-30 |
| Hyperdrive | 加速已有 PostgreSQL / MySQL，包含连接池和查询缓存；Free 10 万数据库语句/日，Paid 不限查询次数且连接池缓存不额外收费。 | 不是 PostgreSQL 托管服务；仍需原始数据库及其费用。通过 Cloudflare 账单购买的 PlanetScale 也单独收费。 | [Hyperdrive overview](https://developers.cloudflare.com/hyperdrive/)，2026-10-21；[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)，2026-06-18 |
| Access OTP | 对 Access policy 允许的邮箱发送单次验证码，10 分钟有效；被策略拒绝者不收邮件。 | 适合限定邮箱的受控访问；公测 / 商业用户账号与租户授权需应用另行实现。 | [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)，2026-08-31 |
| Access 价格 | Free 上限 50 位用户；Pay-as-you-go 标价 $7/用户/月，人数不设该上限。 | 不是面向无限外部用户的免费 SaaS 身份服务承诺；扩大用户规模前单独选择认证与授权方案。 | [Cloudflare plans: SASE / Zero Trust](https://www.cloudflare.com/plans/)，未标注更新时间，本次 2026-11-10 核查 |

## Workers、异步产品与 CI 基础费用

| 项目 | Free | Paid / 超额 | 官方来源与页面版本 |
| --- | --- | --- | --- |
| Workers | 动态请求 10 万/日；10 ms CPU/调用。 | 最低 $5/账户/月；含 1000 万请求及 3000 万 CPU-ms/月；超出 $0.30/百万请求、$0.02/百万 CPU-ms；无额外 Workers 出口和带宽费。 | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)，2026-10-02 |
| Workers Assets | 静态请求免费不限量，存储无额外收费。 | 动态执行按 Workers 计；启用其他缓存 / 路由功能时按对应产品规则。 | [Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)，2026-11-03 |
| Workflows | 与 Workers 共享 10 万请求/日；3000 steps/日；1 GB-month 状态存储。 | 与 Workers 共享请求和 CPU 额度；含 50 万 steps/月，超出 $0.80/10 万 steps；含 1 GB-month，超出 $0.20/GB-month；等待 API / sleep 不计 CPU。步骤与状态已自 2026-08-10 开始计费。 | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)，2026-11-04 |
| Queues | 1 万 operations/日，保留 24 小时。 | 含 100 万 operations/月，超出 $0.40/百万；保留默认 4 天、可调至 14 天。每 64 KB 的 write/read/delete 分别计一次，通常一条小消息至少 3 operations；重试会增加操作。 | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)，2026-10-30 |
| GitHub Actions 私有仓库 | 当前官方页：GitHub Free 每月 $12 included compute usage、500 MB artifact、每仓库 10 GB cache；compute 与 cloud sandbox 共享。 | Linux 2-core x64 $0.006/分钟；只运行该 runner 时，$12 等价约 2000 分钟。Pro / Team 每月 $18、Enterprise Cloud $300 compute usage；不能当作固定分钟额度。 | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[Runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)，未标注更新时间，本次 2026-11-10 核查 |
| GitHub Actions 公开仓库 | 标准 GitHub-hosted runner 免费，不消耗上述 compute 额度；self-hosted runner 本身也仍列为免费。 | larger runner 在公开仓库仍收费；不要把公开仓库免费推导为任意 runner、artifact 和其他产品都免费。 | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)，未标注更新时间 |
| Vercel AI SDK | 官方仓库定义为免费开源 TypeScript toolkit，可使用独立 provider 包或自建 provider。 | 直接调用自选供应商且部署在 Cloudflare，不因 SDK 名称就需要购买 Vercel 托管；模型 API 与实际托管资源另计。SDK 默认字符串模型可能走 Vercel AI Gateway，需在实现中明确选择直连 provider。 | [官方仓库](https://github.com/vercel/ai)、[Choosing a provider](https://ai-sdk.dev/docs/getting-started/choosing-a-provider)，页面标识 v7，未标注更新时间 |

## Containers：能运行 FFmpeg，但计费和持久化另算

Containers 于 2026-04-13 GA，官方明确支持完整 Linux 环境、其他运行时和 CLI 工具。因此将 FFmpeg 装入容器属于平台能力范围；实际编码速度、编解码器依赖和项目渲染兼容性仍需用真实样例验证。[GA 公告](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)。

| 项目 | 当前能力 / 费用 | 官方来源与页面版本 |
| --- | --- | --- |
| 前提与计费粒度 | 需 Workers Paid（最低 $5/月）；运行期间每 10 ms 计费，休眠后停止。内存、磁盘按规格预配量，CPU 只按 active usage。 | [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-05 |
| 包含用量 / 超额单价 | 每月含内存 25 GiB-hours，超出 $0.0000025/GiB-second；CPU 375 vCPU-minutes，超出 $0.000020/vCPU-second；磁盘 200 GB-hours，超出 $0.00000007/GB-second。 | [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-05 |
| 规格 | `lite`：1/16 vCPU、256 MiB、2 GB；`basic`：1/4 vCPU、1 GiB、4 GB；`standard-3`：2 vCPU、8 GiB、16 GB；`standard-4`：4 vCPU、12 GiB、20 GB。自定义规格默认最多 4 vCPU / 12 GiB / 20 GB，可申请更高限额。 | [Limits and instance types](https://developers.cloudflare.com/containers/platform/limits/)，2026-11-02 |
| 出口 | 北美 / 欧洲含 1 TB/月、超出 $0.025/GB；大洋洲 / 韩国 / 台湾含 500 GB、超出 $0.05/GB；其他区域含 500 GB、超出 $0.04/GB。 | [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-05 |
| 其他费用 | Worker、Durable Object、日志按各产品计费，不在容器 CPU / 内存 / 磁盘三个数字中全部覆盖。 | [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-05 |
| 持久化与运行时长 | 磁盘默认临时，休眠再启动使用镜像的新磁盘；支持特定调度策略下的快照，也可 R2 FUSE，但不能期待原生 SSD 性能。无固定最长运行时长，也不保证某实例永不因平台事件中断。 | [Containers FAQ](https://developers.cloudflare.com/containers/faq/)，2026-11-09 |
| 新限制 | 经 outbound handler 转发到外部服务的单次 HTTP body 默认 100 MiB；multipart/resumable 每个独立请求分片须在限额内。 | [Containers limits](https://developers.cloudflare.com/containers/platform/limits/#outbound-http-request-body-size)，2026-11-02 |

以下为计算示例，不是供应商报价：单个 `standard-3`（2 vCPU、8 GiB、16 GB），运行期间 CPU 持续满载，30 天月，不含数据库、模型 API、R2、DO、日志和超额出口；假设同一账户没有其他资源消耗套餐用量。按 [官方单价](https://developers.cloudflare.com/containers/platform/pricing/) 计算：

| 每月容器运行时间 | 内存超额 | CPU 超额 | 磁盘超额 | 加 $5 Workers 基础费后 |
| --- | --- | --- | --- | --- |
| 100 小时 | `(800−25)×$0.009 = $6.975` | `(200−6.25)×$0.072 = $13.95` | `(1600−200)×$0.000252 = $0.3528` | 约 $26.28/月 |
| 720 小时 | `(5760−25)×$0.009 = $51.615` | `(1440−6.25)×$0.072 = $103.23` | `(11520−200)×$0.000252 = $2.85264` | 约 $162.70/月 |

CPU 等待 I/O 时会低于此满载假设；容器持续运行时内存和磁盘仍按预配量计费。空闲能够休眠、按任务启动的模式通常更有利，持续满载需与固定价格 VPS 比较。

## 三条部署路线的判断依据

以下是基于上述平台事实的架构推断，具体迁移量由代码审查与样例部署决定。

| 路线 | 可复用的能力 | 仍需承担的工作 / 成本 |
| --- | --- | --- |
| Workers / Pages + Workflows / Queues + R2 | 前端、API 编排、供应商任务追踪、媒体对象存储。 | 适配 Worker 运行时；保留外部 PostgreSQL 或改写成 D1；原生渲染另设 Containers。$5 只是 Workers 付费起点。 |
| Cloudflare + 本机计算 | 云端入口和对象存储，本机保留原生工具链与现有数据。 | 本机在线率、上行带宽、任务队列、用户隔离、授权和故障恢复由运营者承担；公开多用户服务不能只依赖邮箱入口控制。 |
| 容器 VPS + R2 / Cloudflare | 完整 Node.js / FFmpeg / PostgreSQL 工具链较容易沿用；应用持续运行与本地盘语义较接近现状。 | VPS、数据库备份、系统运维与扩缩容成本；仍需实现多用户身份、权限和数据隔离。 |

## 保留的不确定性

- 未读取推文作者的真实仓库、workflow 或 Cloudflare 账单；两张图中的说法不能证明其完整服务成本为零，也不能证明 Loop-Control 能照搬。
- 无账号操作、无部署、无付费生成；未验证任何地区的访问延迟、邮箱投递率、模型供应商可达性和视频渲染耗时。
- 页面日期按官方显示抄录，不以文档更新时间推断产品某功能的生效日；未显示日期的页面仅能证明本次访问所见内容。
- GitHub 当前计费页面与搜索索引中的旧「固定分钟」摘要不一致，采用实际打开的 owning billing 页面；购买或部署前应再次核对账号实际计费界面。
