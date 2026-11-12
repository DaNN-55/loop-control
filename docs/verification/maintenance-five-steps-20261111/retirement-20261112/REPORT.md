# 批准的旧模块退役与分批本地提交

2026-11-12。用户明确批准决定清单1–4退役和14分批本地提交，其余暂缓；不合并、不推送。所有成果沿用隔离分支 `codex/maintenance-five-steps-20261111`。本记录与维护证据由第7个文档提交保存；其提交号以本文件所属Git提交为准，不预填自身SHA。

## 退役与逐项主审

| 顺序 | 删除对象（实现及专属测试） | 删除行数 | 当前功能检查 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | clipTiming | 59 | workspaceVideo、shotComposition：4项；构建 | 通过，主Agent核对其他受保护文件未变 |
| 2 | shotAcceptance | 22 | sharedViews、工作区导航：12项；构建 | 通过，主Agent核对其他受保护文件未变 |
| 3 | reviews/materialImport | 119 | 材料列表、手动上传、视觉上传：16项；构建 | 通过，主Agent核对其他受保护文件未变 |
| 4 | worker/manualMaterialChecklist | 95 | Worker契约、运行前置检查、手动上传：23项；构建 | 通过，主Agent核对其他受保护文件未变 |

4项由执行子Agent严格按顺序处理，每项完成后停下，由主Agent亲读检查结果、核对完整删除差异与保护快照后，再派发下一项。共删8文件295行，其中实现190行、专属测试105行。没有新增替代实现，没有修改当前生产输入边界、历史任务、冻结快照、SQL、迁移或实际素材。

删除前4份专属测试全部通过，共10项。删除这些测试是用户明确退役旧合同的决定，不是为掩盖失败；当前正式路径的对应回归仍保留。当前src/scripts及入口配置对旧模块路径和特有导出名称搜索无剩余引用，见 [remaining-consumers.json](evidence/remaining-consumers.json)。历史验收文档中的原引用保留为时点证据。

## 最终验证

最终第4项的 `npm run build` 已包含TypeScript项目构建与Vite构建；随后顺序运行 `npm run runtime:prepare` 和 `npm test`，避免Vite清空dist与测试读取发生竞争。运行包准备和完整性检查通过，完整默认 **288文件、2112项通过，0失败、0跳过**。本轮不重复此前真实集成：新变化只有已批准的不可达模块和专属测试退役，没有改当前执行实现。

测试文件比前轮少4个，测试用例比退役前当前源码应有的2122项少10项，正是本次明确退役的旧合同。四轮定向覆盖有交叉，不相加当全量结果。保留已有构建大chunk提示及测试act/media stderr，没有放宽断言。

原始日志见 [evidence](evidence/final-test.log)：`legacy-baseline.log`、`item1–4-tests/build/protection`、`final-prepare.log` 和 `final-test.log`。每项原件与完整保护基线在 `/tmp/loop-retirement-20261112/`，Git `aa404667` 也可恢复。主Agent独立检查1149受保护源/配置/ADR：仅8批准文件删除，其余1141份不变；主工作区3个并行CSS内容指纹不变。

## 本地提交

每批只暂存表内授权路径；提交前核对实际index路径、空白检查、暂存blob与已验收源码SHA-256一致，提交后再核对实际提交路径。没有使用 `git add -A`、`commit -a`、整树reset或stash。源码批次如下：

| 批次 | 本地提交 | 内容 |
| --- | --- | --- |
| 01 | `3c1028b6fdbd` | refactor: remove unused cleanup dialog and navigation declarations |
| 02 | `e7021967364b` | refactor: consolidate equivalent runtime and workspace helpers |
| 03 | `d95ee735c913` | refactor: retire legacy clip timing contract |
| 04 | `fad2671754ff` | refactor: retire legacy shot acceptance contract |
| 05 | `bc15f72e07ae` | refactor: retire legacy material import contract |
| 06 | `991ab681790f` | refactor: retire legacy manual checklist contract |
| 07 | 本记录所属提交 | 维护计划、审计证据、批准退役与本地交付记录 |

完整路径与源码提交回执见 [commit-plan.json](commit-plan.json) 和 [source-commits.json](source-commits.json)。前轮已验收的死声明清理和6组等价归并分别成批，4项本次退役分别成批，文档另批；没有把主工作区并行CSS纳入隔离提交。所有源码提交均保持已验收工作文件字节不变，不因提交元数据变化重复测试。

## 暂缓与交付边界

- 其余决定5–13、15继续暂缓；不进一步提取工具、不替代依赖、不改调度/备份/日志策略、不清缓存。
- 原80KiB缓存待审脚本绑定旧HEAD和源码集合。本次退役/提交后快照已过期，不执行或刷新脚本；以后若批准清理须重新盘点。
- 主工作区 `SystemStatusDrawer.css / styles.css / ui/impeccable/maintenance.css` 三个并行改动保持，主分支和远端没有本轮合并/推送。
- 没有重启日常服务、部署、调用付费Provider、写入日常数据库或处理真实作品。源码保存在隔离分支；日常运行版本不因此更新。
