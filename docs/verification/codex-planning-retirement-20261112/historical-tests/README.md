# 已退役规划链路的历史测试

本目录保存 2026-11-12 从当前验收清单移出的三个旧 Codex CLI 规划成功用例。原文采用 `.txt`，不会由 TypeScript 或 Vitest 当作当前测试执行，也没有给当前用例增加 skip。

旧用例要求保存 Codex 规划选择、创建旧规划任务、重试原规划任务，并通过编译后的 CLI 得到成功结果。这些入口、注册和执行器已经退役，因此原正向要求不再成立。保留本目录用于追溯，不表示它们在当前版本通过。

| 原来源 | 归档用例 | 当前处理 |
| --- | --- | --- |
| `src/local-app/mediaRootExecutionWorker.integration.test.ts:10` | `the compiled CLI retries the same frozen failed planner after a cross-device global root migration with old production sources offline` | 原文件只有该用例，完整移入本目录 |
| `src/local-app/legacyAdoptionWorker.integration.test.ts:49` | `the compiled CLI retries the same frozen failed planner after adoption with its old source offline` | 仅移除此用例；两个现行媒体／交付保护用例原文保持 |
| `src/local-app/episodeCollectionWorker.integration.test.ts:17` | `the compiled CLI retries the same frozen failed planner after five collection moves with all old sources offline` | 仅移除此用例；两个现行迁移／未知发布保护用例原文保持 |

每项都有一份完整文件快照 `*.integration.test.ts.txt` 和一份精确用例快照 `*.retired-case.txt`。完整文件快照还包含当时同文件中继续保留的用例；这些现行用例没有随旧规划用例退役。

[manifest.json](manifest.json) 记录归档时的仓库 HEAD、HEAD 中文件 Git blob、工作树原文 SHA-256、用例 SHA-256、来源行号，以及继续保留用例的 SHA-256。归档依据工作树当时原文，保留了本轮在原文件中的已有修改，不以 HEAD 版本覆盖它们。

`workerOutcomes.integration.test.ts` 的现行失败、重试、租约、未知提交及重启保护用例未移动或修改。本次归档没有运行数据库或模型；完整集成测试的历史通过证据仍以对应验收记录为准。

另将失去当前消费者的 `legacyPlanning.fixture.ts` 原文归档，SHA与来源见 `retired-helper.json`；当前恢复用例直接重建历史行，不再通过退役API或旧排队函数建任务。
