# ADR-0053：删除旧 Studio 结构修订调用链

状态：Accepted。日期：2026-11-13。用户追加授权检查旧 Studio 结构修订入口，无当前功能或历史恢复依赖则与最后一个编排空壳一起清理，现有保护不得放宽。

本决定替代 ADR-0052 对最后一个空壳的暂时保留。有效日常 clean-v2 + 172 中，`public.request_studio_storyboard_revision(uuid,text)` 没有有效 SQL 调用者或传入目录依赖；其唯一出站编排调用是 `public.orchestrate_storyboard_tasks_for_episode(uuid)`。后者只抛出退役错误，没有其他 SQL 调用者或传入目录依赖。原函数虽包含包失效、阶段和审计写入，但最后必然被空壳拒绝回滚，不提供可成功完成的当前功能。

HTTP 的 `requestStudioStoryboardRevision` 早已在身份、CSRF 和 Owner 归属校验后返回 410，位于旧幂等回执读取之前；不存在后续执行分支。共享客户端 `requestReviewRevision` 的旧 storyboard 分支仅被单测调用，实际远端 transport 也已拒绝访问。移除此失效分支与过时成功断言，不改当前 composition 分支、原生工程结构编辑或最终渲染恢复。

173 先删除旧入口，再删除最后的空壳，均使用明确签名与默认 RESTRICT；不使用 CASCADE，不授予权限，不改变触发器、表、历史数据或当前制作函数。旧 HTTP 命令继续保留原拒绝与归属隐藏行为。删除后 SQL 直接调用返回函数不存在，不会执行任何旧状态变更；保留函数的定义与 ACL 必须精确不变。

历史恢复先恢复原始 schema 并核对原数据和 ACL，再顺序执行前向迁移至173；不回写冻结基线或归档 SQL。验收覆盖真实逻辑导出恢复、依赖阻止删除、注入错误事务回滚、历史行及保留对象相等、幂等、旧请求状态不变及当前 Studio/成片交付。日常应用前保留完整私有逻辑导出并在独占候选演练；服务不重启，不切库，不删除旧库或既有恢复材料，不提交、不推送。

结果及其他仍未清理的候选见 `docs/verification/remaining-legacy-sql-20261113/REPORT.md`。
