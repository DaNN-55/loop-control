# 日志与后端接口可视化工具调研

核验日期：2026-11-11。面向 Loop-Control 的本地开发和内部查看场景；依据官方文档、官方 GitHub 和授权页筛选。本文未安装工具、部署服务或调用付费 API；易读程度和项目适配结论属于基于功能与当前源码的判断，不代表实机验收。

## 建议先用 Logdy + Scalar

**日志先试 Logdy，接口说明先选 Scalar；需要追踪一次请求的耗时和失败位置时，再考虑 SigNoz。** 这三者解决的问题不同，不必同时部署。Logdy 可以直接跟随现有日志文件；Scalar 可以把 OpenAPI 描述变成可浏览、可试请求的页面；SigNoz 需要应用接入 OpenTelemetry，才能展示真实请求经过哪些步骤。[Logdy 输入方式](https://github.com/logdyhq/logdy-core)、[Scalar 配置](https://github.com/scalar/scalar/blob/main/documentation/configuration.md)、[SigNoz Node.js 接入](https://signoz.io/docs/instrumentation/javascript/opentelemetry-nodejs/)

「大家能看懂」还需要补一层业务表达。例如把原始错误归到「生成任务 → 已提交供应商 → 等待结果 → 下载失败」，同时保留原始错误供展开。这是项目需要定义和记录的业务事件，换日志查看器不会自动获得。

## 先区分希望看见什么

| 希望回答的问题 | 合适的呈现方式 | 本次候选 |
| --- | --- | --- |
| 刚才程序输出了什么，错误在哪里？ | 日志表格、筛选、详情 | Logdy、Dozzle、Seq |
| 后端有哪些接口，各自需要什么参数？ | API 文档、请求与响应示例 | Scalar、Swagger UI、Apifox |
| 手动发一个请求，看返回结果 | API 调试客户端 | Scalar、Apifox、Hoppscotch |
| 真实请求为什么慢，在哪一步失败？ | 耗时条、调用链、关联日志 | SigNoz |
| 这次生成任务现在到了哪一步？ | 中文业务活动时间线 | 需要项目提供业务事件；上述工具不能自动推断 |

API 文档中的「发送请求」只会展示主动发出的那次请求，并不等于持续记录项目里所有真实请求。日志记录和链路追踪也不等于接口文档。

## 8 个工具的取舍

易读程度是相对于本项目非开发成员的判断：有表格和搜索不代表原始日志已经具有业务含义。

| 工具 | 能直接呈现什么 | 接入前提与非技术人员易读程度 | 自托管、授权和费用边界 |
| --- | --- | --- | --- |
| **Logdy：当前日志首选** | 实时日志、列、过滤和详情；支持文件、stdin、socket、REST 输入 | 单个二进制即可跟随文件；JSON 或自定义 TypeScript 解析可形成字段列。查看较容易，字段和解析配置需要开发者准备 | 可本地运行；core 与 UI 为 Apache-2.0。默认有消息数量缓冲上限，不能把它当成长期日志数据库；提供关闭匿名分析、更新检查的参数。[官网](https://logdy.dev/)、[GitHub 与输入/缓冲参数](https://github.com/logdyhq/logdy-core)、[core 许可](https://github.com/logdyhq/logdy-core/blob/main/LICENSE)、[UI 许可](https://github.com/logdyhq/logdy-ui/blob/main/LICENSE) |
| **Dozzle：容器场景备选** | Docker/Swarm/Kubernetes 容器日志、分屏和搜索 | 通过容器运行时读取日志；当前官方说明未提供直接打开任意宿主机 `.log` 文件的路径。容器命名清楚时易看，日志仍需读原文 | 自托管 MIT；不是独立的日志持久化和离线检索系统。Docker 接入通常挂载 `docker.sock`，官方指出具有主机 root 等效权限；不宜仅为本项目现有文件日志引入容器迁移。[官网](https://dozzle.dev/guide/getting-started)、[GitHub 与限制](https://github.com/amir20/dozzle)、[许可](https://github.com/amir20/dozzle/blob/main/LICENSE) |
| **Seq：重视结构化检索时备选** | 结构化事件、筛选、查询、仪表盘 | 自建服务并把事件送入；Node.js 有 Winston/Bunyan 集成，现有文本日志还需要选择采集和解析路径。预设查询后较易查看，自行写查询仍偏技术 | 商业软件，可自托管；免费 Individual 只允许一人访问 Web 界面，不能通过共用账号让多人免费使用。共享环境需多用户订阅；各档另有存储限制。[官网](https://datalust.co/)、[官方 GitHub（集成工具）](https://github.com/datalust)、[Node.js 接入](https://datalust.co/docs/using-nodejs)、[价格及单人限制](https://datalust.co/pricing)、[EULA](https://datalust.co/doc/eula-current.pdf) |
| **SigNoz：后续排查耗时和失败** | 真实请求的调用链、耗时、错误，以及关联日志和指标 | 需 OpenTelemetry 插桩和数据上报；异步 Worker、供应商等待和业务阶段要专门设计关联。开发者排障价值高，对非技术成员需要预设仪表盘 | Community 可自托管；主仓库普通部分 MIT Expat，`ee/` 与 `cmd/enterprise/` 属企业许可，不能笼统称全部 MIT。SSO 等有商业边界；官方 Docker 指南要求至少 4 GB 内存，另需存储、升级和备份。[官网](https://signoz.io/)、[GitHub](https://github.com/SigNoz/signoz)、[许可边界](https://github.com/SigNoz/signoz/blob/main/LICENSE)、[部署要求](https://signoz.io/docs/install/docker/)、[版本与收费差异](https://signoz.io/pricing/) |
| **Scalar：接口说明首选** | 从 OpenAPI 生成接口导航、参数、示例和内置 API 客户端 | 先有 JSON/YAML 接口描述；本项目需要补充。中文业务分组、接口摘要、示例写好后，阅读门槛较低；不会自动从手写路由还原完整接口契约 | API Reference 渲染器 MIT，可嵌入本项目或自托管；托管文档、协作、Agent 等另有套餐边界。当前配置文档说明 localhost 默认开启试用 Agent，首次提问上传 OpenAPI；纯本地文档可显式设 `agent.disabled: true`。[官网](https://scalar.com/solutions/openapi-documentation)、[GitHub](https://github.com/scalar/scalar)、[配置与 Agent 行为](https://github.com/scalar/scalar/blob/main/documentation/configuration.md)、[托管套餐](https://github.com/scalar/scalar/blob/main/documentation/guides/pricing.md) |
| **Swagger UI：成熟文档备选** | 从 OpenAPI 生成参数、数据模型、响应说明和交互调试页 | 同样需要先有 OpenAPI；可作为静态资源或容器托管。开发者熟悉度高，但对非开发人员仍需要中文说明和有意义的示例 | Apache-2.0，可自托管；不要与商业 Swagger 平台套餐混为一谈。浏览器调试仍受认证、Cookie 和跨源策略约束。[官网与安装](https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/)、[GitHub](https://github.com/swagger-api/swagger-ui)、[许可](https://github.com/swagger-api/swagger-ui/blob/main/LICENSE) |
| **Apifox：中文团队协作备选** | 中文界面中的 API 文档、调试、Mock、测试和分享；支持导入 OpenAPI | 可手动维护接口，也可导入规范；中文协作方便，但它是完整工作台，单纯给人读接口会引入较多功能。不会自动记录项目后台的所有请求 | 不按开源自托管项目推荐。当前有免费版和多档付费版，免费版有定时导入等配额；私有化部署收费。官方 FAQ 说明 SaaS 项目数据在云端，本地变量值另行处理，不能把桌面客户端等同于全部数据仅在本地。[官网](https://apifox.com/)、[官方 GitHub（相关项目）](https://github.com/apifox)、[现行价格](https://apifox.com/pricing/)、[存储与私有化 FAQ](https://apifox.com/help/app/faq/index.html)、[OpenAPI 导入](https://docs.apifox.com/doc-5174534) |
| **Hoppscotch：需要独立调试台时备选** | REST/GraphQL/实时协议请求、集合、环境和历史 | 可以先用 Web/桌面客户端；要团队自托管，需部署服务并准备 Postgres、认证等。偏开发和测试用途，不是自动生成业务说明的工具 | Community MIT，可用于个人和商业项目；Enterprise 的 SAML SSO、审计等另计。自托管协作版的运维量高于嵌一个 Scalar 文档页。[官网](https://hoppscotch.io/)、[GitHub](https://github.com/hoppscotch/hoppscotch)、[许可](https://github.com/hoppscotch/hoppscotch/blob/main/LICENSE)、[版本差异](https://docs.hoppscotch.io/documentation/self-host/getting-started)、[部署前提](https://docs.hoppscotch.io/documentation/self-host/community-edition/prerequisites) |

## 如果希望看懂业务流程：EventCatalog

EventCatalog 可以把业务流程、服务、消息和外部 API 的关系呈现为可浏览的图，支持从文档、OpenAPI、AsyncAPI 等输入组织内容。它适合解释「点击生成后，系统依次做什么」，不采集实际运行日志，也不能自动还原当前手写路由的业务关系。[可视化能力](https://www.eventcatalog.dev/features/visualization)、[GitHub](https://github.com/event-catalog/eventcatalog)

当前 v5 使用 BSL 1.1，属于源码可用软件；满足 Free Use 条件可免费生产使用，否则需要商业许可。v4 及更早版本保留 MIT 授权，但维护范围不同，不能笼统按最新开源免费工具推荐。[许可说明](https://www.eventcatalog.dev/license-faq)、[完整许可](https://www.eventcatalog.dev/license)

## 对 Loop-Control 的具体影响

以下项目事实已在本次调研中核对当前源码，外部工具能力则以上文链接为依据。

- **现有日志能先看起来。** `scripts/runtime/start.mjs` 将应用进程 stdout/stderr 追加到 `d.logPath`，`scripts/runtime/environment.mjs` 构造 `app-private.log`；Logdy 的文件跟随方式适合先验证这一份文件的可读性，不要求更换日志库。
- **不能承诺看到所有 Worker 日志。** `src/local-app/localWorkerService.ts` 把 Worker stdout 当作 JSON 输出协议解析，并吞掉 stderr；仅接上 `app-private.log` 不能补回未保留的信息。业务任务的阶段、供应商错误和请求关联，应再检查现有记录后决定补哪些事件。
- **接口文档需要先补接口契约。** 当前 API 是 `src/local-app/localRoute.ts` 的原生 Node HTTP 手写路由，路径为 `/api/local/*`；未发现现成 OpenAPI/Swagger 配置。Scalar 和 Swagger UI 都能复用同一份 OpenAPI，不能省去描述接口和保持同步的工作。
- **调试页优先与应用同源。** 当前路由校验精确 Host/Origin、Owner Cookie 会话，非 GET 请求还要求 `X-CSRF-Token`。外部托管页面或另一端口的浏览器调试不能假设直接可用；同源嵌入后也需要适配会话和 CSRF。不要为了调试台放开现有校验。
- **追踪系统排后。** 当前未发现 OpenTelemetry 配置；SigNoz 需要增加采集链路、资源预算和异步任务关联。自动 HTTP 插桩不等于已经覆盖「排队 → 调供应商 → 轮询 → 下载 → 保存」全过程。

## 建议验证顺序

1. 用 Logdy 只读跟随现有 `app-private.log`，检查一条真实应用错误是否能搜索、展开，重启后如何回看；同时确认日志究竟缺了哪些业务信息。
2. 选少量有代表性的读取、修改、异步任务接口，补中文摘要、参数、成功和失败示例，再用同源 Scalar 呈现。验收 Owner 会话、CSRF、错误响应和异步状态，之后再扩展覆盖面。
3. 若目标是让产品、运营成员看懂任务进展，先确定稳定的业务阶段与关联 ID，再制作中文活动时间线；原始日志作为详情入口。
4. 只有在「哪一步慢、哪一次外部调用失败」仍难回答时，再评估 SigNoz 与 OpenTelemetry；无需为纯文档阅读先部署整套观测平台。

## 核验盲区

- 未实机检查各工具在本机的响应速度、中文显示、日志轮转、Mac 兼容性和认证集成；表中的适配优先级需要小范围验证。
- 未验证 Logdy 对本项目真实日志的字段识别效果，也未确认现有日志是否含足够的时间、级别、任务 ID 和错误原因。
- 官方网站和主分支会变化；本文记录核验日的公开说明，没有冻结发行版本和采购报价。涉及商业授权时，应按拟用版本和实际访问人数确认。
- 现有日志查看、API 文档、请求追踪和业务时间线是不同工作；本文没有把其中任一工具描述成可自动完成其余全部功能。
