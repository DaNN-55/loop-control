# 首次图片视频生成 503 诊断

当前隔离单：`529a7070-f80e-4d97-9ac0-80ee2e057ba5`。本轮只读查询和事务回滚探针；未停服、重启、改业务数据或代替 UI 操作。

## 已观察

- UI `generateWorkspaceImage` 返回 503，未创建视频任务或 workspace_image_requests。
- 当前 Episode 阶段为 `script_approved`；工作空间 revision 3，脚本/分镜为重新规划后的当前版本。
- 账号有已冻结 A-roll、口播配置及首帧图片，受控口播任务已完成。
- 当前账号 `generation_account_budgets` 为 0 行。
- 在同一隔离数据库以测试 Owner、loop_app 权限对实际 `public.request_official_shot_video` 做事务回滚探针，首先得到：`Return to the approved storyboard shot workbench first`。错误后连接关闭，事务已回滚；未写工程文件。

## 根因

`generateWorkspaceImage` → `executeWanCommand` 调用了旧 `public.request_official_shot_video`。这个旧函数要求 `storyboard_approved` 与旧批准记录；四步脚本规划的真实依据是当前 workspace preparation，保留 `script_approved` 而不伪造旧审批。

095 迁移为 `local_identity.request_workspace_official_visual` / `request_workspace_wan_visual` 私有四步函数接入了当前制作依据，但首次图片视频仍使用旧公开路径，因此在任务入队前拒绝。该异常为 PostgreSQL P0001，localRoute 没有映射为可读业务冲突，泛化为 503。

预算行缺失是随后可能遇到的第二个阻塞，不能把它当作已复现的首个错误；最初基于预算缺失的判断在回滚探针后已纠正。

## 最小建议

- 首次生成复用现有 workspace 视觉授权/版本/首帧/主声/付费提交围栏，避免改阶段或伪造批准。私有函数只能经已有受控 queue wrapper 调用，不能简单放宽执行权限。
- 通过正式 Owner `setWanBudget` 设置隔离账号预算；不要直接插入预算表。
- 将确切已知的预算/资格错误映射为可操作的 409，并在当前四步入口暴露账号预算操作。
- 增加从真实新单、script_approved、当前准备依据触发首次视频的 HTTP/PG 回归，之后由 UI 重试生成。

原始证据：`image-generation-diagnostic.json`、`image-generation-budget-probe.json`、`current-official-video-function.sql`。
