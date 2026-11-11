# 第二批：目录任务依赖与后台提醒独立审查

审查范围：48 类中的 6—9、20—21、28、35、38、41。主 Agent 拥有业务实现，本审查不修改业务代码。

## 源码已核对

- `catalogWorkspaceUsage.ts` 在 Owner 只读事务内读取并验证原生工程，使用执行图获得当前视觉目标、关闭标记与实际主声；不持久化推导结果。
- `catalogQuery.ts` 的口播任务关联要求镜头仍被使用、口播开启且没有已用主声。已删除目标和关闭用途不再通过历史 unknown 请求强制关联。
- 声音任务只有 `adopted_item_id` 在当前执行图才关联；未采用候选和显式停用的配乐音效转后台记录。
- 视觉任务只有实际缺画面的目标仍需要；已采用其他画面后旧候选失败不再作为当前阻塞。
- 当前成片问题和当前交付失败仍阻止对应动作；`production_completed` 的目录结果优先 `done`，不由历史失败倒退。
- `backgroundTaskCount` 独立统计非当前依赖的 ready/running/failed/blocked 记录，提供系统任务入口，不冒充取消请求或已结清费用。

## 已反馈的覆盖与限制

1. 新 SQL 需要实际 catalog 断言：失败视觉候选被本地素材替换、目标删除；失败音效未采用/开关关闭；交付完成后历史失败。既有采用测试多不读取 catalog，不能代替新 SQL 的断言。
2. 原生工程读取错误已投影 `WORKSPACE_CONTENT_UNAVAILABLE`，但 helper 不验证 `used.paths` 的媒体文件和导出成片文件。文件在上次导出检查后消失，目录可能仍显示待审核，工作区/实际导出才发现缺失。此为当前可见状态限制，已请主 Agent 补保护或明确范围。
3. 每次目录读取串行验证全部活动工程（仅 accountId 过滤），尚未按 q/series 收窄。工程数增长后会增加文件哈希和数据库往返；可复用相同 scoped 条件，不能用未经验证的缓存越过存储身份保护。

4. 修改口播输入通常会清当前 `task_id`。若旧 unknown 仍禁止同镜头再生成，而镜头继续启用且没有已用主声，则只按当前 `task_id` 关联可能漏报实际受阻。建议仅在这类仍需要口播的镜头纳入未核清历史请求，关闭或已有主声时保持独立提醒。已请主 Agent 增加 changed-input + catalog 断言。

## 实际验证

设置 `LOOP_TEST_CONTEXT_MODULE=.../environment/runtime-context.mjs`、`LOOP_WORKSPACE_ACCEPTANCE=1`、`OPENCHATCUT_ROOT=.../.loop-control/local/OpenChatCut`，顺序执行：

- `workspaceVisualCandidates.integration.test.ts`
- `workspaceSoundCandidates.integration.test.ts`
- `workspaceDelivery.integration.test.ts`
- `workflowRules.integration.test.ts`

4 文件、30 例：21 通过、9 失败，日志 `batch2-independent-integration.log`。声音候选、交付、当前 workflowRules 三文件通过。9 个失败均为视觉候选测试旧断言直接读取 `snapshot.media.wan_video`（:83、:193、:270）；`156-unified-shot-video-protocol.sql:15` 已迁为 `media.video`，正式 `codexRunner.ts:525` 使用 `video ?? wan_video` 兼容。失败尚未到这些用例的受控 Provider 后续执行，不能记业务通过。已请求主 Agent 对齐当前协议后复验，不修改业务协议迎合旧断言。

## 复核后的判定（第二批）

- 视觉协议断言对齐当前 `media.video` 后，完整 `workspaceVisualCandidates.integration.test.ts` 23/23 通过（52.36s），日志 `batch2-visual-protocol-retest.log`；9 个旧断言失败已收敛，不改业务协议。
- 新 `workflowRules.integration.test.ts` 增至 3 例，在 `batch3-independent-integration.log` 均通过：包括 unknown 关闭/重启/改输入重新启用、缺失停用音轨含长尾实际导出、失败画面被本地替换/关闭配乐/删除目标后目录阻塞消失且失败记录保留。
- 源码复核确认已收窄 q / series / account，仅投影含未完成任务的活动工程；旧 unknown 仅对当前仍启用、被使用且没有主声的镜头重新关联。
- 目录不逐次读取大媒体做实时 SHA-256 是明确性能取舍：目录表示已知任务与审核状态，不能当作最新文件完整性保证。采用、编辑保存、导出、确认及实际交付边界仍验证字节与文件身份；本报告不声称列表已核验所有媒体。

| 48 类行号 | 第二批判定 | 证据 |
|---|---|---|
| 6、7、21 | 通过本批目标 | unknown 停用后不阻塞，改输入重新启用仍不可绕过未知提交，历史留提醒。 |
| 8、20 | 通过本批目标 | 本地画面替换/删除原目标后，旧失败任务只留后台；23 视觉集成通过。 |
| 9 | 保留且不扩展回执分类 | 发布 hold 的既有恢复边界保留；不因本次目录修复重发请求。 |
| 28、29 | 通过本批目标 | 未采用失败声音、关闭配乐不阻塞；声音候选集成通过。 |
| 35、38 | 通过本批目标 | 当前工程仍执行读写校验；用户成片问题与后台历史任务分离，不能把关详情当解决。 |
| 41 | 通过本批目标 | 4 交付集成通过；完成状态优先且不由历史失败倒退。 |
