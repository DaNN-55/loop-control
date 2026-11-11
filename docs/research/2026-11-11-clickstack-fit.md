# ClickStack 与最小中文日志查看器的适配

核验日期：2026-11-11。范围：官方 GitHub 与 ClickHouse 文档；未安装、未启动服务，未读取项目真实日志或秘密。项目运行方式采用本次任务已核验的背景：Node.js 24、TypeScript、原生 `IncomingMessage` 路由、`pg`；启动 stdout/stderr 写入 `app-private.log`，Worker stdout 是内部 JSON 协议，Worker stderr 被吞。本报告未重新核验这些项目事实。

## 结论与取舍

**当前目标更适合继续做项目内的薄界面，借鉴 ClickStack 的结构化字段与详情呈现，不建议直接替换为整套 ClickStack。** 这是适配判断：目标只有六列中文日志及一次点击同步展开的「中文说明 / 原始 JSON」，而 ClickStack 提供的是包含日志、指标、链路、会话、搜索、告警和面板的通用可观测平台。[官方架构](https://clickhouse.com/docs/clickstack/architecture)

| 选择 | 适合情况 | 本项目代价与判断 |
| --- | --- | --- |
| 直接使用 ClickStack | 接受通用排障界面，需要现成搜索、链路和告警 | 接入数据后可用，但不直接满足指定中文双栏；当前功能范围偏大 |
| 配置或轻改 ClickStack | 希望保留通用日志平台，只增加业务字段和中文属性标签 | 字段配置可做；列表中文列名、业务解释与固定布局不能承诺仅配置完成，继续改 UI 还要维护上游差异 |
| 自建薄界面 | 当前明确的六列、中文说明、原始 JSON | 推荐；仍须补齐结构化日志和采集缺口。以后确有跨服务检索需求，再考虑 ClickStack 后端或独立运维入口 |

## 免费与许可边界

- ClickStack 仓库本身为 **MIT**，允许使用、修改和分发；复制实质代码时须保留版权及许可声明。[LICENSE](https://github.com/ClickHouse/ClickStack/blob/main/LICENSE)
- ClickHouse 数据库为 **Apache-2.0**，不是 MIT。[ClickHouse LICENSE](https://github.com/ClickHouse/ClickHouse/blob/master/LICENSE)
- 当前 Compose 使用 `mongo:5.0.32-focal`；MongoDB Community Server 为 **SSPL v1**。不能把整套依赖都称作 MIT。其许可允许运行未修改程序，但受第 13 条服务提供条件约束；对外提供 MongoDB 功能即服务时有额外源码提供义务。本项目个人本地部署与对外提供数据库服务应分别判断。[Compose](https://github.com/ClickHouse/ClickStack/blob/main/docker-compose.yml)、[MongoDB LICENSE](https://github.com/mongodb/mongo/blob/master/LICENSE-Community.txt)
- 自托管可免软件采购，但机器、磁盘、备份和维护仍有成本；ClickHouse Cloud 的托管路线不能因「免费注册」就认定永久免费。[部署选项](https://clickhouse.com/docs/clickstack/deployment)、[Cloud 定价](https://clickhouse.com/pricing)

## 部署组成、资源和最小试用

标准自托管是 ClickHouse（事件数据）、ClickStack UI / HyperDX、OpenTelemetry Collector（采集与转发）和 MongoDB（用户、保存的搜索、告警等应用状态）。Compose 将其拆成四个服务；All-in-One 只是把这些组件装进一个容器，并未消除依赖。[架构](https://clickhouse.com/docs/clickstack/architecture)、[Compose 源码](https://github.com/ClickHouse/ClickStack/blob/main/docker-compose.yml)

仓库建议**测试至少 4 GB RAM、2 核 CPU**；这是试用建议，不是本项目实测占用或生产容量承诺。官方容量模型依赖采集速率、查询并发、复杂度与保留期，不能从小日志列表直接推出固定资源需求。[README](https://github.com/ClickHouse/ClickStack#spinning-up-clickstack)、[资源估算](https://clickhouse.com/docs/clickstack/managing/estimating-resources)

若之后只想验证，最少操作的官方路线是 All-in-One：UI `8080`，OTLP gRPC `4317`、HTTP `4318`。应挂载 `/data/db`、`/var/lib/clickhouse` 和 `/var/log/clickhouse-server`，避免删除或重建容器后丢失数据和设置；宿主日志文件还需另行只读挂载并配置 `filelog`。官方明确 All-in-One 适合 Demo / 本地测试，不推荐生产，原因包括组件共享资源、缺少隔离和默认存储方式。[All-in-One](https://clickhouse.com/docs/clickstack/deployment/all-in-one)

长期运行可采用官方 Compose；它适用于单机无容错要求的部署，仍需维护多个服务。只有 UI 的模式也要求已有 ClickHouse、数据表和采集管道，不能用当前 PostgreSQL 直接替代 ClickHouse。[Compose 文档](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/docker-compose)、[UI-only](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/hyperdx-only)

## 当前日志如何接入

**已有文件路线：** Collector 含 `filelog` receiver，可读取文本文件，用 `json_parser` / `regex_parser` 等解析事件。必须配置文件路径、挂载、读取权限、开始位置、时间解析和流水线；不是把文件路径填进 UI 即可。历史补采可从开头读；若套用会重写时间的示例，历史记录可能被赋予采集时间，必须保留实际事件时间。[Collector 文档](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/use-cases/observability/clickstack/ingesting-data/collector.md)、[本地文件示例](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/use-cases/observability/clickstack/example-datasets/local-data.md)

**Node SDK 路线：** 官方 `@hyperdx/node-opentelemetry` 要在入口初始化并配置 Collector 地址、服务名及自托管摄入密钥。默认捕获 `console.*`；Pino / Winston 需要接入 transport。文档的 `setTraceAttributes` 可把当前 trace 后续日志关联到业务标识，但要求 `betaMode: true` 或 `HDX_NODE_BETA_MODE=1`。这不等于所有文件写入、子进程输出及进程崩溃前缓冲日志都会自动捕获。文档未在本次核验中提供 Node.js 24 + 本项目原生 HTTP / `pg` 的完整兼容矩阵，实施时需验证启动顺序、模块加载、请求上下文和退出刷新。[Node.js SDK](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/use-cases/observability/clickstack/ingesting-data/sdks/nodejs.md)

**适配判断：** `app-private.log` 可作为已有内容的采集来源，但不能认定现有日志已全量保留。Worker stdout 的内部 JSON 协议不能插入额外日志破坏协议；已被吞掉的 stderr 无法由查看器或 Collector 追回。应在现有协议边界或专用日志出口补齐必要事件，再决定读文件还是发 OTLP。自动 HTTP / 数据库埋点能帮助技术排障，不能推导出生产单名称、中文处理位置或错误处理办法。

建议应用明确产生 `event_code`、`level`、生产单 ID / 名称快照、处理阶段、结果、文件路径 / 字节数以及错误代码等业务字段；中文说明按稳定事件代码映射，未知错误保留原文。生产单名称用事件时快照还是当前名称，属于尚需明确的数据语义。右侧若要求「原始 JSON」，应保留原始事件；默认 OTEL 属性是字符串 Map，不应把转换后的遥测记录误称为未经变换的原始 JSON。[默认表结构](https://clickhouse.com/docs/clickstack/managing/ttl)

## 现成 UI 能借鉴什么

官方已有全文 / 字段搜索、时间范围、结果列选择和保存搜索；`Default Select` 可配置列表列，`Highlighted Attributes` 可突出详情字段并设 Alias（可用中文标签）。但搜索结果的 SELECT **明确暂不支持 alias**，不能承诺用 `column AS 中文列名` 完整替换列表标题。[搜索](https://clickhouse.com/docs/clickstack/features/search)、[配置](https://clickhouse.com/docs/clickstack/managing/config)

适合借鉴的是「稳定结构化字段 + 可读正文 + 完整事件详情」的分层。当前需求的「发生什么 / 当前结果 / 文件 / 大小；错误原因 / 影响 / 处理办法」以及点击后一同展开的左右两栏，是项目业务表达，需由项目产出数据与界面。官方详情属性展示能力不能证明已原生具备这套中文说明布局。

当前精简界面的优先改进建议：先加生产单与时间范围筛选、只看错误，以及按请求标识查看同一次操作的前后日志。继续保留中文说明与原始事件同步展开；无需先纳入图表、查询语法编辑器、指标、会话回放等其他入口。以上为针对当前范围的设计判断，本次未修改 Demo。ClickStack 的深链接还能为未来保留一个独立的「技术详情」入口，无需一开始分叉维护其整套 UI。[深链接](https://clickhouse.com/docs/clickstack/url-parameters)

## 保留、清理与持久化

默认事件保留 **3 天**。新建表可用 `HYPERDX_OTEL_EXPORTER_TABLES_TTL` 配置共同保留期，日志等各信号可单独覆盖；已有表应修改实际表 TTL。删除发生在后台合并过程中，不是到期瞬间立即清空，默认 TTL 合并最小重复间隔为 4 小时，实际可能更久。[TTL 管理](https://clickhouse.com/docs/clickstack/managing/ttl)

**适配判断：** ClickHouse TTL 只处理摄入后的数据库事件，不会替项目轮转 `app-private.log`、管理宿主机日志文件或备份；MongoDB 设置、Collector 文件读取进度、原始日志与 ClickHouse 数据也应分开考虑持久化。仅有「文件已挂载」不足以证明重启不重采、不漏采，后续若采用文件方案，应以轮转和 Collector 重启测试验收。

## 未验证的边界

主 Agent 只读打开了[官方在线 Demo](https://play.hyperdx.io/)，连接演示服务器并点击日志：实见英文搜索界面、筛选、SELECT、分组统计、字段分面；详情包含 Overview、Column Values、Trace Logs、Service Map、Surrounding Context 和 HTTP Request。这支持「通用排障能力现成、中文业务界面仍需适配」的判断；未证明能配置成用户指定的同步双栏。[演示截图](/Users/dan/.codex/visualizations/2026/11/11/01a1c81d-2214-7e40-9ce5-b8cbe355a649/clickstack-official-demo.png)

本次没有实际部署、发送 Node 日志、导入历史文件、测量资源或验证重启恢复。推荐路线及项目接入成本属于适配推断。当前旧 `/use-cases/observability/clickstack/` 与新 `/docs/clickstack/` 文档并存，Local Mode 的概览与细节描述存在差异；本报告不将 Local Mode 视作省掉数据库与采集链路的方案。
