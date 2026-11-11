# 连接配置与密钥管理：成熟产品的组织方式

调研日期：2026-11-11。范围：公开官方文档、官方 UI 图片、官方开源 UI 源码；没有登录任何用户账户、读取真实密钥或修改产品代码。

## 结论

Loop Control 最适合采用「连接列表 → 单个连接详情」：用连接聚合认证、模型、用量与计费、版本记录；详情内部切换内容，返回后恢复列表位置。密钥查看、复制和更换放回对应连接，独立「密钥管理」保留为全局检索、系统密钥与历史引用的管理入口。**合并操作入口，不合并不同认证方式、不抹掉不可变连接版本，也不把所有秘密重新做成一个大表单。**

最值得组合借鉴的是 Grafana 的连接对象边界、n8n 的统一编辑容器和 Cloudflare 的单一编辑抽屉。Stripe 更适合作为轮换与撤销操作的参考。Vercel 和 GitHub 适合参考精简列表及作用域表达，但其「变量名称」不够承担 Loop Control 的模型、权限验证和历史任务语义。以下产品事实均有来源；具体落到 Loop Control 的结构属于本报告建议。

## 如何理解证据

- **亲见官方 UI 图片**：本次实际打开官方图片检查；只证明图片展示的形态，不等同于实测当前账户中的交互。
- **亲读官方源码**：本次读取实际 UI 实现，可以确认容器和条件分支；`master` 等分支仍会变化，不代表所有部署已发布该形态。
- **官方步骤支持**：文档明确写出的导航路径或操作，例如 `Edit drawer`；没有据此补猜未展示的宽度、动画、焦点或关闭规则。
- **设计推论**：根据对象关系和已确认操作提出的 Loop Control 建议；不冒充竞品事实。

## 比较矩阵

| 产品 | 聚合单位与信息关系 | 列表或摘要可确认的信息 | 配置容器与退出 | 对 Loop Control 的判断 | 证据级别与官方来源 |
| --- | --- | --- | --- | --- | --- |
| **Grafana** | 命名的数据源实例；连接地址、认证和查询配置属于该实例，面板通过实例名称引用 | 文档确认从已配置数据源列表选择对象；设置中有名称和默认标记。未在本次来源中确认列表全部列 | 选中后进入对象的 `Settings`；官方图展示左侧配置导航、右侧设置。文档明确 `Save & test` | **最适合借鉴对象边界和详情页**。认证与业务配置一起归属于连接；不照搬长页中大段分区与说明 | 亲见官方图、官方步骤。[配置指南](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/data-sources/influxdb/configure/)、[已有数据源编辑步骤](https://grafana.com/docs/grafana/latest/datasources/pyroscope/configure/)、[权限分栏](https://grafana.com/docs/grafana/latest/administration/data-source-management/) |
| **n8n** | 命名 credential，属于个人空间或项目；节点选择已有 credential，也可从选择器创建 | 源码显示名称、凭据类型、更新时间、创建时间及条件状态；项目标识按权限/功能显示 | 文档明确 credential modal；源码用一个 `N8nDialog`，内部 `Connection / Sharing / Details` 导航，`v-if / v-else-if` 替换主内容 | **最适合借鉴一个对象只有一个编辑容器**。可把业务中的创建和设置中的编辑接到同一个编辑器；不照搬企业共享能力 | 官方步骤、亲读源码。[创建与编辑](https://docs.n8n.io/build/understand-workflows/create-and-edit-credentials)、[编辑容器源码](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/credentials/components/CredentialEdit/CredentialEdit.vue)、[列表项源码](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/credentials/components/CredentialCard.vue) |
| **Cloudflare Workers / Secrets Store** | Worker 内的变量与 secrets；账户级 Secrets Store 再由服务引用。局部设置与共享秘密有不同层级 | 官方步骤确认秘密列表可搜索、每项通过省略菜单编辑；名字、权限范围、备注是管理字段，未确认全部列表列 | Workers 文档明确 `Variables and Secrets → Edit drawer → Deploy`；账户级 Secrets Store 编辑容器形态未确认 | **适合借鉴单一抽屉和局部/全局双入口**。但共享 secret 原地更换会影响所有引用者，不能照搬到不可变连接版本 | 官方步骤。[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[账户秘密管理](https://developers.cloudflare.com/secrets-store/manage-secrets/how-to/)、[秘密层级](https://developers.cloudflare.com/secrets-store/manage-secrets/) |
| **Stripe** | 当前账户或 sandbox 的 API key；Webhook signing secret 另属于具体 Webhook endpoint | 文档明确 Standard / Restricted 分组、名称、备注编辑、每行省略菜单；轮换时旧 key 名称下显示到期剩余时间 | `Edit key / Rotate key / Expire key / View request logs` 是同一 key 的操作；到期确认明确使用 dialog，其他操作的具体容器未确认 | **适合借鉴密钥生命周期和影响确认**。不适合把发行平台自身的 key 管理页直接当外部连接配置页 | 官方步骤。[API keys](https://docs.stripe.com/keys) |
| **Vercel** | 项目或团队的环境变量；每个值有环境/分支范围，2026-08 起分为 `Config / Secret` | 官方现行文档确认搜索、环境过滤、省略菜单；更新说明确认列表显示类型和适用范围 | 新官方图展示带标题、关闭和保存的单个新增容器；仅凭裁切图不能判断它是居中 dialog 还是侧边 drawer。旧文档仍写列表上方 `Add New` 表单 | **只借鉴列表密度、范围和秘密状态**。不要照搬通用 key-value、批量追加字段或旧图的眼睛按钮 | 亲见官方图、官方步骤。[管理变量](https://vercel.com/docs/environment-variables/managing-environment-variables)、[2026-08 类型变更](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types) |
| **GitHub Actions** | repository / environment / organization 下的 secret；组织秘密可限制允许使用的仓库 | 官方确认仓库页面同时列出可用的环境/组织 secrets；组织列表显示权限和策略。官方图确认 `Secrets / Variables` 分栏 | 由设置导航到专门的 secrets 区域；新建操作进入输入名称和值的步骤。仅凭本文未确认最终表单是页、dialog 还是 drawer | **适合借鉴统一索引、明确作用域**。不适合照搬层级数，Loop Control 当前是 Owner 全局连接 | 亲见官方图、官方步骤。[使用 secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) |
| **Supabase** | 项目的 API key；`Connect` 对话框用于获取当前接入所需信息，完整 key 管理在 `Settings > API Keys` | 官方确认完整页面聚合所有 key，包括 legacy；本次没有亲见完整 key 列表图或核实全部列 | 快速接入是 `Connect dialog`，生命周期管理有独立设置入口；完整 key 编辑容器未确认 | **适合借鉴快捷使用与完整管理的分工**。不要把所有操作都塞入生成入口的临时浮层 | 官方步骤。[API keys](https://supabase.com/docs/guides/getting-started/api-keys)、[轮换流程](https://supabase.com/docs/guides/security/rotate-leaked-api-keys) |

## 三个最值得看的具体细节

### 1. Grafana：先确定「正在配置哪一个连接」

官方配置图把名称放在顶端，连接地址、认证和数据配置都在同一个对象范围内；左侧导航提供稳定定位。现有数据源从列表中选中后修改，保存和测试也是对象级操作。[官方图与步骤](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/data-sources/influxdb/configure/)、[编辑已有实例](https://grafana.com/docs/grafana/latest/datasources/pyroscope/configure/)

**借鉴建议：**Loop Control 中一次只配置一个命名连接。模型、计费和历史版本属于它的子页，避免点击「模型」「密钥」「计费」后各自在列表下面生成一个块。Grafana 图中的长设置页仍然较重，建议只借用对象和导航，不照搬其所有分区。

### 2. n8n：多个入口进入同一个编辑器，内部切换替换内容

官方文档确认，可以从全局创建入口、项目入口或节点的 credential 选择器创建凭据；保存时测试凭据。源码的编辑器有统一标题与关闭控件，内部导航切换 `Connection / Sharing / Details`，主内容分支互斥；具体导航项受权限和功能条件影响。[官方说明](https://docs.n8n.io/build/understand-workflows/create-and-edit-credentials)、[容器与分支源码](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/credentials/components/CredentialEdit/CredentialEdit.vue#L1655)

**借鉴建议：**从生成模型选择器、连接设置、密钥引用跳转，最终都定位同一个连接编辑视图。入口可以不同，编辑容器和退出规则应一致。n8n 的自动测试不能直接成为 Loop Control 的默认行为：项目已有显式验证语义，应保留。

### 3. Cloudflare：列表保持稳定，编辑放进有边界的空间

Workers 官方步骤直接使用 `Edit drawer`。账户级 Secrets Store 的列表通过每项省略菜单操作；它也明确说明，编辑共享秘密会替换所有使用它的服务中的值。[Worker 抽屉步骤](https://developers.cloudflare.com/workers/configuration/secrets/#delete-secrets-from-your-project)、[共享秘密编辑语义](https://developers.cloudflare.com/secrets-store/manage-secrets/how-to/#edit-a-secret)

**借鉴建议：**一个新增或更换动作进入单个编辑容器，取消后原列表不变；不在每次点击时追加新面板。共享秘密必须显示引用影响，但 Loop Control 应继续创建新连接版本，不能把共享秘密的原地修改语义照搬进来。

## 官方 UI 图片

以下链接来自本次已核查的官方页面。图片只作为静态布局参考，不能证明焦点、返回、动画或部署版本。

| 图片 | 本次亲见内容 | 使用限制 |
| --- | --- | --- |
| [Grafana InfluxDB 设置官方图](https://grafana.com/media/docs/influxdb/influxdb-updated-ui-v12.3.png) | 顶部名称、默认开关、左侧配置导航、右侧 URL/认证和数据库设置 | 这是插件配置图；导航更像长页定位，不应误写成互斥子页 |
| [Vercel Config / Secret 新增官方图](https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/5LUS92qt7R7adaG9JpVidO/463001065b366cd88da7b1022808d697/web-light-nopadding.png) | 标题、关闭、Secret/Config 选择、Key/Value/Note、环境选择、底部保存 | 裁切图无法确认浮层类别；图中 `Add Another Variable` 是批量添加功能，不适合作为本项目常规配置结构 |
| [Vercel 环境变量列表官方图](https://7nyt0uhk7sse4zvn.public.blob.vercel-storage.com/docs-assets/static/docs/concepts/projects/environment-variables/variable-example-light.png) | 搜索、环境过滤、排序、单行名称和适用环境、省略菜单 | 图中仍有 reveal 眼睛，属于旧表现；2026-08 公告已确认 Secret 保存后不可读取，不能照图恢复这个功能 |
| [GitHub Actions Secrets 分栏官方图](https://docs.github.com/assets/cb-57155/images/help/repository/actions-secrets-tab.png) | 一个设置区域中的 Secrets / Variables 分栏 | 图片没有展示具体 secret 行，更没有展示编辑容器 |

n8n 本次用官方开源 UI 源码确认结构，没有把搜索结果中的社区图片当官方当前界面。Cloudflare、Stripe、Supabase 本次只有相关官方步骤，未亲见其完整当前配置 UI。

## 应以什么作为聚合单位

下表是针对 Loop Control 的设计建议。项目事实以当前 [CONTEXT.md](../../CONTEXT.md) 的「外部连接」「连接版本」「已验证连接」「连接验证结果」为依据；界面边界还参考了 [LocalConnectionsPanel.tsx](../../src/local-app/LocalConnectionsPanel.tsx) 与 [LocalSecretAdministration.tsx](../../src/local-app/LocalSecretAdministration.tsx)。

| 单位 | 建议位置 | 理由与边界 |
| --- | --- | --- |
| 服务商 / 服务 | 列表过滤与新建时选择，不作为唯一管理对象 | 同一服务商可以有不同认证方式、区域、用途和连接；服务商名称不足以唯一确定正在修改的对象 |
| **连接** | 主列表的一行、详情页的对象标题 | 已有 Owner 命名和稳定 ID，可跨账号复用，也是模型选择、权限和当前版本的聚合入口 |
| 凭据 / 密钥 | 连接「认证」内的已保存状态、查看/复制、更换操作 | 用户从用途出发就能找到秘密；普通配置仍不回显明文。系统控制密钥和历史/无当前连接引用的条目仍需独立全局入口 |
| 连接版本 | 详情「记录」中的版本列表，当前版本在标题附近提供必要状态 | 任务固定引用旧版本，轮换不能改写旧任务。技术引用编号和绑定修复只在查错或版本详情中展开 |
| 模型 | 连接详情「模型」 | 同一 key 可对应多个兼容模型，不能因模型不同而复制凭据；读取供应商目录不代表完成推理授权或生成验证 |
| 用量与计费 | 连接详情「用量与计费」；列表仅可选显示一项主要余量 | 生成认证与账单读取可能需要不同权限材料，不应强迫用户把计费 key 当生成 key；是否已有独立材料应由当前 adapter/能力决定 |

**何时合并：**同一连接的认证状态、替换入口、最小验证结果应放在一起；同一 Adapter 已支持多能力且认证兼容时，共用一个连接，在能力筛选中出现即可。**何时分开：**不同 Adapter 或认证方式；系统控制秘密；只有历史引用而无当前连接的秘密；权限材料和生命周期独立的计费凭据。这里的合并是信息组织，不要求改变 Keychain 条目的存储或复用规则。

## 三种可行结构与取舍

### A. 连接列表 → 同一内容区的连接详情：首选

列表只展示名称、服务/区域、可用能力和验证状态；右端保留一个主要入口与省略菜单。点击连接后，设置内容区切换为该连接详情，标题始终显示连接名称和返回入口。详情用固定的 `连接 / 模型 / 用量与计费 / 记录` 导航；认证就在「连接」中，无需再找独立的 key 编辑块。

**适合原因：**Loop Control 已有模型范围、计费权限和不可变版本，不是两个字段的轻量 key-value 表单；完整详情留出空间，同时能和设置页的其他配置保持统一。借鉴 Grafana 的对象边界与 n8n 的互斥内容结构，但这是针对本项目的组合建议。

**退出规则：**保存后留在详情并给出轻量结果；取消恢复最近保存值；返回恢复列表筛选、滚动位置与焦点。只有存在未保存改动时处理离开确认。不要保存一次就突然关闭整个设置页。

### B. 固定左右两区：连接列表 + 单个详情区，次选

左侧窄列表始终可见，右侧只显示当前选中连接；选择另一个连接时替换右侧内容。新增也占用同一个右侧位置，不挤进列表。窄屏退化为 A 的列表/详情切换。

**适用条件：**实际使用中需要频繁在多个连接之间比较状态或切换配置，并且可用内容宽度足够。它能减少进入/退出感，但会长期占用横向空间；设置页已有主导航时容易形成三栏。因此不作为默认首选。没有把任何竞品未确认的 split view 当成证据；这是设计备选。

### C. 列表 + 单一抽屉：短操作合适，完整配置不首选

新增、更换密钥、修改名称等短动作打开一个固定抽屉，列表维持原布局；关闭后回到原来的行。抽屉内部步骤替换，不允许再从抽屉上叠另一套模型/计费编辑器。

**适用条件：**配置内容较短，或从生成流程临时修复连接。Cloudflare 有明确抽屉步骤，n8n 则有统一 dialog 源码，可证明「编辑移出列表」是实际产品方式。Loop Control 完整模型和版本管理较长，不宜为保持列表可见而把全部内容压进窄抽屉。

**建议采用范围：**主设置采用 A；从生产流程进入的短认证修复可采用 C，并复用相同字段和行为。若当前目标强调所有配置进入方式完全统一，则连短操作也用 A 的内容区切换，仅保留身份验证这种单一确认 dialog。

## 轮换、验证、引用与历史如何收进去

| 操作 | 放在哪里 | 交互与语义建议 |
| --- | --- | --- |
| 查看 / 复制密钥 | 当前连接的认证行，或全局密钥列表的单项操作 | 身份验证使用一个短 dialog；成功后回到原对象，明文按已有规则短时显示并清理，不在列表下追加密码表单 |
| 更换密钥 | 当前连接「连接」页内的编辑状态 | 输入新材料、保存新版本、显式测试；成功结果占用原认证状态位置。不可静默把已入队任务切到新版本 |
| 测试连接 | 连接当前版本状态附近 | 显示当前版本、最近测试时间与结果；必要时打开记录查看旧测试。认证有效不等于所有模型都能推理，也不等于完整计费权限 |
| 模型范围 | 同一详情的「模型」页 | 搜索/筛选和选择范围在固定区域更新；同步目录结果不在主连接列表底部追加 |
| 轮换影响 | 更换提交前或记录中的关联摘要 | 先说明新请求使用哪个版本、旧任务仍引用哪个版本；不要套用 Stripe 的旧 key 到期机制，外部供应商是否仍接受旧 key 由供应商决定 |
| 引用关系 | 版本详情中的「正在使用」摘要 | 展示实际可确认的连接/任务引用；没有数据时明确未知，不能把「未发现引用」说成可安全删除 |
| 历史版本与测试记录 | 「记录」页，选中某个版本后在原区域显示详情 | 默认只看当前状态；用户主动进入记录后看过去版本、脱敏错误和引用。历史 secret 编号、别名、文件路径属于按需技术详情 |
| 全局密钥管理 | 与连接同级的次级管理入口，独立内容视图 | 搜索、分类、定位用途；点击当前引用前往相应连接详情。列表应保留固定行高，详情不再以内联长行展开 |

Stripe 的官方轮换步骤把替换、旧 key 到期和请求日志放在同一个 key 的操作体系中；Supabase 的流程则明确先创建新 key、替换使用者、确认迁移、最后退役旧 key。二者支持「生命周期应有清晰顺序」这一判断，但不证明 Loop Control 可以替外部供应商自动轮换。[Stripe 轮换](https://docs.stripe.com/keys#rotate-an-api-key)、[Supabase 轮换](https://supabase.com/docs/guides/security/rotate-leaked-api-keys)

## 可检查的成功条件

以下是建议方案的验收标准，不是本次已经实现或测试的结果。

1. 连续打开不同连接的模型、计费与密钥操作，屏幕始终只有一个配置主体；列表下方不累积编辑块。
2. 新建、编辑、换 key 有可识别的对象标题、保存、取消和退出；返回后列表过滤与位置保持稳定。
3. 一个连接内能找到认证、模型、计费和历史；系统控制密钥与历史秘密仍能从全局管理入口定位。
4. 更换 key 仍创建新版本；显式验证、旧任务版本引用、管理员明文读取规则保持原有业务语义。
5. 空列表、长名称、测试失败、保存失败、离开未保存更改和窄屏都在同一个容器体系中表达。

## 证据限制

没有登录控制台进行可用性测试，也没有验证各产品关闭焦点、动画或浏览器返回行为。Grafana、Vercel、GitHub 的官方图已经亲见；n8n 的容器与切换来自已读取的当前源码；Cloudflare、Stripe、Supabase 的容器结论只保留官方步骤明确支持的部分。竞品未公开或本次未找到的完整 UI 形态均标为未确认。

Vercel 存在现行文档与旧图片同时出现的情况：新公告已说明 `Secret` 保存后不可取回，因此旧图中的 reveal 控件只可用于识别布局。Supabase 本次核查了[更新索引](https://supabase.com/changelog.md)及 2026-11 的 key 文档；没有将旧 `Settings > API` 路径继续当当前入口。n8n 源码链接指向可变分支，后续实施前应重新核查。
