# 迁移完成（2026-11-10）

用户已核对并批准迁移。37个已核对文件逐一SHA校验迁入主程序，另按浏览器标注仅修改foundation.css展开侧栏token：208px→180px，保留64px折叠与900px窄屏规则。恢复副本在migration-before/。

主项目67回归、10真实集成、类型检查、前端／Worker／后端构建和固定运行包完整性通过。日常5174已更新：PID25156，运行包9b88a52ec70dd1788fee24218fdf9f14f61e7edff2814235e11a964cf82f87fb。实际已登录页面核对连接／文件清理正常；旧历史链接回工作台；侧栏实测展开180px、折叠64px。账号／系列／生产单／任务数据指纹及迁移157保持，无数据删除或SQL迁移、无付费、无暂存提交推送。证据见evidence/migration-*、retirement-migration-*及migrated-sidebar-180.png。

下文保留迁移前隔离核对记录，其“尚未迁移”描述仅代表当时状态。

---

# 旧历史页面退役清理（仅隔离）

当前主项目未迁移。原4.4归属核查及SQL158已取消。

已拆出现用连接配置弹窗和文件大小格式化函数；移除历史资料／历史生产单页面、旧系统维护容器、旧路由状态、专属HTTP入口和新建历史删除命令。保留当前连接、独立文件清理、备份恢复、历史数据及旧清理回执的引用／身份保护。连接设计预览仍使用的共享外壳样式保留。

本批：5新增、17修改、15删除。准确SHA与差异见 migration-manifest.json、cleanup.patch。未改数据库迁移或实际数据，无提交推送。

## 删除清单

- src/local-app/HistorySources.tsx
- src/local-app/LocalHistory.test.tsx
- src/local-app/LocalHistory.tsx
- src/local-app/LocalMaintenanceEmbedded.test.tsx
- src/local-app/LocalMaintenancePanel.tsx
- src/local-app/history.css
- src/local-app/history.integration.test.ts
- src/local-app/history.ts
- src/local-app/historyEmptyStates.integration.test.ts
- src/local-app/historyEpisodeDeletion.integration.test.ts
- src/local-app/historyEpisodes.ts
- src/local-app/historyFilterOptions.integration.test.ts
- src/local-app/historyOrganization.integration.test.ts
- src/local-app/historyPresentation.test.ts
- src/local-app/historyPresentation.ts

## 保留与验证

- 现用连接弹窗从旧维护文件独立，5个关键节点的几何与字体、间距、背景、边框、阴影对照一致。文件大小函数与原实现逐字节比较仅更名。
- 67项定向回归通过：42项路由／工作台／清理／范围／状态／共享组件，加25项连接与草稿导航。
- 10条真实集成通过：旧HTTP GET404、POST405、旧新增命令400；当前搜索／连接／目录API200；旧回执可收尾、共用与变化文件保留、Owner隔离；普通删除中断恢复和账号边界保持。
- 类型、前端构建、Worker／后端构建与运行包完整性通过，已有大包提示保留。未跑全项目测试。
- 实际页面验证旧书签回到工作台并移除旧参数、当前连接弹窗、文件清理及390px。证据在 evidence/，全量测试日志与前后截图均保留。
- 1175个主项目基线文件及暂存区未变；日常PID70075、固定运行包及157保持，5174／5203均HTTP200。
- 源码恢复包 source-before.tar.gz，两份领域文档原文在 document-before/；不通过整树覆盖恢复主项目。

## 核对入口

http://127.0.0.1:5203/__retirement?view=history&source=retired&historyTab=sources

打开后应回到工作台，地址变成view=operations。右上所有者菜单保留连接配置与文件清理，不再出现旧历史／系统维护入口。打开连接配置核对原界面；文件清理中3个合成旧回执用于兼容核对，执行会消耗样例。此预览仅允许重试这些回执，其他写入被阻止，未调用付费Provider。

此前已有计划和报告仅作历史记录；本清理待核对通过后才迁移。
