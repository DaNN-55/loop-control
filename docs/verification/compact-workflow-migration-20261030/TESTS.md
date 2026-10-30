# 自动化测试记录

2026-10-30，本轮四步工作流迁移涉及的集成测试按文件去重后为 **19 个文件、90 项通过，0 项失败、0 项跳过**。本轮按修复范围分批执行；每个文件只计入一次完整通过结果，旧失败、重复执行和 UI 常驻验收夹具不计入通过数。[机器可读结果索引](tests/results.json)记录每个文件的项数和通过日志。

归档普通测试为 **163 个文件、1080 项通过**，与这 90 项集成测试分别统计。[普通测试日志](unit-suite-final.log)、[前端构建日志](build-final.log)和 [Worker/后台准备日志](runtime-prepare-final.log)单独保留。后续口播边界修复重新通过 [类型检查](e2e/planned-voice-ready-type.log)、[后台构建](e2e/planned-voice-ready-backend.log)和 [运行程序准备](e2e/planned-voice-ready-runtime.log)，并在下表的最后 17 项中验证。

## 去重结果

| 集成文件 | 通过项数 | 完整通过证据 |
|---|---:|---|
| `productionWorkspace.integration.test.ts` | 1 | [原套件](tests/integration-suite.log) |
| `workspaceImages.integration.test.ts` | 7 | [原套件](tests/integration-suite.log) |
| `workspaceShots.integration.test.ts` | 9 | [原套件](tests/integration-suite.log) |
| `workspaceVisualCandidates.integration.test.ts` | 12 | [原套件](tests/integration-suite.log) |
| `workspaceExport.integration.test.ts` | 1 | [原套件](tests/integration-suite.log) |
| `workspaceCaptions.integration.test.ts` | 3 | [原套件](tests/integration-suite.log) |
| `workspaceDelivery.integration.test.ts` | 4 | [补齐套件](tests/integration-final-complement.log) |
| `workspaceVideo.integration.test.ts` | 6 | [补齐套件](tests/integration-final-complement.log) |
| `workspaceAudioProjection.integration.test.ts` | 1 | [补齐套件](tests/integration-final-complement.log) |
| `workspaceCatalog.integration.test.ts` | 1 | [补齐套件](tests/integration-final-complement.log) |
| `legacyWorkspaceEditing.integration.test.ts` | 2 | [补齐套件](tests/integration-final-complement.log) |
| `legacyWorkspaceEntry.integration.test.ts` | 3 | [补齐套件](tests/integration-final-complement.log) |
| `legacyStudioProject.integration.test.ts` | 1 | [补齐套件](tests/integration-final-complement.log) |
| `workspaceCandidates.integration.test.ts` | 7 | [候选与主声回归](tests/integration-final-regressions.log) |
| `workspaceReviewFixes.integration.test.ts` | 7 | [候选与主声回归](tests/integration-final-regressions.log) |
| `workspaceAudio.integration.test.ts` | 8 | [产物恢复后重跑](tests/integration-final-artifact-retry.log) |
| `workspaceNarration.integration.test.ts` | 13 | [最终口播边界回归](tests/integration-final-planned-voice.log) |
| `workspaceFirstVideo.integration.test.ts` | 3 | [最终口播边界回归](tests/integration-final-planned-voice.log) |
| `workspaceFirstVideo.source.integration.test.ts` | 1 | [最终口播边界回归](tests/integration-final-planned-voice.log) |
| **合计** | **90** | **19 个文件** |

这些用例验证真实 HTTP、PostgreSQL、原生工程、媒体渲染和 Worker 子进程。数据库与媒体使用隔离夹具；Provider 使用受控协议样本。在线连接测试和人工浏览器验收见 [验收报告](REPORT.md)，不纳入这 90 项计数。

## 命令与执行条件

实际执行使用 `.scratch/compact-migration-20261030/runner.config.ts`。已保存内容相同的 [配置副本](tests/runner.config.ts)：关闭自动读取环境文件，使用独立 Vite 缓存，不启动日常服务。运行目录为仓库根目录，Node.js 为 `v24.20.0`，Vitest 为 `v3.2.7`。

实际批次共用以下环境变量和参数：

```sh
export LOOP_TEST_CONTEXT_MODULE="$PWD/scripts/runtime/environment.mjs"
export LOOP_WORKSPACE_ACCEPTANCE=1
export LOOP_REVIEW_FIXES=1
export LOOP_LEGACY_WORKSPACE_ACCEPTANCE=1
export LOOP_LEGACY_EDIT_ACCEPTANCE=1

node node_modules/vitest/vitest.mjs run \
  --config .scratch/compact-migration-20261030/runner.config.ts \
  --maxWorkers=1 --fileParallelism=false \
  src/local-app/workspaceNarration.integration.test.ts \
  src/local-app/workspaceFirstVideo.integration.test.ts \
  src/local-app/workspaceFirstVideo.source.integration.test.ts
```

这条最后执行的命令返回 `3 passed / 17 passed`、退出码 `0`。补齐批次使用相同参数，文件为 Audio、Delivery、FirstVideo、Narration、Video、AudioProjection、Catalog 和三个 legacy 文件。随后按失败与实现变更范围重跑 Audio/Narration、Candidates/ReviewFixes，以及首次视频用例。各批次的原始输出保留在下节日志中。

复现全部 19 个文件时，可以使用保存的配置副本执行以下等价命令。它用于复现完整范围，本轮的通过统计来自上表所列实际批次。

```sh
node node_modules/vitest/vitest.mjs run \
  --config docs/verification/compact-workflow-migration-20261030/tests/runner.config.ts \
  --maxWorkers=1 --fileParallelism=false \
  src/local-app/productionWorkspace.integration.test.ts \
  src/local-app/workspace*.integration.test.ts \
  src/local-app/legacyWorkspace*.integration.test.ts \
  src/local-app/legacyStudioProject.integration.test.ts \
  --exclude '**/*.ui.integration.test.ts'
```

完整范围命令沿用前一个代码块的五个环境变量。`LOOP_LEGACY_WORKSPACE_ACCEPTANCE=1` 启用 legacy Entry/StudioProject；`LOOP_LEGACY_EDIT_ACCEPTANCE=1` 启用 legacy Editing；`LOOP_REVIEW_FIXES=1` 启用 ReviewFixes。夹具需要访问本机 Docker 与创建临时 APFS 镜像，因此实际集成批次在获准的执行环境中运行。

真实 Worker 测试依赖 `dist/worker` 和完整性清单。先完成所有构建，再执行 `npm run runtime:prepare`；测试期间保持源码和 `dist` 稳定。`npm run build` 的 Vite 输出清理会移除同处 `dist` 的 Worker 产物，不能与真实 Worker 集成测试并行。

## 失败、修复与重跑证据

原套件为 14 个文件、68 项：51 项通过、11 项失败、6 项跳过。[原日志](tests/integration-suite.log)保留全部失败，后续没有将这些失败直接计为通过。

1. **缺少测试上下文变量。** `workspaceDelivery.fixture.ts` 直接导入 `LOOP_TEST_CONTEXT_MODULE`；未设置时产生 `Cannot find package 'undefined'`，影响 Audio、Candidates、Delivery 和 ReviewFixes 的 10 项。补上脚本绝对路径后进入真实 Worker。默认沙箱另曾阻止 Docker/APFS 夹具，见 [沙箱补跑日志](tests/integration-delivery-context-retry.log)。获准执行后的 [补环境日志](tests/integration-delivery-context-retry-unrestricted.log)显示 Candidates/ReviewFixes 完整通过，Delivery 的 2 项随后被源码变更触发的产物过期检查拦截。
2. **重规划后的口播采用状态错误。** 旧实现沿用历史 SQL 采用指针；现改为读取当前原生工程的真实主声，保留历史候选决策。首次 AI 视频通过已有首次口播组装边界冻结实际声音与时长；已保存人工编辑仍要求正式候选采用。FirstVideo 的重规划用例和 ReviewFixes 均已重跑通过。
3. **旧音频用例绕过正式候选采用。** Audio 的两个用例在已有 source/BGM 编辑后仍调用快捷 `adoptWorkspaceNarration`，被既有人工编辑保护返回 `409`。用例改为明确准备并采用候选；保留快捷入口 `409`、工程 SHA 不变、实际源音频过短以及真实频谱验证。生产中的人工编辑保护没有放宽。口播超过服务上限的用例继续确认 `409`、无付费提交、正文保留，并补明「上限 15 秒」错误语义。[补齐套件](tests/integration-final-complement.log)保留修复前 3 项失败。
4. **构建与 Worker 产物冲突。** [候选与主声回归](tests/integration-final-regressions.log)运行时，前端构建清理 `dist`，Audio 的一项出现 `MODULE_NOT_FOUND`，缺少 `dist/worker/local-app/localWorkerCli.js`。重新准备产物并实际调用 `assertPreparedRuntime(process.cwd())` 得到 `runtime_ready` 后重跑，Audio 的 8 项全部通过，见 [产物恢复后日志](tests/integration-final-artifact-retry.log)。同批 Narration 的两个失败没有归因于构建冲突。
5. **计划口播未就绪时错误允许首次付费视频。** Narration 的 `changed=false/true` 两项在提交 TTS 之前的 `notReady` 检查得到 `200`，稳定产物重跑仍复现。实际 source 主声与未采用 TTS 草稿需要区分：已有 source 主声时按 source 冻结；没有实际主声且计划使用 TTS/manual 时，继续验证音轨是否就绪，未就绪返回 `409`。最后重跑 Narration 13 项、FirstVideo 3 项和新增 source 主声 1 项，**17 项全部通过**，见 [最终日志](tests/integration-final-planned-voice.log)。

普通测试中的既有 stderr 和构建中的分块大小提示保留在原日志中，没有改写为失败或隐藏。最终计数只来自 `tests/results.json` 中有完整通过输出的文件；未将 UI 常驻夹具、受控 Provider 样本视为真实付费 Provider 生成验证。
