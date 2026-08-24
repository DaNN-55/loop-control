# 控制台体验与生产可观测性 v2 Spec

## Problem Statement

当前 Loop 控制台已经覆盖账号配置、Episode 生产、审核、发布准备和复盘，但控制面仍然偏向开发者使用：蓝图与系列规则依赖 JSON，生产单详情抽屉过长，列表缺少分页和待办角标，阻塞项使用技术错误描述，发布页复用通用 Episode 抽屉，Owner 也无法直观看到 Worker、n8n、Supabase 和本地媒体库是否正常。

这些问题会让 Owner 难以判断下一步该做什么，也会让生产状态、发布事实和后台执行状态分散在不同地方。v2 的目标是让控制台成为一个清晰的 Owner 工作台，同时保持既有受控状态迁移、不可变输入、产物索引和审计边界。

## Solution

将控制台调整为以日常待办为中心的工作台：系列运营作为默认入口，账号作为低频配置入口；蓝图和系列规则提供结构化表单；Episode 详情使用分组折叠的覆盖式抽屉；发布队列使用专用宽版弹窗和独立发布记录；审核和发布显示待处理角标；Worker 通过真实任务状态、尝试次数和 `n/m` 任务进度反馈执行情况；系统状态图标提供 Supabase、Worker、n8n、媒体库和运行依赖的快速健康检查。

账号和系列配置在生产任务中通过版本化 Prompt 上下文参与生成。优先级为：账号硬约束、系列规则、本期输入、审核反馈。技术执行参数，例如模型、预算、工具权限和输出路径，作为任务控制元数据保存，不作为创作语义混入 Prompt。

## User Stories

1. As an Owner, I want 系列运营成为默认入口, so that I can first understand the overall production situation.
2. As an Owner, I want 账号入口位于导航末尾, so that low-frequency configuration does not compete with daily production work.
3. As an Owner, I want 待审核数量显示在审核导航上, so that I can immediately see how many decisions require my attention.
4. As an Owner, I want 待发布数量显示在发布队列导航上, so that publishing work is visible without opening the page.
5. As an Owner, I want zero-count badges hidden, so that navigation remains quiet when there is no pending work.
6. As an Owner, I want account identity colors to remain stable across sorting and filtering, so that I can recognize the account reliably.
7. As an Owner, I want the bottom control to be labeled as Owner settings, so that it is not confused with a content account.
8. As an Owner, I want the collapsed sidebar controls to stay within the sidebar bounds, so that the theme, collapse, and Owner controls remain usable.
9. As an Owner, I want blueprint versions represented by a compact selector and summary, so that historical versions do not consume the main page.
10. As an Owner, I want to view the active blueprint version, asset root, and key positioning at a glance, so that I can verify the configuration before creating an Episode.
11. As an Owner, I want to edit blueprint rules through labeled forms, so that I do not need to understand raw JSON for normal configuration work.
12. As an Owner, I want every blueprint field to explain its purpose and risk, so that I know whether a change affects creative output, Worker execution, cost, or approval gates.
13. As an Owner, I want technical executor settings grouped separately, so that model, provider, adapter, and prompt version details do not obscure normal account configuration.
14. As an Owner, I want each blueprint edit to create a new version, so that existing Episodes retain their frozen configuration.
15. As an Owner, I want to see an explicit warning when changing the asset root, so that I do not accidentally point Worker tasks at the wrong local directory.
16. As an Owner, I want to create and edit series rules through labeled forms, so that recurring content formats are understandable without JSON expertise.
17. As an Owner, I want series rules grouped into positioning, format, characters, locations, visual style, narrative structure, and restrictions, so that each field has a clear creative meaning.
18. As an Owner, I want advanced series rules preserved for uncommon cases, so that form-based editing does not remove future expressiveness.
19. As an Owner, I want the account-versus-series precedence shown in the configuration UI, so that I know which rule wins when values conflict.
20. As an Owner, I want account hard constraints to be protected from series overrides, so that forbidden content, tool permissions, asset boundaries, and publishing rules remain enforced.
21. As an Owner, I want account defaults to be overridable by a series, so that a series can intentionally use its own visual or narrative style.
22. As an Owner, I want a production order to be renamed without changing its frozen materials or blueprint, so that administrative naming corrections are safe.
23. As an Owner, I want to archive an Episode instead of deleting it, so that completed or abandoned work can leave active lists without losing history.
24. As an Owner, I want archived Episodes hidden by default but available through a filter, so that normal work stays focused while history remains accessible.
25. As an Owner, I want permanent deletion restricted to the Owner, so that destructive cleanup cannot be triggered accidentally.
26. As an Owner, I want permanent deletion to show the exact local path and data categories affected, so that I understand what will be removed.
27. As an Owner, I want permanent deletion to require a second confirmation, so that a misclick cannot remove production history and local media.
28. As an Owner, I want the system to report which local files and database records were actually removed, so that cleanup is auditable.
29. As an Owner, I want Episode details to open as an overlay drawer, so that the list remains available while I inspect a production order.
30. As an Owner, I want clicking the left-side scrim or pressing Escape to close the Episode drawer, so that I do not need to scroll back to the close button.
31. As an Owner, I want clicking another Episode to switch the open drawer directly, so that inspection of a queue is fast.
32. As an Owner, I want the drawer to show the current stage and next action first, so that I do not have to search through technical details.
33. As an Owner, I want production materials, review packages, Worker tasks, artifacts, and audit history grouped into collapsible cards, so that long details remain manageable.
34. As an Owner, I want consistent typography, input heights, card padding, and button styles in the drawer, so that the interface feels coherent.
35. As an Owner, I want technical evidence and hashes collapsed by default, so that they remain available without overwhelming routine review.
36. As an Owner, I want timeline stages and routine transition reasons in Chinese, so that the audit history is understandable without translating English messages.
37. As an Owner, I want raw error codes and technical provider details available in a technical details section, so that debugging information is not lost.
38. As an Owner, I want production, review, operations, and publish lists to use pagination or bounded sections, so that no page grows indefinitely.
39. As an Owner, I want series operations to use one authoritative series filter, so that a growing number of series does not create duplicate button collections.
40. As an Owner, I want series operations to show counts for stages, review packages, blockers, and Episodes, so that I can prioritize work.
41. As an Owner, I want each blocker to explain what happened in plain language, so that I can understand the problem without reading internal codes.
42. As an Owner, I want each blocker to explain why it happened and how to fix it, so that the page is actionable rather than merely diagnostic.
43. As an Owner, I want the blocker to state whether a retry is safe, so that I do not repeat a task that requires a new configuration snapshot.
44. As an Owner, I want a blocker to link to the relevant account, blueprint, asset directory, or Episode detail, so that resolution requires fewer searches.
45. As an Owner, I want review queue entries to open the same coherent Episode drawer, so that review context and production history are available together.
46. As an Owner, I want the publish queue to open a dedicated publish modal instead of the general Episode drawer, so that publishing is a focused transaction.
47. As an Owner, I want the publish modal to show the video, cover, publish package status, local project path, and verification result, so that I can verify the material before publishing.
48. As an Owner, I want to enter the target platform, publishing account, external URL, external content ID, publication time, and notes, so that the publication can be traced later.
49. As an Owner, I want to confirm that I published manually on the external platform, so that the control plane does not pretend to have performed an action it did not perform.
50. As an Owner, I want one Episode to have multiple publication records, so that the same content can be published to multiple platforms or republished.
51. As an Owner, I want old publication records to remain immutable, so that later republishing does not erase historical facts.
52. As an Owner, I want the publication model to support an automated publishing adapter later, so that a future automation rollout does not require a second data model.
53. As an Owner, I want the learning page to show an isolated demo account and demo Episodes, so that I can explore the learning workflow without contaminating real accounts.
54. As an Owner, I want one demo Episode with an experiment and weekly metrics, so that I can test recording a learning report.
55. As an Owner, I want a second demo Episode with a completed report and pending blueprint suggestion, so that I can test the approval side of the learning loop.
56. As an Owner, I want the system status icon to show a compact health summary on hover, so that I can quickly tell whether the platform is ready to run.
57. As an Owner, I want the status summary to include Supabase, Worker, n8n, media library, and blocked task information, so that I know which subsystem needs attention.
58. As an Owner, I want to click the status icon for a persistent detail panel, so that longer diagnostics are accessible beyond a transient hover.
59. As an Owner, I want a running Episode to show task status, attempt count, start time, and last update, so that I know whether the system is progressing.
60. As an Owner, I want task groups to show progress such as 3/8 completed, so that I can estimate progress without relying on fake percentages.
61. As an Owner, I want running tasks to refresh automatically while I inspect an Episode, so that I do not need to reload the page repeatedly.
62. As an Owner, I want completed, failed, and blocked tasks to produce a clear visible update, so that I know when manual intervention is required.
63. As an Owner, I want n8n to be described as orchestration, notification, and health-check infrastructure, so that I understand it is not the Worker itself.
64. As an Owner, I want future automated publishing to use the same publication record flow, so that manual and automated results remain comparable.

## Implementation Decisions

- Navigation order is series operations, Episodes, reviews, publish queue, learning, and accounts.
- Episode details remain a shared inspection surface for the production, review, and operations pages, but become an overlay drawer with a scrim, Escape handling, section groups, and a prioritized summary.
- The publish queue uses a dedicated wide centered modal rather than the shared Episode drawer.
- Publication facts are modeled as multiple records associated with an Episode. A record stores platform, publishing account or channel, external URL, external content ID, actual publication time, status, and notes. Records are append-oriented and remain available for history.
- The first publishing implementation remains manual. The Owner confirms external publication; the data model leaves room for an automated publishing adapter to write the same record shape later.
- Active and archived Episodes are distinct presentation states. Archiving hides an Episode from default worklists without deleting its records or local assets. Permanent deletion is Owner-only, destructive, requires a second confirmation, and reports cleanup results.
- Account colors are derived from stable account identity rather than table row position.
- Blueprint and series configuration use structured forms for normal operations. Advanced fields remain available in a clearly separated advanced section to preserve compatibility with uncommon rules.
- Blueprint editing always creates a new version. Episodes continue to reference the version fixed at creation time.
- The domain distinguishes account hard constraints from account defaults. Hard constraints cannot be overridden by series rules; defaults can be overridden by a series.
- Prompt context is assembled from account hard constraints, account defaults, the frozen series baseline, Episode input, and current review feedback. The worker task package records the relevant version identifiers and context hash.
- Provider, model, prompt version, adapter, budgets, tools, output paths, and retry settings remain execution metadata rather than free-form creative prose.
- The series operations page keeps one authoritative series selector. Summary cards may show counts but do not duplicate filtering controls.
- Blockers are presented with plain-language summary, cause, resolution guidance, retry safety, and expandable technical details.
- User-visible stage names and normal transition reasons are localized to Chinese. Raw codes, paths, hashes, and provider details remain available under technical details.
- Lists use bounded views, pagination, or collapsed sections. Episode and review lists default to a finite page size; detail cards do not render every technical section expanded.
- Review and publish navigation badges count actionable Owner work, not every Episode in the surrounding lifecycle.
- The system status icon provides hover summary and click-to-open details. It reports frontend connectivity, Supabase reachability, Worker recency, n8n recency, media mount state, required local tools, and blockers.
- Worker progress is based on real task and task-run state: queued, claimed, running, completed, failed, or blocked; it includes attempt counts and group progress such as `n/m` when the task group has a known total. No estimated percentage or time remaining is shown unless backed by reliable data.
- The demo learning data is isolated under explicitly named demo accounts and Episodes and does not require production Worker execution.
- The existing controlled state-transition boundary remains the highest write seam for lifecycle changes. The existing Workspace component boundaries remain the highest UI seam. The existing Worker task package and result schema remain the highest execution seam.

## Testing Decisions

- Tests should verify observable behavior and domain outcomes rather than CSS selectors, internal helper names, or implementation-specific component structure.
- Existing Workspace component tests are the preferred seam for navigation, badges, form visibility, drawer behavior, pagination presentation, blocker copy, and publish modal behavior.
- Existing platform service and RPC-facing tests are the preferred seam for blueprint versioning, series versioning, Episode rename/archive/delete rules, publication record validation, and state transition authorization.
- Existing Worker contract tests are the preferred seam for Prompt context versioning, context hashes, task progress fields, allowed tools, output contracts, and result lifecycle states.
- Existing publishing package tests are the preferred seam for publication package metadata, package verification, and the boundary between manual confirmation and future automated publishing.
- Existing learning workspace tests are the preferred seam for demo learning data presentation, weekly metrics, report locking, and blueprint suggestion approval.
- Add one end-to-end smoke path only if the existing component and RPC seams cannot verify the interaction: create or select a demo Episode, open the publish modal, record a publication, and confirm the queue feedback.
- Verify the collapsed sidebar at desktop, narrow desktop, and mobile breakpoints, including the Owner settings control and status icon.
- Verify destructive deletion with a disposable demo Episode and confirm both the local cleanup report and database state.
- Verify that changing a blueprint or series version does not mutate already frozen Episode task contexts.
- Verify that a series can override an account default but cannot override an account hard constraint.

## Out of Scope

- Automatic publishing to TikTok, YouTube, Instagram, or other external platforms in this implementation.
- Automatic collection of platform metrics.
- Replacing Supabase, n8n, the local Worker runner, or the external media library.
- Moving binary media assets into Supabase or Git.
- Multi-user role management beyond the existing Owner boundary.
- Remote or public access to the local approval console.
- Unbounded real-time streaming of model tokens or per-frame rendering progress.
- A universal schema editor for arbitrary future JSON keys; advanced fields remain a controlled escape hatch.
- Rewriting the existing v1 state machine or changing approval ownership.

## Further Notes

The existing domain decisions are recorded in the project glossary and ADRs for Episode cleanup, multiple publication records, manual-first publishing, and Prompt context precedence. The next implementation should begin with the UI-only batch, then introduce schema-backed forms and lifecycle changes, and only then add publication records, Worker progress, and demo data. Remote issue publication is pending Issue Tracker setup and the required `ready-for-agent` label vocabulary.
