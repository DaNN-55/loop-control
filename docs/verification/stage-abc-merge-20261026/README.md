# A–C 独立合并验收

日期：2026-10-26，Asia/Shanghai。Owner 已明确授权提交、推送并直接合并 A–C。本报告在合并前归档，最终提交和合并状态以关联 PR 为准。

## 范围

从 `61ee01d` 提取 A–C 的 10 笔既有提交，接入 `d081077` 的 C 阶段服务端分页及浏览器补验，重新提交为 `0d5e661a`。唯一冲突位于 `src/App.tsx` 的导入上下文：保留 C 的内联账号组件，只加入目录分页导入。

仅回移 `85db541` 已验证的测试池限额，在 `vite.config.ts` 的测试配置使用 `maxWorkers: "50%"`。默认 5000ms 超时及所有用例断言保留；没有接入 D 的组件测试改动。

原优化工作树仍在 `codex/ad-closeout-implementation`，其 D 阶段、日常入口和未提交材料未参与本次提交。此分支没有 `src/local-app/` 或 `db/local/`。7 个 Supabase 前向迁移来自 A–C；本次不部署迁移、不拉取更新到生产目录、不启停生产服务。

## 本次检查

| 检查 | 结果 |
| --- | --- |
| 依赖 | 按 lockfile 执行 `npm ci --offline --ignore-scripts` |
| 类型 | `npm run check` 通过 |
| 构建 | `npm run build`、`npm run worker:build`、`npm run orchestrator:build` 通过；前端保留既有大 chunk 提示 |
| 完整回归 | 79 文件、709/709，通过默认 5000ms 预算 |
| Node 回归 | 2 通过，1 项既有可选 n8n 本机节点检查跳过 |
| 差异扫描 | 440 个差异路径的常见 GitHub/Provider 令牌及私钥格式扫描无命中；未发现 JWT |

新工作树没有 `.env.local`。测试通过进程环境使用 `VITE_SUPABASE_URL=http://127.0.0.1:9` 和无凭据虚拟 publishable key；未读取或复制生产配置。首轮完整测试因缺少该环境配置导致 3 个套件加载失败，并出现 1 个旧审核用例五秒超时。最终在虚拟配置及测试池限额下运行同一完整范围，目标审核用例耗时 2611ms。原始失败与成功分别保留在 `test-initial.log`、`test-final.log`。

## 沿用的阶段证据

A/B 阶段报告及 C 的真实 HTTP、浏览器、数据库、租约、容量、渲染复用和备份恢复证据随原提交保留。C 补验的 SQL 为 26 文件、292 条断言通过；本次核对归档结果，没有重新执行 SQL、浏览器、在线 Provider 或生产迁移，不把历史执行计作新运行。见 [C 补验](../stage-c-followup/README.md)及 [C 交接](../stage-c-to-d.md)。

合并只更新代码仓库；生产数据库迁移、运行配置启用及生产切换需要后续安排。D 继续在原优化工作树收尾。
