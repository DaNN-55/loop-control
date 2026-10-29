# #152 最终 review-fix 独立合入

**最终 HEAD `fc645efb3ad54d78d5e0da005ccde5e8d509b132`，integration 工作树干净；集成树与 `/export` 窗口现在明确释放。** 本轮没有产品源码修正或额外提交。

## 固定范围

- 首亲：`3b7da737779b59dbfa9da85ec8f4b9f0efa73d1f`。
- 源分支 `codex/four-step-review-fixes-152`，最终提交 `49857f4fb9b5eb861fc04246f6b89533f056f28e`；产品源码固定 `e9d7f54fe72329bc6f11beb1b470b93beec244de`，498仅文档/证据。
- `git merge --no-ff 49857f4fb9b5eb861fc04246f6b89533f056f28e -m 'merge: close final four-step safety review findings (#152)'` 无冲突，产生上述fc645efb。
- 源树/集成树在合入前均clean，源含3b7。检查2个ahead提交、87文件diff、096、三处修复及 REVIEW-FIXES.md；无依赖、SDK源码、Owner权限、原Provider/预算/lease/CAS放宽。
- 已读原 Standards 两P2、Spec一P2及两个固定e9d源码closure；它们静态resolved、新0，本报告补独立运行时结果，不伪称由merger重新执行双轴静态审查。

## 三项修复的独立结果

1. **受控归档删除**：096只前向修改原受保护delete_episode内部，在原Owner/归档/任务/资产锁后、旧子表删除前按依赖清理19张workspace表，语句均限定本Episode/task。没有改旧迁移、FK、级联或文件范围。完整新单交付后真实archive→plan→delete；他Owner404、错误标题/过期计划/外目录409。AFTER DELETE故障真实返回503，原有18表取样snapshot和207个文件hash全部恢复、staging不存在；解除故障后成功200/cleanupPending=false、Episode/workspace为0、专属Episode目录消失，另一Episode JSON和媒体SHA不变。新增事实文件供Root独立核对，见下文。
2. **可听正文**：共享isWorkspaceItemAudible同时核item音量与track.muted，递归累积父sequence。叶轨静音、父sequence轨静音分别经过真实MP4→Owner确切确认→prepared CLI metadata；均sourceText仍可审计、adoptedText=null、audible=false、非complete_source。独立重新核metadata hash与manifest匹配。两case只保留metadata/manifest/cover/checks/workspace，未保存其MP4原件，不能称已保留或独立解码它们。
3. **首次口播保护**：提交前已编辑、提交在途后编辑、闭态字幕保存/采用对齐、时长锁，以及preserve旧原生工程五类均PASS。自动刷新/旧直接adopt不再首次ripple，旧入口409并指向现有候选，明确keep-target后只改目标声音；后镜完整item、绝对SFX、字幕lane保持。独立重读before/after再次核B与SFX不变、目标窗口不变；preserve刷新前后SHA相同、x13保留。未编辑初稿实测测长组装、两镜初次生成、范围保护、未知提交等13条原口播正反回归仍全部通过。Root的最终hint→真实SDK→明确时长→采用→原生口播轨 GUI证据继承，不冒称本轮新GUI。

## 普通套件、类型与运行时

唯一cwd `/Users/dan/.codex/worktrees/four-step-integration/loop-control`。

```sh
npm test
npm run build
npm run runtime:prepare
```

- **160文件1059/1059 PASS**，无失败或skip，26.28秒；`merge-review-fixes-npm-test.log`。npm test依既有配置不含integration，不叠加旧票focused数量。
- `npm run build`包含`tsc -b`，类型/frontend build PASS；随后prepare的worker/backend build及源码/产物完整性PASS，`merge-review-fixes-build-runtime.log`。原有Vite chunk提示保留。
- 全部真实组之后，再执行`node --input-type=module -e 'import {assertPreparedRuntime} from "./src/orchestration/runtimeBuild.ts"; await assertPreparedRuntime(process.cwd());'` PASS。
- manifest v3的realpath是integration根，prepared CLI存在；源码与e9d在src/db/scripts/package范围diff为空。未在prepare后改产品源码或再次build。

## 真实完整分组（全量文件，无过滤）

共同只读环境：

```sh
export LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs
export LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut
```

### 核心37

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_REVIEW_FIXES=1 LOOP_FORMAL_ACCEPTANCE=1 \
LOOP_FORMAL_DELIVERY=1 LOOP_REVIEW_FIX_DELETE=1 \
LOOP_REVIEW_EVIDENCE_DIR=/private/tmp/loop-152-orchestration/merge-review-fixes-cases \
LOOP_T13_EVIDENCE_DIR=/private/tmp/loop-152-orchestration/merge-review-fixes-release-full \
LOOP_T05_EVIDENCE_DIR=/private/tmp/loop-152-orchestration/merge-review-fixes-narration-evidence \
LOOP_T06_EVIDENCE_DIR=/private/tmp/loop-152-orchestration/merge-review-fixes-volume-evidence \
node_modules/.bin/vitest run src/local-app/workspaceReviewFixes.integration.test.ts \
 src/local-app/formalWorkflow.integration.test.ts src/local-app/formalWorkflow.delivery.integration.test.ts \
 src/local-app/workspaceNarration.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts \
 src/local-app/workspaceCaptions.integration.test.ts --no-file-parallelism --maxWorkers=1
```

**6文件37/37 PASS，0 filtered/skipped**，158.75秒；`merge-review-fixes-core.log`。精确为review7+formal6+fullDelivery1+narration13+candidates7+captions3。所有render-still/native export均同窗口串行；未设T08额外旧渲染flags。

保留普通非v2真实planner CLI失败→显式retry→实际校验产物、无旧approve新单、旧latest原生恢复、legacy late fence、实际TTS/视觉Worker、候选source/none及输入/原文件/receipt/CAS、caption仅目标化/迟到对齐拒绝与横竖safe-area像素等真实边界。完整新单中actual adopted captions、retime/partial409、五产物/Owner下载、late成本与删除回滚均实际执行。

### 补充10

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FIXTURE_SCHEMA_ACCEPTANCE=1 LOOP_EMBEDDED_STUDIO_ACCEPTANCE=1 \
LOOP_T11_EVIDENCE_DIR=/private/tmp/loop-152-orchestration/merge-review-fixes-export-evidence \
LOOP_T12_EVIDENCE_DIR=/private/tmp/loop-152-orchestration/merge-review-fixes-delivery-evidence \
node_modules/.bin/vitest run src/local-app/workspaceExport.integration.test.ts \
 src/local-app/workspaceDelivery.integration.test.ts src/local-app/fixtureSchema.integration.test.ts \
 src/local-app/workspaceCatalog.integration.test.ts src/local-app/embeddedStudio.integration.test.ts \
 --no-file-parallelism --maxWorkers=1
```

**5文件10/10 PASS，0 filtered/skipped**，67.88秒；`merge-review-fixes-supplement.log`。精确为T11/T12五+schema三+catalog一+旧embedded一。包括旧metadata-normalization/selection-only不废确认、used-content与tamper/missing、queued旧export、CLI重试/重启、trimmed未采用正文隔离、同snapshot/schema ledger SHA与083/084+、旧原生Owner边界。

两组总计**47实际集成**，不加上源票历史结果。测试输出的pg同client并发query弃用提示原样保留，未降低断言、改超时或扩展依赖修复。

## 临时取证与精确恢复

Root明确同意后，**只在既有formalWorkflow.delivery.integration.test.ts原断言后追加删除事实落盘**，未删改断言、未改受测产品。测试不属于runtime manifest source集合。普通1059与build/prepare在原始测试字节上执行；真实fullDelivery只多写deletion facts。

运行前精确备份：该测试及T07三份 `portrait-caption.jpg`、`landscape-caption.jpg`、`render-pixels.json`。core37结束后，先转存本轮新内容至 `merge-review-fixes-written-evidence/`，再按原字节恢复四文件并逐一核SHA。未使用广域git restore；没有T10其它证据写入。

审计记录 `merge-review-fixes-tracked-evidence-backup/{index.json,instrumented-test-sha.json,restoration.json}`。原/临时测试和本轮T07新输出均可追溯；最终working tree clean，无未提交测试补丁。

## 新完整交付与独立字节核验

证据根 **`/private/tmp/loop-152-orchestration/merge-review-fixes-release-full/`**。

- 新视频SHA **`93141d2795b13af2b572fd0980a0ae64cca873adfd5828620c6d2d4778276a2e`**，**465942B**；1080×1920 H264/AAC，222视频帧、video7.400000秒，audio/format7.445333秒。
- 工程SHA **`15391dfa4b57b7d3ebb8b5270b481eb2d9da608d12ab6a9dc7deffca4ddc87f1`**。
- 五份原字节按manifest原relativePath保存在package/；原manifest、Owner下载SHA、CLI deliveryResult、workspace/facts/metadata/lateLedger和完整MP4均保留。
- 独立Python再次核五文件SHA/size、registered publish manifest本身SHA/size、确切video/project identity；metadata actual owner_adoption正文“这一版局部口播已明确采用。”、两个local-added source/none空baseline+无伪正文；late task/run completed、actual_cost_cents=1、submission received均PASS。
- `deletion-rollback-facts.json`保存失败503、18表原/回滚snapshot与207文件原/回滚hash树、四种拒绝断言；`deletion-success-facts.json`保存真实200/cleanupPending=false、Episode/workspace0、他期原/后JSON和媒体SHA。独立再次深比较全部相等。19表cleanup是实现范围；18表是原测试snapshot范围，两者未混写。
- `independent-verification.json`、`runtime-manifest.json`与`representative-0_5.jpg`为本轮独立核对；亲自看过实际采用字幕在最终帧内。Root已另行独立核对新包/解码/删除facts，摘要由Root保存在root-final-ui。
- `merge-review-fixes-cases/independent-verification.json`独立核静音两metadata与manifest，以及首次四组before/after、preserve刷新SHA；不冒称静音MP4原件已保存。

这些为本integration路径新运行，不把源修复树旧full视频或旧MERGE-165视频当本次产物。

## 资源、限制与交还

本轮无新增GUI服务/浏览器profile；所有真实fixtures以finally关闭私库/Studio/转发并释放自有APFS。`merge-review-fixes-resource-baseline.json`与`merge-review-fixes-resource-final.json`对照新增volume/media roots均0；volume log保留成功detach记录。没有停止日常/他人服务、日常DB DML/DDL、hydrate/Keychain、实际付费调用、SDK源码写入或未授权render并发。

Provider、音调和alignment为标明的受控协议/时间戳样本，未证明实时供应商质量、真实语音/音乐或WhisperX识别准确率；原生保存、MP4、Owner确切确认、prepared CLI、文件hash、事务回滚均真实。未重做无关旧五mix；未重复Root最终真实GUI。

最终`git status --short`空、`git diff --check`通过、prepared runtime integrity通过；没有产品修正提交。**原三P2的独立运行时验证完成；集成树和/export明确释放给Root。** 未push、关Issue、归档工作树或改Root PLAN/state/coverage。
