# 第 5 项：工作树、日志与缓存的只读空间盘点

采集于 2026-11-12（Asia/Shanghai），任务目录沿用 2026-11-11。只读取目录索引、lstat、进程／打开句柄与必要 Git 元数据；不读取待盘点文件正文、不计算目标文件内容 hash。仅写本阶段报告、元数据证据与待审脚本。**删除 0、脚本执行 0（含 dry-run）、工作树移除 0、进程停止 0。**

## 结果

Git 当前只登记主工作树与本轮成果工作树，两处均活跃且有未提交改动，全部保留。安全清理候选仅为本轮隔离树的 TypeScript 增量缓存和 Vitest 结果缓存：**逻辑字节 74,079；按 stat_blocks 估计分配占用 81,920 字节，即 80 KiB**。这只是供审核的可再生缓存估计，本轮实际释放空间为 0。

Codex 日志／会话仅合计统计：**2,101 个普通文件，逻辑大小 3,127,718,530 字节（约 2.913 GiB），分配占用 3,137,400,832 字节（约 2.922 GiB）**。这些日志全部属于 review-first，不计入安全收益。

## 工作树与提交状态

权威入口为 `git worktree list --porcelain`。只读 `git ls-remote` 重新核实远端 main 为 `aa404667e949225c8fad1dae2e2aed56887cb357`；没有 fetch、prune 或分支操作。本任务专用远端分支查询没有返回记录。两处 HEAD 与该远端 main 相同，祖先关系成立，提交差均为 0／0；这只证明已提交基线已发布，**不代表未提交成果可以从远端恢复**。

| 工作树／分支 | Git 状态（元数据采集时） | 空间口径与活动证据 | 分类 |
| --- | --- | --- | --- |
| `/Users/dan/Programs/loop-control`／`main`，upstream=`origin/main` | 暂存 0；未暂存 3；未跟踪 0。3 个 CSS 并行改动保留 | 排除 `.git` 与整个 `.loop-control` 后，普通文件逻辑 680,447,340 字节，分配 801,370,112 字节；日常 PID 81218 与其他项目相关 Node 工具 cwd 在此树 | review-first；日常主树，不能移除 |
| `/Users/dan/.codex/worktrees/maintenance-20261111/loop-control`／`codex/maintenance-five-steps-20261111`，无 upstream | 暂存 0；未暂存 31；未跟踪 131。包含前项源码、测试、报告和证据，后续本报告会增加未跟踪文件 | 同口径逻辑 643,945,486 字节，分配 769,671,168 字节；本轮交付仍在使用。未发现 cwd 位于此树的 Node/npm/tsc/Vite/Vitest/tsx 进程 | review-first；未提交成果未发布，不能移除 |

上述工作树总量是有限范围快照，不含共享 Git 对象库、运行时、SDK、数据库或媒体；未跟随也未计符号链接对象空间，不等同 `du` 整树口径。两处总量不作为可释放空间相加，APFS 共享 extent 也未做底层去重。没有登记可确认已退役的第三处工作树；不扫描其他项目或按目录名称猜测孤立 worktree。证据见 [worktree-inventory.txt](step5-evidence/worktree-inventory.txt)、[worktrees.json](step5-evidence/worktrees.json)、[remote-refs.json](step5-evidence/remote-refs.json)。

## Codex 日志的整体度量

只对 `~/.codex/sessions`、`archived_sessions`、`log` 和 `history.jsonl` 做合计元数据遍历；没有读取正文、标题或项目归属，没有按月份／项目／会话拆分，也没有扫描凭据、状态数据库、记忆或其他 Codex 私有目录。合计使用跨这些根的同一 `(device,inode)` 集合去重，符号链接不跟随；本次没有重复 inode、符号链接或统计错误。详见 [codex-log-total.json](step5-evidence/codex-log-total.json)。

这是 2026-11-12T00:19:25.692398+08:00 的活动日志大小快照；本聊天仍会产生新日志。年龄和体积不能证明日志已无接续／审计用途，且无法在不读取内容的前提下证明所有权和保留责任，因此没有生成任何日志删除命令。

## 构建／缓存分类

下表分配字节按目标目录内唯一 inode 的 `stat_blocks × 512` 统计，目录本身计入。嵌套于工作树的量不能再与工作树总量相加。

| 对象 | 分配字节／元数据 | 归属、再生方式与当前使用证据 | 分类 |
| --- | --- | --- | --- |
| 隔离树 `node_modules/.tmp` | 53,248；2 个 `.tsbuildinfo`、无符号链接 | 现有 TypeScript check/build 的增量元数据，可由 `npm run check` 重建；与源码分离。无相关构建工具进程 cwd／打开句柄；候选快照固定 | safe-to-remove，仅列入待审脚本 |
| 隔离树 `node_modules/.vite` | 28,672；仅 Vitest 子目录内 1 个结果缓存文件、无符号链接 | Vitest 测试结果缓存，可由 `npm test` 重建。真实验收日志另在阶段证据中保留；未发现 Vite 预打包或运行应用消费者，且无相关工具进程／打开句柄 | safe-to-remove，仅列入待审脚本 |
| 主树 `node_modules/.tmp / .vite` | 53,248／16,437,248 | 可再生类型与工具缓存，但主树活跃且有并行修改；Vite／其他 Node 工具在用。lsof 未持有具体文件不能证明不用缓存 | review-first；不纳入脚本 |
| 主树 `.loop-control/local/state/vite-cache` | 20,443,136 | 已知日常 Vite 的显式 cacheDir；日常 PID 81218 活跃。缓存文件可在请求间关闭，不能凭零打开句柄删除 | review-first；不纳入脚本 |
| 主树／隔离树 `dist` | 6,860,800／6,868,992 | 现有 build／runtime:prepare 可重新构建，但准备与验证链可能消费；本轮不证明可丢弃当前构建交付状态 | review-first；不纳入脚本 |
| 主树／隔离树 `.loop-control/runtime-releases` | 即时目录数 14／4；没有遍历发布物载荷或统计可删量 | 包含当前运行 `2557fbeb…`、已准备版本及回退证据，不是任意可再生缓存；未建立旧版本保留责任与精确恢复证明 | review-first；全部保留 |
| 两树 `node_modules` 整体 | 工作树统计已含 | 当前 24 项直接依赖有消费者（第 3 项已验证）；整套安装树不是无用缓存 | review-first；不纳入脚本 |
| `.vite-temp`、主树 `.scratch` | 本次均空，分配 0 | 空目录没有可报告的实际空间收益 | 保留；不为凑数量加入删除目标 |

工具职责沿用已验收的第 2、3、4 项记录，本阶段没有为确认归属重新打开源码或私有配置。候选大小与 lsof 结果见 [cache-candidates.json](step5-evidence/cache-candidates.json)，相关进程只保留本项目匹配项，见 [process-use.json](step5-evidence/process-use.json)。**单独的 lsof 零结果不是安全证明**；安全两项还需固定的再生职责、独立范围、无相关运行工具，以及执行时的快照复核。

## 待审脚本与验证

脚本为 [step5-cleanup-reviewed.sh](step5-cleanup-reviewed.sh)，文件模式 0600，不自动执行。只有用户审核后自行显式传入 `--apply` 才会尝试清理；不带参数只显示无操作说明，但本轮连此分支也没有运行。

- 目标仅为上述隔离树两个精确目录；没有通配删除、日志／会话／源文件／SDK／运行包／工作树／分支操作。
- 运行时核对固定仓库路径、目录身份、HEAD／分支、限定源码变更集合、node_modules 身份、全部缓存条目的 device／inode／mode／size／mtime、符号链接／特殊文件、相关构建工具进程与打开句柄。变化或可见性不足即拒绝，要求重新盘点。
- Git 检查仅覆盖源码、脚本和构建配置，故主 Agent 更新 PLAN、总报告和本阶段证据不会必然使脚本失效。这里的 Git 状态集合不是对源码内容相等的证明；脚本只删除可再生缓存，不接触源码。
- 两缓存之外没有可移除工作树。未来若另行批准移除工作树，应重新核对未提交／未推送／活动状态并使用 `git worktree remove`，不得用强制目录删除替代；本脚本没有此动作。
- `bash -n` 与嵌入 Python 的 `ast.parse` 均通过，只证明语法；实际删除及资源竞态均未端到端验证，也不提供跨进程锁或原子性保证。详见 [script-validation.json](step5-evidence/script-validation.json)。没有运行主体或 dry-run，也没有为制造验证样本执行删除。

脚本内置元数据快照，无需读取外部 `/tmp` 文件。81,920 字节只是审计时的分配估计，APFS 共享、文件系统回收和后续变化可能使实际释放不同；日志、工作树、runtime release 和 review-first 项一律不计入安全收益。

## 问题、建议与实际影响

| 编号 | 问题／证据缺口 | 建议 | 对项目的实际影响与处理 |
| --- | --- | --- | --- |
| S5-R01 | 两处工作树 HEAD 均已在远端 main，但都有未提交成果，隔离分支也无 upstream | 保留两树，后续先完成成果审查与明确 Git 交付，再另行判断退役 | 删树可能丢失本轮清理成果或并行 CSS 工作；本次没有删除或提交 |
| S5-R02 | Codex 日志约 2.922 GiB 分配占用，但只统计整体元数据，不能证明会话是否仍承担接续／审计责任 | 全部 review-first；需要释放时先由用户明确保留范围与归档策略，再单独盘点 | 不把大体积等同无用，不生成会话／日志删除命令；本次不释放该部分 |
| S5-R03 | 日常 Vite 缓存、dist 和不可变运行包可能有间歇消费者；无打开句柄不是未使用证明 | 保留；日后按实际停止／重建窗口和版本保留责任逐项确认 | 避免日常服务缺少缓存、装配产物或回退证据；不承诺对应可回收量 |
| S5-R04 | 缓存内容或相关工具可能在审计后发生变化，APFS 共享量也无法由 stat 推算 | 用户审核后由脚本复核快照与活动性，变化即重新盘点；以 80 KiB 为审计时分配估计，不承诺实际回收 | 不执行过期批量删除；这是有界缓存脚本，不能当通用空间清理器 |

## 保护和覆盖边界

两工作树共 22,288 个初始跟踪路径的 lstat 元数据（device／inode／mode／size／mtime）前后均未变化；只保存元数据，不读取内容或 hash。完整基线在 `/tmp/loop-maint-step5-20261111/protected-metadata-before.json`，轻量结果在 [protection-check.json](step5-evidence/protection-check.json)。元数据不变不是内容不可被保持时间戳地改写的形式化证明；本阶段命令没有对目标做任何写入。

主树初始 3 处并行 CSS 修改保持；没有统计或进入 `.loop-control` 内的媒体、SDK、数据库、秘密和发布物载荷，只对已确认的 Vite 缓存做有限元数据计量、对 release 根做即时目录计数。共享 Git 对象库、其他项目／未登记目录和底层 APFS extent 未覆盖；未声称整机无其他可清理内容。

初次脚本生成器发生嵌套引号 SyntaxError，Python 在执行任何语句前即失败；修正生成器后只写本任务脚本，随后只做静态语法检查。没有以执行删除来验证脚本，也未改目标目录适配检查。
