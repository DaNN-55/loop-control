# 多账号内容生产平台 v1 Spec

## 目标

将既有的单账号内容生产能力抽象为可复制到多个账号的平台。v1 服务 2–3 个账号，优先保证生产质量、审批关卡和可追溯性，而非无人值守发布或最大产量。

## 非目标

- 不读取、迁移或依赖任何现有生产项目。
- 不建设公开 SaaS、多用户协作或远程移动审批。
- 不自动发布内容。
- 不将视频、音频、图片等媒体二进制上传到 Supabase 或 Git。
- 不在 v1 自动采集平台指标。

## 约束

- 平台控制数据使用一个 Supabase 免费项目；所有账号通过 `account_id` 隔离。
- n8n Community Edition 本机运行，用于事件编排、通知和定时任务。
- 审批台仅在本机访问。
- 媒体资产长期保存在外置硬盘；平台保存相对路径、哈希和元数据。
- Codex 是 v1 唯一的通用 Agent Worker；接口预留 provider、model、prompt_version 字段。
- Owner 是 v1 唯一审批人。
- 每次付费 Worker 调用必须记录预算、实际成本和最大重试次数。

## 核心状态机

```text
brief_draft
→ script_draft → script_review → script_approved
→ visual_draft → visual_review → visual_approved
→ storyboard_draft → storyboard_review → storyboard_approved
→ production_ready → render_ready → qc_review → qc_passed
→ production_completed
```

只有 Owner 能写入：`*_approved`、`qc_passed`，以及例外和账号蓝图激活状态。发布包校验通过后由受控服务写入 `production_completed`。

## 核心实体

- `accounts`：账号租户和当前蓝图版本。
- `account_blueprint_versions`：版本化账号规则。
- `series`：账号内的内容系列。
- `episodes`：单集生产记录和当前状态。
- `tasks`：可领取的角色任务、输入快照、预算和重试信息。
- `artifacts`：产物索引、哈希、相对路径和来源关系。
- `approvals`、`exceptions`、`state_transitions`、`audit_events`：审批和审计。
- `asset_locks`：对渲染器、浏览器会话和可识别素材的互斥锁。

## 角色边界

- Orchestrator：创建下一合法任务、检查前置条件、记录阻塞；不创作、不审批。
- Content Worker：生成 brief、脚本、字幕和元数据草案；推进至 `script_review`。
- Visual Worker：生成视觉方案、镜头方案和视觉资产；推进至审核状态。
- Production Worker：生成音频、素材组合、渲染候选；不得越过已批准分镜。
- QC Worker：输出检查报告和通过建议；不得写入 `qc_passed`。
- Publish-prep Worker：准备发布包和核对清单；不得点击发布。

## Worker 契约

每个任务必须包含：账号和 Episode 标识、蓝图版本、允许的资产根目录、输入产物及哈希、输出 Schema、预算、最大重试次数和禁止事项。

Worker 必须输出：产物清单、验证结果、实际成本、阻塞项和下一步建议。发现缺失的前置产物、工具、权限或规则时，必须返回 `blocked`，不得静默降级或自行替换供应商。

## 审批与生产完成

审批动作只能通过一个状态迁移接口执行；该接口校验当前状态、必需产物、审批权限和审计字段。前端、n8n 和 Worker 均不得直接修改 Episode 状态。

最终必须生成不可临时拼装的发布包。发布包完成完整性校验后，Episode 进入 `production_completed`；平台不记录外部发布与后续复盘。

## 已知风险与后续演进

- 外置硬盘目前是唯一媒体副本；磁盘故障会造成媒体与证据丢失。
- Supabase 免费项目可能在低活跃后暂停；平台需要健康检查和定期数据库导出。
- 移动审批、远程访问、第二份备份和自动指标采集属于 v2 以后范围。
