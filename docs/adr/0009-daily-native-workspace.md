# ADR-0009：原界面与日常本地运行

状态：Accepted。日期：2026-10-26。Owner 已明确授权实施，暂不提交、推送或合并。

## 背景

ADR-0008 已使业务主链通过本地 API、PostgreSQL、Keychain 与应用内调度运行。此前默认页面另用简单目录外壳，运行配置仍依赖 stage-d 验收目标；这不能满足 Owner 在当前 worktree 日常使用原操作界面的要求。

## 决定

- 原项目的导航、账号、生产单表格、审核队列、运营视图、主题及详情抽屉继续作为共享界面。本地版通过既有 `/api/local/*` 操作；旧 App 保留显式 legacy 入口，不将 Supabase 客户端带入本地构建。
- 默认 `npm start/stop` 使用 `.loop-control/local/deployment.json`，缺配置明确失败，不回落验收指针、旧环境文件或云端。历史 `--deployment` 显式入口保留供旧验收复现。
- 日常资源使用独立 Colima `loop-control`、PostgreSQL 容器及数据卷、`loop_control` 数据库和 127.0.0.1 端口；应用 5174、Studio 5175、PG 54329。容器身份、应用/Worker 同库、权限、恢复回执、媒体边界和私有路径继续校验。
- 媒体、模型、Python 与 Studio 使用日常目录中的实体副本，媒体为专用 APFS sparseimage。历史蓝图、任务与产物路径不重写，由已有媒体映射解析到日常副本。
- 一次性从已完成生产单的完整备份恢复日常库，保留旧库/媒体/证据；恢复后重新初始化本地 Owner 密码和日常专用 Keychain。旧 Provider 资格清零，网络策略保持关闭，不复制已耗尽预算作为新授权。
- 持久 Worker、提醒、健康检查和完整备份由应用负责。日常完整备份复用既有快照、文件与安全指纹实现，但使用验证过的日常运行上下文；不启动 Supabase/n8n 服务。
- 新迁移只前向应用。`runtime:migrate` 先验证旧迁移 SHA、在应用待迁移前生成完整备份，再逐项事务执行。Owner 密码变更由有会话围栏的私有函数处理，不扩大应用对密码字段的直接 UPDATE 权限。

## 验证与边界

验证原界面各导航、分页与详情、真实 Owner HTTP、密码/会话、媒体/发布包、Studio、完整备份及重启。默认构建继续拒绝 Supabase SDK、旧 App 和旧控制面进入依赖图。已有测试库和旧业务快照作为保留对象检查。

本次交付针对当前已准备的 macOS worktree；跨主机安装、生产数据切换和新增 Provider 在线授权不由本 ADR 自动完成。原四家 Provider 豁免不改为技术通过。
