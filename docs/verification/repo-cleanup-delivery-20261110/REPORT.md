# 全仓清理与分批交付

2026-11-10。按 Owner 最新授权清理全项目，并分批提交、合并和推送；该授权替代此前各批「不提交推送」限制。业务规则、Owner／版本／费用校验和恢复限制保持。

清理移除了 2 个无运行消费者的旧草稿模块、11 个顶层辅助声明、27 个旧任务详情 CSS 选择器和 `react-range`。没有删除草稿数据、迁移、有效保护测试、上游组件、生成类型或动态 Worker／原生入口。覆盖与候选证据见 [AUDIT.md](AUDIT.md)，准确差异见 `cleanup.diff`。

## 验证

| 检查 | 结果 |
| --- | --- |
| 清理相关回归 | 79＋21 条通过，无失败；`cleanup-targeted.log`、`cleanup-drafts-targeted.log` |
| 类型与构建 | 类型、前端构建、随后 Worker／后端构建、固定运行包完整性通过；`cleanup-typecheck.log`、`build.log`、`runtime-prepare.log` |
| 浏览器 | 明暗 × 1280／390px 四组各 59 个节点，计算样式与几何完全相同；`browser-result.json`、四张截图。宽窄截图已人工检查 |
| 构建内容 | 清理前后 JavaScript 内容 SHA 相同；入口文件名因 CSS 关联哈希变化，见 `frontend-output-comparison.json`。不据此声称构建时间或资源性能提升 |
| 默认全量一次 | 256 文件通过，1917 条通过、1 条跳过，无失败；`full-tests.log` |
| 独立审查 | Standards 0 项发现，Spec 0 项发现；`review.md` |
| 每批暂存快照 | 7 个源码批次分别通过实际 index 内容的类型检查；`index-1.log` 至 `index-7.log` |
| 内容发布检查 | 待发布文件常见凭据模式无命中，见 `publication-scan.json`；未暂存 `.scratch`、本机运行配置或业务数据 |

默认全量不包含显式数据库集成测试；本轮未重复前轮已完成的 38 条专项真实 PostgreSQL／Worker／原生进程验收，证据保留在 `../state-machines-followup345-20261110/`。本轮清理未更改这些协议实现。没有真实供应商调用或日常数据库写入。

浏览器夹具初次运行因自身开发注入与依赖缓存冲突未挂载；已保存 `browser-initial-failure.log`、`browser-initial-errors.json`，改为无刷新注入的隔离编译后四组通过，没有修改产品代码适配夹具。保留既有 React act／jsdom 提示和构建大 chunk 提示，未放宽断言。暂存检查器初次遇到 Git 文件清单输出缓冲上限，限定为实际源码与配置清单后所有批次通过；这是检查器问题，未回退或改变产品代码。

## 分批保存

既有状态机修复、模型选择器及部署评估记录均保留；清理独立成批，没有混入历史 SQL 或未迁移 Demo。生成界面批次同时提交对应口播菜单／素材栏断言，避免留下已知旧控件失败；脚本父页面回归在对应工作区批次再提交。部分暂存只操作 index，没有覆盖工作区原文件。

| 批次 | 本地提交 | 内容 |
| --- | --- | --- |
| 1 | `1ba18aab` | feat: unify generation controls and task feedback |
| 2 | `ca4e0c38` | fix: isolate per-call confirmation lifecycle |
| 3 | `eb514104` | fix: preserve workspace lifecycle and delivery recovery |
| 4 | `b20c2b30` | fix: bind speech samples to their selection identity |
| 5 | `836e8f67` | fix: preserve model editing baselines during discovery |
| 6 | `e7fdc462` | fix: apply end-only video ranges and verify recovery fences |
| 7 | `83e5f525` | refactor: remove unreachable legacy helpers and unused range dependency |

ADR、状态机盘点、既有验证记录与部署研究作为文档批次保存；部署研究仍为未实施评估，不代表部署授权或完成。合并与远端核对结果在最终交付记录中更新。

## 工作区与运行环境

清理开始时 291 个已有变更文件已建立恢复副本；290 个字节保持，仅共享 PLAN 增加本轮记录，见 `protection-result.json`。未改初始已有功能成果。新清理模块的恢复依据来自 Git 基线与本轮快照。

本轮隔离浏览器和 5195 预览已关闭，未重启日常 5174。仅清理本轮 scratch；没有删除会话、缓存、分支、worktree、数据库或媒体文件。保留原在用固定运行版本，并已准备新的完整本地运行包；合并推送源码不等于重启日常后端或部署。

格式检查对源码与 Markdown 执行；原始 `.diff` 的空白上下文及 `.log` 的末尾换行按证据原样保留，不为消除格式提示改写历史检查输出。
