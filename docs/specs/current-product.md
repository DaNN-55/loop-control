# 当前产品约束

以现行原生本地实现为准。术语以根 CONTEXT.md 为准；架构与不变量见 docs/adr/，工作项使用 GitHub Issues。

- 单一 Owner 管理多个内容账号；账号成员关系、版本化蓝图和系列构成隔离及配置边界。
- Episode 创建时冻结版本引用；历史配置不因当前蓝图修改而改写。外部连接只冻结非秘密引用。
- 主脚本由 Owner 提供并确认；视觉、分镜、字幕正文、同步预览和 QC 保留明确审核关卡。自动继续默认关闭，必须有当前脚本及审核版本对应的授权，不自动审批。
- 静态图片、A-roll、B-roll、旁白及音效能力按已注册适配器选择；连接验证资格不替代生产前检查或生成预算。
- 当前身份、命令、任务、费用和历史都由本地 PostgreSQL、Owner API、Keychain 与 Worker 承担。控制台和 Studio 监听本机。
- 所有写操作经过 Owner 会话、Origin/CSRF、归属、冻结版本和幂等检查。Worker 领取及回写带尝试编号与租约令牌。
- 归档保留数据；永久删除需要明确确认，并处理数据库关联和对应本地文件。历史只读生产单保留原状态，不重放任务或通知。
- 发布包通过校验后才是生产完成；不表示已发布到第三方平台。

## 实现与验证入口

- `src/local-app/localRoute.ts`、`episodeCommands.ts`：本地 HTTP、审核和生产命令。
- `src/local-app/workerDatabase.ts`、`src/orchestration/workerScheduler.ts`：持久队列、规划、领取和消费。
- `src/local-app/connections.ts`、`keychainStore.ts`：版本化连接与本机秘密。
- `db/local/`：不可改写的本地基线和前向迁移；`db/contracts/`：独立数据库测试契约。
- `docs/architecture-map/`：源码对应的模块及五条运行流程。

旧 v1/v2、配置缺口及连接方案的已落地约束已归到本页、CONTEXT.md 和 ADR。原有缺口不能因文档退役就视为完成，需重新核查的项目见 backlog/local-first-optimization.md。
