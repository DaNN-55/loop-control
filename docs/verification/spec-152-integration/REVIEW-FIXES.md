# #152 最终审查修复

## 范围与契约

仅修复 Standards / Spec 最终审查确认的三项 P2。原审查报告保留，未扩展产品流程。

1. **归档删除**：新增前向迁移 `096-workspace-episode-deletion.sql`，在原 `delete_episode` 的受控事务内，按依赖清理本 Episode 的 19 张 workspace 表。Owner、归档、任务、资产锁及原删除计划校验不变；不增加级联、不扩大目录范围。覆盖完整交付后归档、错误身份/标题/计划拒绝、SQL 故障后记录与目录恢复及其他 Episode 不变。
2. **实际可听正文**：交付窗口复用原主声可听性判断，递归累积父 sequence 的 item 音量及 track 静音。静音叶轨/父轨保留 `sourceText` 审计，但 `adoptedText=null`、窗口 `audible=false`，不声称完整说出正文。保留原裁切、变速及 coverage 规则。
3. **首次口播保护**：自动刷新和旧直接采用入口均保护已经存在的人工编辑，字幕保存/采用对齐也登记人工内容修改。恢复旧工程时初始人工 epoch 为 1，新初稿仍为 0。锁定画面或已有编辑的结果留为既有候选，由 Owner 明确时长后采用；UI 指向口播版本。未编辑初稿仍按实际音轨时长首次组装，不改变 Provider、费用、未知提交及候选契约。

## 验证状态

源码提交前已取得三个真实业务 RED 及 GREEN。原生编辑通过实际 Studio store 与 Owner 保存边界，非内存 timeline；Provider / alignment 为受控样本，不宣称真实付费生成或 WhisperX 识别。

- 删除：`/private/tmp/loop-152-review-delete-red.log` → `/private/tmp/loop-152-review-delete-green.log`。
- 静音叶轨：`/private/tmp/loop-152-review-muted-red.log`；有效父 sequence：`/private/tmp/loop-152-review-muted-parent-red.log` → `/private/tmp/loop-152-review-muted-green.log`（2/2）。
- 编辑发生于提交前、提交后、字幕保存/对齐：`/private/tmp/loop-152-review-first-speech-red.log` → `/private/tmp/loop-152-review-first-speech-green.log`（3/3）。
- 时长锁：`/private/tmp/loop-152-review-locked-candidate-red.log` → `/private/tmp/loop-152-review-first-all-green.log`（4/4）。
- 保留旧原生工程：`/private/tmp/loop-152-review-preserve-first-business-red.log` → `/private/tmp/loop-152-review-preserve-first-green2.log`（1/1，6 项过滤）。初次尝试因旧样本字幕门槛失败；一次中间尝试是测试 helper 错用候选 envelope，均保留原日志，不称业务 RED。
- 保留旧工程补丁前的完整检查：类型/构建/runtime prepare 通过；普通套件 1059/1059；受影响真实六文件 36/36，含实际 MP4、精确 Owner 确认、真实 prepared CLI 五产物及删除故障回滚。记录在 `/private/tmp/loop-152-review-final-{type,build,prepare,npm-test,integration}.log`。

最终源码的构建、完整七项修复测试、正式流程/交付链与最小 GUI 复验将在最终证据补充中记录；以上历史结果不冒称最终补丁版本的检查。

## 最终固定源码验收

产品源码固定在 `e9d7f54fe72329bc6f11beb1b470b93beec244de`，后续仅补文档与证据。

- `npm run check`、`npm run build`、`npm run runtime:prepare` 通过。
- 最终三文件 **14/14**：完整 `workspaceReviewFixes.integration.test.ts` 七项、正式流程六项、完整交付链一项，后者启用删除验收。日志 [final-preserve-integration.log](review-fixes/logs/final-preserve-integration.log)。保留前一冻结版本普通 **1059/1059** 及受影响六文件 **36/36** 的结果，最终 preserve 补丁后未重复这两组；独立 merger 将在最终 SHA 再跑普通套件。
- 真实流程：新 Owner Episode → 脚本确认/无旧 board 准备 → 受控 Worker 素材 → 混合素材/局部候选 → 原生 store 手改与 Owner 保存/恢复 → 实际 MP4 → 精确 Owner 确认 → prepared Worker CLI → 五产物/manifest → `production_completed` → 归档/受控删除。故障注入时记录与目录完整恢复，其他 Episode 与媒体逐字节不变。
- [实际全包及 Owner 下载](review-fixes/evidence/full/) 保存五份原字节文件、manifest、下载 SHA、`owner_adoption` 正文及迟到未采用结果账务。五文件 SHA/size 全部通过，[核验记录](review-fixes/evidence/full/artifact-verification.json)。最终视频 SHA `6a0228c68e32ec657b1fc10457c387e542f923b884b69e5515a3e57c06983536`；H.264/AAC、1080×1920、222 帧/7.4 秒，容器 7.445333 秒。[ffprobe](review-fixes/evidence/full/ffprobe.json)。这是受控图像/音调样本，未作真实作品视觉质量或语音识别质量声明。
- [静音交付元数据与首次口播五组](review-fixes/evidence/cases/) 保存实际 metadata、manifest 和 before/after 原件；静音两次 MP4 经真实导出/确认/CLI 验证，但未额外保留其视频原件，最终完整交付视频原件已保留。preserve 场景实测刷新前后 SHA 相同、既有 x13 保留，Owner 仍可明确采用候选。
- [RED/GREEN 日志索引](review-fixes/logs/index.json) 记录原始 `/private/tmp` 绝对路径、原 SHA 和提交副本 SHA；副本仅去每行末尾空白及末尾空行。包含初次 parent 缺少 sequence.name、旧字幕门槛和测试 helper envelope 错误，均与真正业务 RED 分开，不删除失败历史。
- 构建仍有既有 chunk size 提示；集成测试输出 `pg` 同一 client 并发查询弃用提示，但全部断言通过。未改依赖或为此扩大修复范围。

### 最终复跑命令

以下命令均在本票 managed worktree，只有随机隔离库和本票 APFS 媒体可写；环境模块仅用于 `runtimeContext` 技术能力，不读取部署 secret/Keychain。

```sh
npm run check
npm run build
npm run runtime:prepare
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
LOOP_REVIEW_FIXES=1 LOOP_FORMAL_ACCEPTANCE=1 LOOP_FORMAL_DELIVERY=1 LOOP_REVIEW_FIX_DELETE=1 \
LOOP_REVIEW_EVIDENCE_DIR=/private/tmp/loop-152-review-final-preserve/cases \
LOOP_T13_EVIDENCE_DIR=/private/tmp/loop-152-review-final-preserve/full \
npx vitest run src/local-app/workspaceReviewFixes.integration.test.ts \
  src/local-app/formalWorkflow.integration.test.ts \
  src/local-app/formalWorkflow.delivery.integration.test.ts \
  --no-file-parallelism --maxWorkers=1
```

渲染串行窗口已在最终 14 项通过后向 Root 明确释放。所有测试 fixture 通过 `finally` 清理；GUI 自有服务的最终停止与最小复验记录另补，未进行浏览器永久删除操作。原 T07 跟踪证据已按精确旧副本恢复，本轮副本另存 `/private/tmp/loop-152-review-final/captions/`，没有广域 restore。

## Root 最小 GUI 复验

Root 在最终源码的新 localhost fixture 实际登录：素材准备展开口播，出现候选指引且没有旧直接采用；进入真实 Studio，口播版本选择保留目标窗口并明确采用，显示已采用与工作版本已保存，原生轨新增口播。返回生产单后关闭 tab。未调用导出或浏览器删除。证据 [准备指引](review-fixes/evidence/gui/preparation-hint.jpg)、[明确采用结果](review-fixes/evidence/gui/candidate-adopted.jpg)，旁边 TXT 保存实际 DOM。Root 同时报告两轴针对性复核原 Standards 两项/Spec 一项全部 resolved，新增 0；原报告由 Root 维护。

最终 GUI fixture 已在 Root 关闭 tab 后正常停止：`localhost:56870` 端口关闭、精确 PID 退出、自有随机数据库及 APFS fixture 根目录删除，0600 临时凭据移除。[清理记录](review-fixes/evidence/final-gui-cleanup.json)。之前的自有 `localhost:55945` fixture 同样已清理。未停止日常服务、未读写日常业务行、未触及原始媒体或 SDK 源码。
