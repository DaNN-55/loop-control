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
