# #154 / T02 验证记录

本票实现持久四步工作空间、素材未齐时的真实原生占位初稿、Owner 素材匹配和 Studio 保存恢复。四步入口需明确启用；单纯导航不写审批、任务或历史。原有生产功能保留。后续生成、局部采用和最终交付由相应子票接入，本票 `deliverable=false`。

## 实现边界

- 迁移 `084-four-step-workspace.sql` 保存稳定 workspace / clip / native item / material revision 身份与只追加历史；不修改旧迁移。
- 已确认脚本、有效分镜包是初稿基准；脚本变化后旧工程仍可读，显式理由与当前版本才能重新规划。已有 Studio 活跃会话不能被准备页直接覆盖。
- 工程使用真实 OpenChatCut 文档，原生 text item 表示占位；不伪造旧逐镜头确认，不另设可编辑时间线。
- 内容版本排除原生 selection；精确文件版本另用 SHA256。持久 DB 引用不可变 SHA 文件，mutable native working file 单独管理。
- 新 workspace 存在后，旧 v2 自动继续仅等待，不改变其授权或已排队任务。迟到 Worker 结果的四步回写边界交接 T05/T13，见 CONTRACT。

## Red → Green

1. 首个真实 HTTP 用例因未知 `prepareWorkspace` 返回 400 而失败，日志 `evidence/loop-154-red.log`。
2. 新工作台启用后旧 runner 仍返回 `renderScriptReview`，新增行为测试先红，日志 `evidence/loop-154-runner-red.log`；只读 guard 后通过。
3. 最终 focused 测试：3 个文件、19 项通过，包含导航只读、明确启用、原生嵌入保存边界和旧调度保护。
4. 最终真实 HTTP + PostgreSQL + Studio 集成：1 个多阶段场景通过（5.40s）。覆盖部分匹配、真实占位打开保存、关闭并重建 HTTP handler/命令服务后恢复、指定占位填充、历史工程读取和重规划。
5. SQL UPDATE 触发器注入真实失败，命令返回 503；随后 GET 仍返回旧工程 SHA，去除触发器后同一指定占位成功填充。此验证不以接口受理代替持久成功。
6. 非法 Owner 404、无 CSRF / 外部 Origin 403、过期 revision / 旧脚本基准 409、非本期素材 404，均走真实 HTTP。
7. 旧严格 Studio 入口真实集成回归通过（1 场景，5.10s）。
8. `npm run check`、`npm run build` 通过；Vite 仍有已有的 500 kB chunk 提示。

## 主 Agent 真实浏览器验证

Owner 在正式页面入口明确启用四步，shot-1 匹配视频、shot-2 保留占位；进入真实 OpenChatCut 后，占位导航和占位文字可见。把 shot-1 水平位置设为 13，保存返回，Owner project 接口回读 `transform.x=13`，工程种类仍为 `[video,text]`、占位为 1。

刷新页面后填入 shot-2，再次进入真实 Studio，工程为两个 video，shot-1 原生水平 slider 仍为 13。证据为 `evidence/t02-placeholder.png`、`evidence/t02-restored.png`、`evidence/t02-browser-readback.json`。

## 环境与取舍

全部写入随机隔离 DB / 临时媒体根；只读借用已安装 OpenChatCut 与 runtimeContext 模块，无日常数据写入、付费 Provider 调用或原片修改。浏览器专属 55402 服务已关闭，其随机数据库和临时媒体根已移除。命令服务恢复验证在同进程内重新创建 HTTP handler 与命令管理器；未把它表述为 OS 进程/整机重启测试。

T02 匹配入口先支持已注册视频；图片与生成音轨后续集中扩展来源验证和原生工程装配。最终渲染、字幕交付与批准由后续票验收，当前不能交付。后续票只通过 CONTRACT 的 Owner / revision 锁、原生文档与统一 immutable persist 接入。
