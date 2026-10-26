# T19 默认 5 秒 UI 超时：基线对照补验

> 归档说明：本次按 Owner 认可，将 T19 实现、验收及基线对照证据仅提交到当前分支。正文和原始 JSON 中的“未提交”、`committed:false`、`noCommit:true` 及 HEAD 均描述验收/补验时快照；原始日志保持不变。默认 5000ms 门禁仍未通过、根因未解决，其他未验收项及模拟资格、SecretStore 替身、T17 日志覆盖说明继续保留。未推送、未合并、未开始 T20。


2026-10-24。**结论：这条 UI 超时在 T19 前基线已存在，不是 T19 首次引入的新失败。默认 5 秒门禁仍未通过，性能根因未定位、未解决。** 本轮仅归因补验，没有修改业务代码、测试、超时或断言，没有提交、推送、合并或开始 T20。

## 对照对象与控制条件

- 基线 A：T19 前、已提交的 T18 `af4856a8683d0a61f2f01911ccfe00077b4c9cc1`，从本地 Git archive 冻结。
- 当前 B：同一基线叠加现有 T19 的 22 个源文件改动，均与原 T19 证据索引核对 SHA 一致。根 PLAN、无关规划文件和新验收报告不叠入测试副本。
- **同一台 macOS arm64 主机、同一 Node v24.20.0 二进制、同一安装依赖、同一个 checkout 绝对路径、同一环境字节摘要、同一命令**。每次恢复对应冻结副本，使用全新 checkout 内 Vite 缓存；依赖链接到同一批安装文件，没有安装依赖或新增网络请求。
- 两版的 `package.json`、lockfile、Vite/TS 配置和目标测试文件 SHA 完全相同。Vite 配置未设置 `testTimeout`；CLI 没有 `--testTimeout` 等覆盖参数，沿用默认 **5000ms**。每轮均发现同样的 **94 文件、740 测试**。
- 使用上次的 `cleanEnvironment(verifiedSource())`。唯一新增的环境项是两版完全相同的 `NODE_OPTIONS` 只读出网阻断封套；它不改变断言、用例或超时。每轮 110 个 Node 进程记录封套安装；测试期间没有非 loopback 请求触发阻断。独立自检证明出网会在 native fetch/connect 前被拒绝；自检未发网络包或 DNS 请求。绝对耗时仍受机器负载影响，比较的是相同保护条件下的版本差异。

实际命令（八轮 argv 完全一致）：

```sh
/opt/homebrew/Cellar/node@24/24.20.0/bin/node node_modules/vitest/vitest.mjs run --exclude n8n/import-workflows.test.mjs --exclude '**/*.integration.test.ts' --exclude '**/.loop-control/**'
```

[方法与配置摘要](evidence/method.json)、[全部源文件指纹](evidence/source-manifests.json)、[一致性复核](evidence/verification.json) 可核查上述条件。环境原值含隔离测试凭据，仅在私有目录留存，公开证据只保留环境摘要和键控方法。

## 八轮结果

按 A→B→B→A、A→B→B→A 顺序串行运行。目标为 `src/reviews/ReviewWorkspace.test.tsx:684` 的“分镜批准后按整期 BGM、TTS、逐镜头声音的顺序显示并保存独立音效选择”。

| 轮次 | 版本 | 目标测试 | 完整回归 | 原始日志 |
|---|---|---|---|---|
| 01 | 基线 A | 超时，报告 5019ms；门限 5000ms | 739/740 | [stdout](evidence/01-baseline-stdout.txt) |
| 02 | 当前 B | 3458ms，通过 | 740/740 | [stdout](evidence/02-current-stdout.txt) |
| 03 | 当前 B | 超时，报告 5032ms；门限 5000ms | 739/740 | [stdout](evidence/03-current-stdout.txt) |
| 04 | 基线 A | 3285ms，通过 | 740/740 | [stdout](evidence/04-baseline-stdout.txt) |
| 05 | 基线 A | 3317ms，通过 | 740/740 | [stdout](evidence/05-baseline-stdout.txt) |
| 06 | 当前 B | 3815ms，通过 | 740/740 | [stdout](evidence/06-current-stdout.txt) |
| 07 | 当前 B | 3126ms，通过 | 740/740 | [stdout](evidence/07-current-stdout.txt) |
| 08 | 基线 A | 3774ms，通过 | 740/740 | [stdout](evidence/08-baseline-stdout.txt) |

两版各 **4 次中 1 次相同超时、3 次全量通过**。失败轮均只有这一条测试失败；原始失败块均为 `Error: Test timed out in 5000ms.`，且都指向同一测试行。

[复算结果及精确失败块](evidence/analysis.json) 为最终统计依据。初版 driver 的摘要正则转义有误，导致原始元数据的 `targetTimedOut` 布尔值错误地为 false，并按预设上限跑满八轮；原始 stdout、元数据和 driver 均保留。补验分析直接匹配 stdout 的精确 FAIL 行及随后超时错误，未覆盖原记录，也没有通过重跑或改变阈值修正结果。

## 归因与门禁判定

1. **可关闭“这条超时是否为 T19 新增失败”的疑问：否。** 01 轮在未包含任何 T19 改动的基线就已复现，因而不能把该超时首次出现归因于 T19。
2. 本次没有观察到 T19 的超时次数增加，两版通过耗时范围也重叠。四次/版不足以证明绝对性能等价或排除较小影响；本结论不扩大为“T19 所有路径绝无性能回归”。
3. **不能关闭默认 5 秒门禁，也不能关闭根因问题。** 两版均出现通过/超时波动。没有定位慢点、修改测试逻辑、扩大超时或进行延迟优化；通过轮次不能替代失败证据。
4. 此前 B/T06 门禁历史失败及根因未解决仍保留。本轮证明这条具体 UI 超时在 T19 前存在，未证明它与更早 B/T06 失败拥有相同底层原因。

原 [T19 报告](../stage-d-t19/README.md) 和原证据索引保持字节不变；其中“当时尚未完成基线对照”的状态由本报告补充。本报告不覆盖原始失败，也不将 T19 整体验收改为无条件通过。

## 边界与证据

业务代码、目标测试、根 PLAN、原 T19 报告/索引、HEAD 和 Git index 均核验未变；未操作生产、未新增在线请求、未提交/推送/合并或开始 T20。默认部署、在线生成、其他 Provider、完整多能力 Worker 未验收的限制，以及模拟资格、SecretStore 替身和 T17 中间日志覆盖说明，继续以原 T19 报告保留。

[证据索引](evidence-index.json) 覆盖八轮原始 stdout、原始元数据、配置/源码指纹、执行及复算脚本、网络封套自检与最终复核。私有环境原值、Git archive 和冻结副本保留在 `.loop-control/stage-d/state/t19-timeout-comparison-20261024`，不纳入公开证据或提交范围。无 HAR。所有轮次日志用唯一文件名创建，未覆盖原始日志。
