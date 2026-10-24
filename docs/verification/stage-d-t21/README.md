# T21：本地 Studio 编辑、冻结与审核视频

> 提交归档说明：Owner 已认可 T21 受控离线本地验收及基线对照，授权将本次实现、报告、回归日志和证据索引仅提交到当前分支。正文及原始 JSON 中的“未提交”、`committed:false`、`noCommit:true`、`indexEmpty:true` 和 HEAD 均描述验收时快照，原始证据不改写。默认 5 秒门禁本次及历史失败、根因未解决、真实 WhisperX 成功推理及其他既有未验收项，以及模拟资格、SecretStore 替身和 T17 日志覆盖说明继续保留。未推送、合并、操作生产或开始 T22。

2026-10-24，分支 `codex/local-first-stage-a`，起点 `eb13173aa0bdb5e734d4b0f0f622a81faeea7312`（已提交的 T20）。

**T21 实现及受控离线本地验收完成；默认 5000ms 全量门禁本次仍未通过，历史失败及根因未解决的限制继续保留。** 本文仅确认指定隔离环境中的编辑、保存、冻结、真实渲染、QC、修订及失效行为，不等同于默认部署或完整 D 阶段通过。当前未提交、推送或合并，未开始 T22。

## 票单、依赖与边界

依据本地已发布 T21 / [#127](https://github.com/DaNN-55/loop-control/issues/127) 核对三项标准：工作版本与冻结快照分离；真实 OpenChatCut 审核视频、运行/QC/媒体索引在原详情展示；修订、重复提交、刷新及指纹失效保持一致并复用原队列和渲染能力。依赖 T20 已提交；票单中的“尚未实施”是旧规划状态，本次不修改票单或规划文件。未联网刷新 GitHub。

沿用优化工作树、专用 PostgreSQL `loop-control-stage-d-postgres`（本机 55472）、`loop_imported` / `loop_empty`、独立应用/Worker 身份及已挂载测试媒体卷。仅新建一个 T21 合成账号和两个生产单（API / browser），使用可重建本地 MP4、MP3 和图片。应用为 `127.0.0.1:55184`，编辑器为动态 loopback 端口；独立真实 Chrome 仅允许本机访问。没有在线 Provider 请求、模型下载、生产凭据读取或生产服务操作；本次 Provider 费用为 0。

## 实现

- [本地 Studio 命令](../../../src/local-app/studioCommands.ts) 校验 Owner、当前批准分镜/QC、确认指纹和真实输入文件；原生服务只从已确认镜头及已选音轨构建工程，不接受前端运行配置覆盖。打开工作版本不会自动创建审核渲染。
- [编辑器桥接](../../../src/worker/openchatcutStudio.ts) 复用现有 OpenChatCut，保存工作版本；显式提交时读取编辑器权威存储，核对提交期间 SHA，写入新 UUID 的只创建冻结文件。QC 重开以实际冻结工程为基线，保留已编辑字幕；输入变化须明确确认替换，不能覆盖未提交编辑。
- [025](../../../db/local/025-studio.sql) 至 [027](../../../db/local/027-studio-freeze-binding.sql) 为前向本地迁移，两库均校验 SHA。Studio 单独选择任务资格；私有函数带 Owner 校验，anonymous / Worker 无执行权限。输出使用任务 UUID，旧冻结和旧渲染保持不变。原有 QC 工作台允许的阶段同时支持重新生成片段/提取原声。
- 真正运行发现两个接管问题并修复：时长读取经过带 Owner 校验的私有函数，避免扩大公共权限；共享排队函数在 `production_ready` 重新选择默认配置时会丢失 Studio 引用，027 只为本事务新建的受管任务绑定原业务命令已记录的同一个冻结引用，并同步合成记录。
- [原生 Worker](../../../src/local-app/mediaWorker.ts) 接管 `generate_review_render`，复用原队列、租约、OpenChatCut CLI 与 QC；不放开 final/delivery。原 Studio builder 提取为[共享纯模块](../../../src/worker/shotWorkbenchStudio.ts)，保留声音/字幕/契约，修正多格并行素材的播放时长，并纳入当前 BGM/SFX 选择。
- [本地详情](../../../src/local-app/LocalEpisodeDetail.tsx) 接通已有编辑、生成和修订入口，继续使用原有产物、运行和 QC 展示。

## 验收证据

| 检查 | 结果与证据 |
| --- | --- |
| 初始工作版本 | [两生产单准备](evidence/seed-01-seed-result.json)：真实原生 HTTP/PG/CLI 完成两镜头、原声、人工时序、同步预览及确认，显式生成前审核渲染任务数为 0。真实工程 v3，两个字幕车道；[打开结果](evidence/open-02.txt) |
| 生成与修订 | [API 结果](evidence/api-09-http-result.json)：真实编辑器权威写入协议、原生 Worker、OpenChatCut 渲染均执行；同 key 并发和不同 key 同输入各复用单任务，QC 合成修订产生新任务/冻结/输出；旧冻结字节不变，QC 重开读取已编辑工程，未提交工作版本须明确替换 |
| 真浏览器 | 独立 Chrome 实际输入字幕“浏览器真实编辑 T21”、点击保存、刷新编辑器并重启本轮服务后重开，文本均保留；点击“生成审核视频”并等待 QC；[最终结果](evidence/browser-32-result.json)、[重启后](evidence/browser-09-editor-restarted.txt) |
| 可见渲染、索引、运行与刷新 | 浏览器真实 MP4 readyState=4、8.042667 秒，播放到末尾且无媒体错误；[播放记录](evidence/browser-19-playback.txt)、[媒体索引](evidence/browser-23-index-text.txt)、[运行时间线](evidence/browser-27-runs-text.txt)、[刷新后 QC](evidence/browser-30-final-refresh.txt)。从真实 MP4 提取并目视的[1.5 秒帧](evidence/browser-31-render-frame.png)确实显示新字幕 |
| 安全与文件指纹 | [8 项边界](evidence/boundary-01-boundary-result.json)：401 未登录、403 CSRF/跨来源、404 跨 Owner、400 跨生产单路径/空原因、409 旧 QC/冻结指纹变化。受控文件字节已恢复，未生成额外任务 |
| 输入变化 | [手工对齐修改](evidence/input-01-input-revision-result.json)改变准备指纹，使旧预览和确认失效，未重新确认的整期 Studio 返回 409；旧冻结不变。API 样本最终有意停在需新预览状态；browser 样本保留已完成 QC |
| 历史隔离与索引 | [只读审计](evidence/audit-01.json)：T21 前 38 表、25,476 行原记录按逐行多重集全部保留；T21 当前/历史 47 个产物文件大小/SHA 全匹配；两库迁移 SHA 一致，私有函数 Owner 可执行、anonymous/Worker 不可执行；根 PLAN 原有内容哈希不变 |

API 的工程文本修改是受控编辑器 API 操作，和 Chrome UI 编辑分开取证；本次 QC 合成修订通过真实 HTTP 验证，没有声称在浏览器点击完成所有修订类型。真实渲染是确定性的本机媒体执行，规划器为离线合成替身，不是在线创作质量验证。

## 回归与默认 5 秒对照

- 当前默认完整命令未传超时覆盖：[96 文件 / 745 项，740 通过、5 失败](evidence/default-5s-01.txt)。失败集中在 `ReviewWorkspace`：3 项 5000ms 超时，2 项断言失败。**全量失败是本轮门禁结论，不用定向通过覆盖它。**
- T21 前 T20 基线使用 Git archive 冻结，复用同机、同 Node、同依赖和同环境，执行同一默认全量命令：[95 文件 / 744 项，740 通过、4 失败](evidence/baseline-default-5s-01.txt)，复现当前的 3 个超时和字幕编辑断言失败。
- 对照同一整份工作台测试文件、仍使用默认 5000ms：[基线 64 通过 / 1 超时](evidence/baseline-workspace-default-5s-01.txt)，[当前 65/65 通过](evidence/current-workspace-default-5s-01.txt)。测试文件、`App`、`EpisodeProduction` 和 Vite 配置哈希一致，详见[方法及结果](evidence/comparison-method.json)。当前全量额外出现的“删除镜头后…”断言，在两边定向运行均未复现。
- 明确判断：已证实基线存在相同超时及多项失败，**没有证据将其认定为 T21 新增的稳定功能回归**；当前额外断言只在一次全量中出现，不能据此宣称已彻底排除间歇时序影响。默认门禁仍未通过，根因未解决，本轮没有修复、放宽或关闭该问题。仅进行一次全量及一次整文件对照/侧，没有反复重跑全量取得绿色结果。
- [55 项定向检查](evidence/focused-01.txt)通过；新增检查覆盖并行多格时长及声音输入保留。最终 TypeScript、原生编译、准备后 runtime 指纹及私有 outDir 的本地前端构建通过；Node 为 2 通过、1 个既有跳过。原始警告保留，未新增依赖。

## 保留限制、失败记录与收尾

1. 默认 5 秒门禁历史失败及根因未解决继续保留；本次默认全量仍失败。真实 WhisperX 成功推理、默认部署、在线生成、其他 Provider 和完整多能力 Worker 尚未验收。
2. 既有模拟资格、SecretStore 替身不构成真实在线资格/秘密存储证明。本次没有新增 Provider 资格或秘密绑定；没有把确定性本机渲染称作完整多能力验收。
3. [T17 中间日志覆盖说明](../stage-d-t17/README.md)继续保留：部分中间 stdout 曾覆盖，不能重构为完整原始记录。本轮编号日志和截图不覆盖；`fixture.json`、HTTP progress、runtime 等明确为滚动私有状态，不声称保存了每一中间响应。
4. 首次打开 403、早期编辑脚本的旧 PUT / Fetch Metadata / 规范化版本与轨道 / 传输字段不匹配、冻结引用校验失败等均保留原始日志。未放宽编辑器所有权或 CSRF。诊断脚本一次错误覆盖 Pool.connect 导致本轮服务退出等待，改用连接事件监听后恢复；只结束已确认属于本轮的进程。API 07 是该诊断阶段的中断运行，不计入通过。
5. [证据索引](evidence-index.json)区分可入库文件和私有文件。DB dump、Owner/数据库凭据、完整任务租约快照、编辑器运行状态与本地认证文件不复制到仓库；没有原始 HAR。私有原始证据保留在隔离目录，并记录路径/SHA。
6. 本轮应用、Worker、Studio 和专用 Chrome 已关闭，专用合成认证项已删除；数据库与媒体卷保留，[收尾检查](evidence/cleanup-final-01.json)。默认本地 Worker 配置仍不存在，未操作生产、提交、推送、合并或开始 T22。根 PLAN 与无关规划文件未修改、未暂存。
