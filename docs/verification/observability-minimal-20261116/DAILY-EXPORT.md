# 日常环境真实导出与埋点数据

2026-11-16 已完成一次真实、不付费的本机导出。当前日常原有采样器实际写入了 2 条资源样本；新增验证工程 10 条制作事件，实际只读 CLI 汇总一致。没有手工插入事件、手工调用资源写入函数或修改采样规则。

## 验证对象

- [打开独立验证工程](http://127.0.0.1:5174/?view=episodes&episode=a947859e-da2e-4901-bfea-bd453141933a)：埋点验证｜现有素材 60 秒本机导出 20261116。账号独立命名“埋点采集验证 20261116”，本工程保留。
- 生产单：`a947859e-da2e-4901-bfea-bd453141933a`；工作区：`5109abbb-5c04-4423-8ba1-e5b39f2ad266`；导出：`3a7299df-4f31-4c3b-a033-a03674850003`。
- 两张现有图片以素材副本导入新账号，六个 10 秒镜头，共 60 秒；1080×1920、30 fps、1800 帧。没有调用付费图片、视频或语音生成。
- 为验收现行普通生产采集路径，本工程 `is_test=false`，没有改变采集排除规则。报告中应保留“验证工程”标识；它会出现在普通 Owner 日汇总中，不能误算成新增客户作品。
- 导出状态 `ready`，六项技术检查通过，另外执行了完整视频解码；实际 SHA-256 为 `b644cc70d05574f8eed69309c2be317f9434db10fccf9f3f64337307e460e9ed`，文件 78172535 字节。
- [本机导出 MP4](</Volumes/Ebuget 1T/Media/埋点采集验证 20261116--cb9336ea-41ad-43ff-864a-f1f1cffbdfae/未分系列--5cb8cb41-9d31-4300-88c5-d55a9b358974/埋点验证｜现有素材 60 秒本机导出 20261116--a947859e-da2e-4901-bfea-bd453141933a/workspace-exports/3a7299df-4f31-4c3b-a033-a03674850003/b644cc70d05574f8eed69309c2be317f9434db10fccf9f3f64337307e460e9ed.mp4>)（原文件保存在新账号目录，未复制覆盖原交付）。

## 本次实际采集的 10 条制作事件

以下为数据库 `occurred_at`，时区 Asia/Shanghai；ID 排序与事件发生时间可能不同，导出起点在完成事务中按实际开始时间记录。

| 时间 | 数据库事件 | 含义 / 已采值 |
| --- | --- | --- |
| 12:08:51.330 | `episode_created` | 创建独立生产单；无 → waiting_input |
| 12:08:51.330 | `workflow_milestone` | 记录制作起点 |
| 12:08:51.474 | `workflow_milestone` | 保存主脚本版本 |
| 12:08:51.897 | `stage_transition_evidence` | 所有者阶段决定；waiting_input → script_approved |
| 12:08:51.914 | `stage_changed` | 阶段变更；waiting_input → script_approved |
| 12:08:51.915 | `workflow_milestone` | 确认脚本 |
| 12:08:52.066 | `workflow_milestone` | 工作区准备完成 |
| 12:08:54.003 | `local_export_started` | 本机导出开始 |
| 12:09:50.616 | `workflow_milestone` | 成片可用 |
| 12:09:50.617 | `local_export_finished` | 本机导出完成；outcome=ready；56.613808 秒 |

本机导出从 **12:08:54.003** 到 **12:09:50.617**，记录 **56.613808 秒**。这是本机导出流程的经过时间，包含渲染后检查和文件登记，不是纯渲染时间或人工工时。未经过的剪辑器打开/保存、供应商请求和最终交付确认，没有伪造相应事件。

## 日常采样器实际落库的资源数据

| 采样时间 | 整机 CPU | 整机已用内存 / 总量 | 活动本机导出 | 后台排队 / 运行 / 资源等待 |
| --- | ---: | ---: | ---: | --- |
| 12:08:58.893 | 未知 | 15.85 / 16.00 GiB | 1 | 0 / 0 / 0 |
| 12:09:28.894 | 61.3% | 15.87 / 16.00 GiB | 1 | 0 / 0 / 0 |

首条 CPU 为 null：刚从空闲进入活动，缺少上一个活动 CPU 读数；不是 0%。第二条是约 30 秒区间的整机 CPU 观测。内存按总量减空闲计算，含系统与其他程序，不等于此工程或单个进程用量；GPU 为未采集（null）。两条样本均位于本次实际导出起止之间，`active_local_exports=1`，生成任务运行数始终 0。资源是 Owner 范围的整机观测，不提供单工程成本归属。

## 实际只读汇总

实际执行：

```sh
node scripts/production-metrics.mjs --owner 644f8c5a-b668-48a3-8a25-94c4e502fa04 --from 2026-11-16 --to-exclusive 2026-11-17
```

| 汇总字段 | 实际值 |
| --- | --- |
| collection.state | enabled |
| 当日活动事件 | 12（验证前 2，本次增加 10） |
| localExports.started / finished / ready | 1 / 1 / 1 |
| localExports.failed / rejected | 0 / 0 |
| localExports.durationSeconds.mean | 56.613808 |
| resources.samples / maximumLocalExports | 2 / 1 |
| resources.cpuPercent.known / mean / p95 | 1 / 61.3 / 61.3 |
| resources.maximumMemoryUsedBytes | 17043013632 |

只读汇总的 `health=not_observed_by_this_report` 表示报告没有提供实时采样器健康探针；本次健康验收的证据来自真实落库的两个样本及实际导出，不将配置开关冒充健康。历史供应商实际扣费保持未知；本次新增付费生成请求、费用预留、供应商发送记录均为 0。

## 日志、原工程和交付物

21 个正式 HTTP 命令均返回 200，对应 42 条 started/responded 日志；requestId/operationId 一致。20 个已有命令路径记录固定 operation 及已校验业务身份；新建账号的 configuration 路径仍是路由日志，没有冒充已记录固定操作名。日志没有本次 ERROR。

15 张业务表的所有原有行摘要均保留，原 4 个生产单、3 个工作区、6 份导出、2 份交付记录未改；389 个原工程/交付文件及两张源图片的 SHA-256 全部一致。任务 58、运行记录 56、付费预留 28、供应商发送记录 15 均未增加。新工程只新增独立账号、生产单、3 个导入材料版本、工作区/版本及 1 份本机导出。导出验收阶段 Git index 未变，没有修改应用代码、提交或推送。

预检后并行模板任务更新了示例并完成日常重启；真正执行本次请求的后端和 Worker 全程同为 `a735bcb97db578b885c380e7a87f9c6d6b5151a11192e38bdabb2efa058f11ba`。HTTP 前后系统状态、请求日志均一致；与早先 c4515ae4… 相比仅模板脚本模块变化，采样器/只读汇总未变。没有重复导出。

## 原始数据

- [完整采集数据 JSON](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/data.json)
- [本工程全部事件 JSON](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/events.json) · [事件 CSV](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/events.csv)
- [资源样本 JSON](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/resources.json) · [资源 CSV](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/resources.csv)
- [实际只读汇总 JSON](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/report.after.json) · [验证前汇总](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/report.before.json)
- [本次关联日志](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/request-logs.json) · [原工程及文件保护结果](/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-export-validation-20261116/preservation.json)

备份位于 `/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/recovery/before-daily-export.dump`，不包含在公开报告链接内。验证过程和结果保存在上述私有证据目录，辅助进程收尾关闭；新工程、素材副本、导出物和真实采集事实保留。

## 本地收尾

最终数据、验证工程、导出文件和上方明细链接保留。旧索引副本、临时浏览器辅助脚本与重复的过程快照已移入可恢复废纸篓；`.scratch/observability-daily-export-20261116` 已清理，唯一数据库恢复备份迁至上述私有 recovery 路径。实际过程清理回执位于同一证据目录的 `../closeout/artifact-cleanup.json`。
