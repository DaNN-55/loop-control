# #142 local clip Critical closure follow-up

审查对象：`142-local-clip-scope.patch`（SHA-256 `d636d3f1f3f073c7a087fda2686cc081ad2c7aa467600d38fc25c42de0729f4a`）及 `clip-scope-result.json`。未运行任何检查。

## Critical issues

未关闭。`src/local-app/episodeCommands.ts` 的 `generateSourceAudio` 分支新增 `if (!localClip)`，但 `localClip` 仅在稍后、另一个 media-command `else` 块中以 `const` 声明。它不在该分支的词法作用域，TypeScript 会报 `Cannot find name 'localClip'`。该行不属于 generateClip 的缩限，且会不必要改变 source-audio 原有的媒体开关行为；应恢复原来的无条件 `media_enabled=true`。

## Important improvements

除上述错误外，预期缩限正确解决原授权扩大：对 `media_enabled=false` 的首次 generateClip 仍走原 full preflight/`requireMedia`；只有已启用的 Episode 才用 `local_clip`，并通过 `SELECT ... FOR UPDATE` 锁定 input row，成功分支不写 dispatch flag。读取的隔离证据也实际调用 planner/claim，报告 false case 为 0 规划、0 claim、0 secret/transport，true case input row 不变；但这些不能替代修复后重新运行。

## Optional notes

`historicalFixtureSetupFailures` 被保留，符合历史失败留存要求。

## Verification suggestions

恢复 source-audio 行后，至少重跑该 3-case HTTP/PG 测试和类型/相关测试；保留 false case 的 planner/claim 负断言。无需新增 SQL 设计。
