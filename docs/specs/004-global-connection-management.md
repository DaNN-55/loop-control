# 全局连接管理与蓝图连接选择 Spec

## Verification Echo

本次只实现全局外部连接管理，不生成脚本：Owner 上传脚本，脚本输入与审核仍是核心步骤。静态视觉、A-roll、B-roll、旁白和配乐 / 音效是独立生产能力；蓝图和 Episode 只保存连接版本的非秘密 ID，绝不保存 API Key、Endpoint 或服务账号秘密。

连接池归 Owner 工作区而非内容账号，但不设独立“外部连接”页面。Owner 在账号蓝图相应生产能力的配置弹窗中创建、验证、选择或轮换全局可复用连接；蓝图只能为实际会调用外部 Adapter 的能力选择兼容的已验证版本。Episode 冻结该版本 ID；连接轮换、撤销或失效不会自动故障转移，Owner 必须显式修复受阻 Episode。

当前蓝图只含测试配置。首期不导入 `pexels-default` 等硬编码默认连接；新连接池为空，由 Owner 重新填写认证材料并验证。前向迁移仅清空测试蓝图的五项可选能力旧 Adapter / 连接配置和默认引用，不删除账号、核心脚本流程、系列、Episode、素材或审核数据。

## 目标

1. 在账号蓝图的生产能力配置弹窗中管理 Owner 全局、可复用的外部连接。
2. 将认证材料交给 Worker 的受保护秘密存储；控制面、任务快照、审计和普通日志均不接触原值。
3. 蓝图按生产能力选择一条已验证的连接版本；Provider、Adapter 和 Endpoint 不再由蓝图自由填写。
4. 复用现有 `credential_ref` JSON 字段保存连接版本 ID，保持 Episode 和 SQL 编排的冻结字段形状。
5. 让生产前检查明确引导“编辑蓝图”“管理连接”“重试”或“联系环境管理员”。
6. 让每项生产能力显式选择外部、本地或人工素材执行路径；首次启用不自动选择，未部署或未就绪的本地工具不可选。

## 非目标

- 不新增 Provider、Adapter、插件平台或自定义 Endpoint。
- 不实现后台定时健康检查、Webhook、自动故障转移或自动密钥轮换。
- 不把秘密存进业务数据库，不选定具体 KMS/Vault 产品。
- 不删除非连接测试数据，不改写已部署迁移历史。
- 不改变脚本上传边界，也不新增脚本生成能力。
- 本批不实现 HyperFrames 卡片、Voicebox TTS 或其他新的本地 Adapter；只建立本地路径的注册与就绪边界。

## 领域与持久化模型

### Owner 工作区

首期以 `auth.uid()` 作为 Owner 工作区标识。所有连接记录与 RLS/RPC 授权均只允许该 Owner 读取和操作；内容账号只通过蓝图引用连接版本，不能拥有连接。

### 三个元数据集合

| 集合 | 最小字段 | 约束 |
| --- | --- | --- |
| `external_connections` | `id`, `owner_user_id`, `name`, `description`, timestamps | `owner_user_id + name` 唯一；名称/说明可原地修改。 |
| `external_connection_versions` | `id`, `connection_id`, `capability`, `provider`, `adapter`, `endpoint`, `secret_ref`, `status`, timestamps | Provider、Adapter、Endpoint 或认证材料变化时新增版本；`secret_ref` 不透明，真实材料不在本表。 |
| `connection_verification_results` | `id`, `connection_version_id`, `checked_at`, `status`, `reason`, `check` | 追加记录、原因脱敏；不存请求头、URL 中的秘密或认证材料。 |

一个连接版本只绑定一个已注册的 `capability + provider + adapter`。已引用版本不可硬删；未引用草稿可以删除。测试通过后状态为“已验证”；认证无效、撤销或版本变更使其不可选；超时、429、5xx 等可重试失败只追加结果，保留上次已验证资格。

`credential_ref` 的语义改为连接版本 ID。蓝图保存、Episode 创建和“修复并继续当前生产单”必须在服务端同一事务验证：版本属于当前 Owner、兼容目标能力且已验证。前端下拉过滤只改善体验，不能承担此约束。

### 执行路径

蓝图为每项已启用生产能力显式选择一个执行路径。外部路径由已注册 Adapter、其可选模型或预设目录和一条已验证连接版本组成；本地路径由已注册且当前 Worker 报告就绪的 Adapter 与其目录组成；人工素材路径按该路径的任务粒度生成待补齐素材清单，不创建 Worker 任务。模型、声音和卡片预设只能从 Adapter 声明的目录中选择，不能自由输入；Provider、Adapter、Endpoint 和认证材料也不能自由输入。

首次启用能力没有默认执行路径。Episode 创建时冻结路径、模型或预设以及外部路径的连接版本 ID；当前蓝图修改只影响新 Episode。初始任务粒度为：HyperFrames A-roll 每分镜场景一张卡片、B-roll 每镜头一张卡片、旁白每期脚本一段音频；这些路径只有在相应本地 Adapter 真正部署且通过就绪探测后才可选。

## Worker 秘密边界

连接版本写入 `secret_ref`，它由 Worker 秘密存储返回并只可由 Worker 解析。Owner 通过受保护的一次性写入操作创建或轮换认证材料；之后页面只显示脱敏状态和验证结果，绝不回显原值。

实现前需要完成一个技术 gate：在实际部署环境中选择并验证一个 `put / resolve / revoke` 的 Worker 秘密存储实现。该选择不得改变上面的控制面接口，也不得使秘密进入 Supabase 业务表、蓝图 JSON、Episode 快照、任务包或普通日志。

Worker 在生产前检查和每次任务执行时分别按 `credential_ref` 解析秘密；任务包仅携带该引用。适配器注册表继续是 Worker 支持能力、执行位置、官方 Endpoint、允许认证方式及可选模型或预设目录的权威目录，并移除硬编码连接列表；本地 Adapter 还必须报告当前就绪状态。

## 验证与预检契约

Owner 点击“测试并验证”后，Worker 对指定连接版本进行最小的 Adapter 安全探测：Endpoint 可达、认证有效、最小权限可用。该测试不使用账号蓝图的模型、声音或 Prompt，不生成可见媒体产物。

连接验证结果独立于 Episode 预检。生产前检查升级为 `worker-preflight/v2`；读取方同时解析 v1 与 v2，Worker 只产生 v2。v2 继续使用 `{ capability, check, phase, status, reason, action, scope }`，并增加：

| 场景 | `action` / `scope` |
| --- | --- |
| 蓝图缺少引用或引用与能力不兼容 | `edit_blueprint` / `blueprint` |
| 连接版本不可用、认证无效或密钥拒绝模型 | `manage_connection` / `connection` |
| 超时、429、5xx 或临时网络故障 | `retry` / `connection` 或 `worker`，按探测来源确定 |
| Worker 未注册或未就绪的本地 Adapter、挂载/系统权限失败 | `contact_environment_admin` / `worker` |
| 模型缺失或不受 Adapter 支持 | `edit_blueprint` / `blueprint` |

人工素材路径不需要连接，也不参与连接预检；对应素材清单未补齐时由生产流程阻塞，而不是伪造为连接或 Worker 故障。

## 界面与流程

### 账号蓝图 → 生产能力配置弹窗

1. 启用能力后显示“配置”，但不自动选择任何执行路径。
2. 弹窗先按能力筛选已注册路径。外部路径只显示兼容的已验证连接；可在同一弹窗新建命名连接、一次性填写允许的认证材料并显式测试，验证通过后才可选择。Provider、Adapter 和官方 Endpoint 为派生只读信息。
3. 本地路径显示 Worker 就绪状态且不显示连接字段；未部署或未就绪时不可选择。人工素材路径显示该能力按任务粒度需要的素材清单，不创建外部任务。
4. 模型、声音和卡片预设从所选 Adapter 的目录筛选；蓝图可保存缺少路径或连接的草稿，Episode 创建时由预检或素材清单阻塞。
5. 连接仍归 Owner 全局工作区并可被其他账号复用。当前蓝图修改供新 Episode 使用；已有 Episode 保留快照，受阻 Episode 只能显式修复，且仅重排受影响任务。

## Clean-slate 前向迁移

1. 新建三组连接元数据表、Owner 授权/RLS、服务端写入与验证入口；连接表初始为空。
2. 保留 Adapter 注册，但移除注册表中的 `*-default` 连接和环境变量映射。
3. 仅清空测试蓝图中五项可选生产能力的旧 Provider / Adapter / `credential_ref` 配置；不删除账号、系列、Episode、素材、审核、产物或审计记录。
4. 不编辑历史迁移文件。对旧 Episode / 任务的测试引用，不提供遗留硬编码回退；它们若实际需要外部执行，按缺少当前配置进入结构化阻塞。

## 实施顺序与验收

1. 完成秘密存储技术 gate，并以单个假连接验证：控制面不能读回原始秘密，Worker 可按 `secret_ref` 解析。
2. 编写前向迁移与 RLS/RPC；验证连接池初始为空，测试蓝图只清除目标能力配置。
3. 改造 Adapter 注册与 Worker 解析、连接验证和 `worker-preflight/v2`；保留 v1 读取兼容。
4. 实现蓝图能力配置弹窗中的路径筛选、连接创建/测试/选择与人工素材清单；不新增独立连接页。
5. 在 Worker 注册表中支持外部、本地和人工素材路径及本地就绪探测；本批不登记尚未真实部署的本地工具。
6. 运行 `npm run check`、`npm test -- --run`、`npm run worker:build`、`npm run build`、`npm run db:migrations:check`，并执行数据库级迁移/RPC测试。

验收场景至少覆盖：

- 新 Owner 初始没有连接；创建草稿后只有显式测试成功才可被蓝图选择。
- API Key、Endpoint、服务账号材料不出现在蓝图、Episode、任务、验证结果、审计或普通日志。
- 同一 Provider 的两条已验证连接可被不同蓝图显式选择；不会自动切换。
- 认证无效指向“管理连接”，临时故障指向“重试”，蓝图引用错误指向“编辑蓝图”。
- 连接轮换后，新 Episode 使用新版本；旧 Episode 保留原引用并按显式修复迁移。
- 人工素材完全满足的能力不要求外部连接。
- 首次启用能力不会默认选择可用连接或本地工具；未就绪的本地工具不会出现在选择项中。
- 模型、声音和卡片预设只能从当前 Adapter 目录选择，且 Episode 冻结其选择。
- 测试蓝图的旧连接配置清空，但非连接数据保持不变。
