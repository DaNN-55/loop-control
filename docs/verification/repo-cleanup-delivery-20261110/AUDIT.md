# 全仓清理范围与证据

2026-11-10。用户明确授权全项目代码清理、分批提交、合并与推送；保留业务行为和恢复限制，不包含删除缓存、会话或 worktree。基线 `62885252`，原暂存区为空，初始 291 个已有变更文件已保存 SHA 与恢复副本。清理范围为本机应用的第一方代码、脚本、配置和资源入口；生成代码、第三方组件、迁移与业务历史保留其原职责。

## 覆盖方法

扫描 `src / scripts / public / db` 的 1167 个文件，其中 TS／TSX／JS／MJS 916 个。使用现有 TypeScript AST／模块解析器建立导入图与标识符候选表，结合所有测试、脚本、HTML、tsconfig、package scripts 和字符串注册逐项复核。29 个首次导出候选不能直接视为死代码；复核后处理 13 个无消费者导出及其私有支持声明，保留 16 个动态或上游／生成声明。

| 领域 | 实际核对入口与责任 | 结论 |
| --- | --- | --- |
| 启动与前端 | `index.html → local-app/main.tsx → LocalCatalogApp`，共享 views、确认／草稿与媒体组件 | 删除无入口旧实现，当前交互与草稿规则保持 |
| Owner API／业务 | `localRoute / episodeCommands / ownerTransaction / connections`；公开路由、CSRF、版本与幂等 | 保留路由与边界校验；无事务或恢复行为简化 |
| Worker／编排 | `localWorkerCli / workerDispatch / codex / registeredAdapters` 与 tsconfig 编译根、虚拟模块 | 动态入口并非孤儿，全部保留 |
| 存储与恢复 | `episodeFiles / nativeAttemptOutput / mediaRootExecution`，SQL 迁移与历史兼容 | 未改协议、目录证明、发布 fence、已应用迁移或数据 |
| 运行与构建 | `npm` 脚本、runtime start／application／backup、storage 脚本、Python 对齐器 | 保留原入口；只移除无消费者依赖 |
| 样式与公共资源 | 主 CSS、Dan UI 上游清单、模型图标路径与许可证 | 仅移除旧任务详情的 27 个无消费者选择器；共享选择器保持 |
| 测试与历史记录 | 所有默认及显式集成测试入口、fixture config、docs／content 留存 | 未删除保护测试、业务材料或历史验证证据 |

这是一轮全仓入口与消费者审计，不是对全部外部 SDK、所有历史数据或全部故障组合的形式化证明。当前包 `private: true` 且无对外 package exports；清理的 TS 辅助导出不是发布接口，Owner HTTP／Worker／原生协议仍保持。

## 实施候选

| 候选 | 消费者／存在原因证据 | 实施与验证 |
| --- | --- | --- |
| `reviews/materialImportDraftStore.ts`、`operationDraft.ts` | 全仓导入图不可达；原材料／审核界面退役后未再调用。源、脚本、CLI 和字符串入口均无引用 | 删除 2 个模块，不删除 IndexedDB／localStorage 数据。当前 `WorkspaceDraft`、连接草稿及离开保护保持；相关测试通过 |
| 脚本与审核辅助 | `isProductionScriptV2`、`requestShotStructureRevision`、`studioReplacementWarningFromPayload` 无消费者 | 删除辅助函数、关联请求类型和多余导入；现有脚本解析、审核 RPC、工程替换保护仍有实际实现并保留 |
| 旧审核动作与任务详情 | `reviewActionFor` 的表和私有类型仅服务自身；`TaskTimelineDetail` 无渲染入口 | 删除整个无职责分支及专用 CSS。保留 `TaskProgressPanel`、Worker 步骤和错误显示，浏览器前后核对 |
| 手工素材与标签 | `boundManualClipSelection`、`shotTransitionModeLabels`、`bgmDuckingLabels` 无消费者 | 删除叶节点，不改变实际素材绑定、时段校验、转场或闪避数值规则 |
| `react-range` | 所有运行、构建、脚本和 CSS 入口无引用；`npm ls` 仅根依赖。当前滑杆使用现有控件，原旧界面已退役 | 通过 npm 离线移除，锁文件只删除该条目，实际安装树已无此包；没有升级或新增依赖 |

共删除 11 个顶层声明及 2 个完整旧模块、27 个无消费者 CSS 选择器和 1 个依赖；未删除测试。清理前相关默认全量 1917 通过、1 跳过，作为行为基线。

## 明确保留

- AST 零引用的 4 个 OpenChatCut 虚拟模块导出由代码注入字符串消费，不能删除。
- `localWorkerCli / nativeBackup / storyboardRevisionExecutor / workspaceDeliveryWorker / workerResultSchema` 由编译配置或运行时加载，不能删除。
- `vite-env.d.ts`、测试 setup、fixture config 和显式 prototype HTML 是框架／CLI 入口。
- 生成的 `database.types.ts` 和带 `UPSTREAM.json` 的 Dan UI 组件遵循既有生成／上游范围，不按当前实例数剪裁。
- 生产状态机现已采用各自正确的权威；没有证据支持移除租约、未知提交、Owner、版本、回执校验或把它们合成通用状态框架。

没有重划模块职责、数据迁移、协议改名或兼容性取消。本轮局部收尾复核未发现还需增加新抽象的等价简化。
