# 当前产品约束

以现行原生本地实现为准。术语以根 CONTEXT.md 为准；架构与不变量见 docs/adr/，工作项使用 GitHub Issues。

- 单一 Owner 管理多个内容账号；成员关系、版本化创作蓝图和系列构成隔离与内容边界。已被 Episode 引用的蓝图保留原 ID、版本和内容；变更创建新当前版本，旧任务、候选和 Episode 不重指新规则。
- 蓝图只保存创作规则。媒体能力、服务 / 模型 / 连接、审核关卡和目录配置退出新蓝图；旧字段保留历史读取或一次初始预填。
- 正式流程为脚本确认、素材准备与匹配、剪辑工作台、检查与交付。主脚本由 Owner 提供；普通脚本规划在制作准备选择已有 Codex 模型 / Prompt Harness，v2 直接准备不要求未使用的规划配置。
- 制作服务按图片、视频、语音、音乐与音效的实际能力分组。视频统一 AI、Pexels 查询 / 预览 / 导入和上传，当前不按 A-roll / B-roll 限制工具。
- 逐次请求冻结连接版本、模型 / 预设、参数、创作上下文、输入指纹、目标版本和费用依据。改选或刷新不自动执行、计费、采用或替换已有成果；重试使用原请求，未知提交先恢复或核对。费用预留与预算保护保留。
- 原生工程拥有时间线、构图、声音和字幕。候选明确采用后才改变工程；音频 / 窗口变化使旧字幕证据失效，最终成片确认绑定当前实际导出文件。蓝图不再配置替代审核开关，也不自动审批。
- 每账号拥有现有授权范围内的实际专属目录，生产单按稳定 ID 隔离。禁止跨账号同根、父子根和别名重叠；已有文件经盘点、复制、指纹 / 引用验证和原子映射迁移，失败保留原位置，可恢复，原件不自动删除。
- 身份、命令、持久任务、费用和历史由本地 PostgreSQL、Owner API、Keychain 与 Worker 承担。Owner / Origin / CSRF、归属、版本、幂等和 Worker 尝试 / 租约校验继续执行；控制台与 Studio 监听本机。
- 归档保留数据；永久删除需要明确确认，只处理明确归属的关联与文件。已完成 / 归档生产单保持只读，不因设置简化重放旧任务。平台数据库、秘密、公共工具、独立历史库和备份不搬入某个账号目录。
- 交付包通过校验后才是生产完成；不表示已发布到第三方平台。受控服务与真实文件验收不等于实时付费服务或供应商质量验收。

## 实现与验证入口

- `src/local-app/localRoute.ts`、`episodeCommands.ts`：本地 HTTP、审核和生产命令。
- `src/local-app/workerDatabase.ts`、`src/orchestration/workerScheduler.ts`：持久队列、规划、领取和消费。
- `src/local-app/connections.ts`、`keychainStore.ts`：版本化连接与本机秘密。
- `db/local/`：不可改写的本地基线和前向迁移；`db/contracts/`：独立数据库测试契约。
- `src/local-app/productionSelection.ts`、`src/connections/serviceCatalog.ts`：实际服务目录与统一选择校验。
- `src/local-app/accountAssetRoots.ts`、`accountDirectoryMigration.ts`：真实目录归属与验证迁移。
- `docs/architecture-map/`：生成时的模块与流程快照；当前归属以 ADR-0018 和已验证代码为准。

旧 v1/v2、配置缺口及连接方案的已落地约束已归到本页、CONTEXT.md 和 ADR。原有缺口不能因文档退役就视为完成，需重新核查的项目见 backlog/local-first-optimization.md。
