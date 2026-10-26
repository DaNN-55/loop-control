# T20：本地原声、字幕对齐与同步预览

> 提交归档说明：Owner 已认可本次 T20 受控离线本地验收，并授权仅提交 T20 实现、验收报告、回归日志与证据索引到当前分支。下文和原始 JSON 的“未提交”、`committed:false`、`noCommit:true` 及 HEAD 描述验收时快照；原始证据保持不变。默认 5 秒门禁历史失败及根因未解决、真实 WhisperX 成功推理和其他既有未验收项，以及模拟资格、SecretStore 替身与 T17 中间日志覆盖说明均继续保留。未推送、合并、操作生产或开始 T21。

2026-10-24，分支 `codex/local-first-stage-a`，起点 `98abbdc05c7178a95702572f5c0d0c0651e5917c`。

**T20 实现和受控离线本地验收已完成；真实 WhisperX 推理成功链仍未验收。** 模型/依赖缺失时的真实队列阻塞、Owner 人工时序和实际音视频预览分别有证据，不能相互替代。本轮默认 5000ms 全量回归通过，**此前默认 5 秒门禁历史失败及根因未解决的限制继续保留，未关闭历史门禁**。未提交、推送、合并、操作生产或开始 T21。

## 票单、依赖和环境

核对本地已发布 T20 / [#126](https://github.com/DaNN-55/loop-control/issues/126)：已有镜头音频的提取、对齐、字幕编辑及同步预览须在本地保存；沿用声音来源优先级、字幕时轴与本期设置；FFmpeg/WhisperX 使用统一队列和资源上限；真实短样本核验字幕、时长、音频和文件引用，缺模型/环境明确阻塞。依赖 T18、T19 均已提交，T19 为当前起点；票单旧状态文字不作为实现证据。未联网刷新票单或修改其状态。

沿用优化工作树、专用 PostgreSQL `loop-control-stage-d-postgres` / `loop_imported`、`loop_empty`（本机 55472）、独立 `loop_app` / `loop_worker` 身份和已挂载专用媒体卷。仅创建 T20 合成账号、生产单与素材；验收应用监听 `127.0.0.1:55183`，专用 Google Chrome 仅访问本机。默认部署配置未启用；测试应用和专用 Chrome 已关闭，专用浏览器合成凭据项已删除，数据库和媒体卷保留。

## 实现与必要修复

- [Owner 命令](../../../src/local-app/episodeCommands.ts) 和 [本地详情](../../../src/local-app/LocalEpisodeDetail.tsx) 接管原声提取、显式对齐、人工时序、预览生成与确认；校验 Owner、当前批准包、实际文件指纹和音频时长。人工 cue 不得替换正文、重叠或超出实际音频；复用产物仍校验文件。
- [工作台](../../../src/episodes/EpisodeProduction.tsx) 使用显式本地回调；回调失败不转到旧 RPC。人工时序编辑不会被音轨轮询重置；保留原有音频来源和字幕内容模式。
- [原生队列与 CLI](../../../src/local-app/localWorkerCli.ts) 接入 FFmpeg、WhisperX 和镜头同步预览，沿用已有资源/租约/成本门禁。Episode 单独选择对齐/预览资格，历史未接管任务不因部署自动领取。
- [019](../../../db/local/019-alignment-preview.sql) 至 [024](../../../db/local/024-auto-alignment-model.sql) 均为前向迁移，在两个隔离库应用并核对 SHA；已应用迁移未改写。新输出使用任务 UUID 路径；保存字幕保留同一原声及进行中提取；素材变化清除绑定。对齐回写核验当前正文、音轨 SHA、voice/rate 和结果版本/模型，拒绝陈旧结果；显式与 TTS 自动建队列使用同一实际模型。
- [WhisperX 适配器](../../../src/local-app/alignmentWorker.ts) 固定离线环境、专用缓存、Python 和 runner SHA；实际强制对齐模型统一为 `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`。脚本拒绝不匹配模型，缺时间戳/错配字符的补位候选标为低置信度、要求人工检查。真实模型加载、推理及目标 WhisperX 版本的接口兼容尚未验证。
- 逐帧检查发现旧坐标把字幕移到画外。[OpenChatCut 映射](../../../src/worker/openchatcutProject.ts) 现换算 0.2.14 自带的横向 10% / 纵向 8% padding 及底部锚点方向；读取校验共用该换算，字幕正文、时序、安全区设置不变。[修复前](evidence/preview-frame-01.png) / [修复后 1.5 秒帧](evidence/preview-frame-02.png)。
- Chrome 发现本地视频只能顺序播放，不能可靠跳转。[产物读取](../../../src/local-app/artifactRoute.ts) 现在在原有完整文件 SHA 校验后支持单段 Range / suffix / open-ended；非法或多段返回 416。两个入口仍要求 Owner 会话，不能借分段请求绕过鉴权或指纹检查。

## 验收结果

| 项目 | 结论与证据 |
|---|---|
| 真实 HTTP → PG → Worker CLI | [最终日志](evidence/http-08.txt)、[结构化结果](evidence/final-02-http-result.json)：片段、原声提取、人工时序、OpenChatCut 代理/工程/QC、确认；重复提交和完成任务复用不增加同一任务 |
| 真实短样本 | 已安装 macOS 中文声音产生可重建合成语音，加入 8 秒合成源视频，取前 4 秒；实际 MP3 4.046440 秒、代理 4.053333 秒、1080×1920；字幕 cue 100–3450ms，原声在 A1，视频自身静音，避免双重声音；[媒体核验](evidence/media-audit-01.json) |
| 模型缺失 | 现有 Python 无 whisperx/torch、无专用缓存模型，未安装/下载；canonical 模型任务被实际领取并以 `worker-preflight/v2` / `unavailable` / `contact_environment_admin` 阻塞，无对齐产物；[安全摘要](evidence/missing-model-final.json)。不是模型成功验收 |
| 并发与模型身份 | [真实 PG、回滚合成回调合同](evidence/callback-contract-07.txt)：旧对齐不覆盖新正文、错误模型拒绝、文本变化改变输入版本、提取跨字幕/未换素材保存仍自动绑定；合成 narration 完成后自动队列与显式请求复用同一 canonical task。所有模拟行回滚，不是实际 TTS 或模型推理 |
| HTTP 边界 | [17 项](evidence/boundary-01.json)：未登录、Origin、CSRF、跨 Owner、旧审核包、未知字段、正文替换、cue 重叠、音频/代理篡改和复用拒绝；受控文件改动均已恢复 |
| 浏览器 | 专用真实 Chrome 验证缺模型提示、原声播放、人工编辑跨轮询、保存、生成、确认与刷新；浏览器曾将开始值从 100 改为 200ms，后续 API 样本明确重设为最终 100–3450ms；最终刷新与 DB 一致。[最终截图](evidence/browser-caption-final-03.png)、[播放及跳转](evidence/browser-range-seek-final-01.json)：可播放、seekable 0–4.053333、跳转 1.5 秒可见字幕 |
| Range | [真实 Owner HTTP](evidence/range-01.json)：两个入口共 6 个 206 范围与原始字节一致；越界 416、未登录 401。独立 HTTP 单元测试另覆盖篡改拒绝 |
| 历史与索引 | [审计](evidence/audit-01.json)：38 表、T20 前 25,258 行原始记录逐行多重集匹配，21 个当前及历史产物文件大小/SHA 一致；两个库迁移 SHA 一致，新增 Owner 私有函数不向 anonymous/Worker 开放，根 PLAN 原有内容未改 |

浏览器和文件帧均已实际目视。没有把工程存在 cue、可解码、静态审查或合成回调当成字幕实际可见/模型成功。原生 WhisperX 在真实环境可用时的成功推理、跨能力完整任务仍需后续单独验收。

## 回归

- [最终默认命令](evidence/regression-default-5000-final-02.txt.json)：未传超时覆盖，排除既有 integration、n8n 与隔离快照副本；[95 文件、744 项全部通过](evidence/regression-default-5000-final-02.txt)。历史慢 UI 用例正文与 T19 基线完全相同，见 [边界审计](evidence/final-boundary-01.json)。
- TypeScript、原生应用编译、准备后 runtime 指纹检查通过；[本地前端构建](evidence/frontend-final-01.txt) 使用私有 outDir，未覆盖 Worker dist；[Node 回归](evidence/node-final-01.txt) 为 2 通过、1 个既有跳过。
- 修复前中间全量为 742、743 项通过，均保留，最终数字以 744 为准。定向第 01 次误扫历史副本，不计入当前结果；第 02 次正确排除隔离目录，为当前 11 项通过。最终全量覆盖后续新增模型与 Range 检查。React `act` 等既有测试警告保留在原始输出中。
- 本次通过不能关闭 B/T06 与 T19 的默认 5000ms 历史失败或根因问题。[T19 同机基线对照](../stage-d-t19-timeout-comparison/README.md) 的“非 T19 新增、间歇历史问题”结论保留；本轮没有宣称修复该根因或完成新的基线对照。

## 保留的限制与证据口径

1. 默认部署、在线生成、其他 Provider 的真实在线资格/效果和完整多能力 Worker 组合尚未验收。T20 在线 Provider 请求为 0、费用为 0；未读取生产凭据或操作任何生产服务、登录/系统钥匙串及钥匙串既有 ACL。
2. 此前 `live/verified` 模拟资格、SecretStore 受控替身不构成真实在线/Keychain 证明；T20 未新增资格、秘密或连接，不改变既有资格撤销记录。
3. [T17 中间日志覆盖说明](../stage-d-t17/README.md) 原样保留：中间通过 stdout 曾被覆盖，仅有命令/退出码清单，最终原始和失败日志仍在，不能重构成完整原始记录。
4. T20 编号 stdout、失败日志、截图和最终证据按独立文件保留；早期 `fixture.json`、`http-progress-private.json`、部分 `*-private.json` 是滚动状态，不是逐请求档案。后期 `final-01` / `final-02` 独立快照未覆盖。浏览器个别文字等待超时和不支持 seek 的诊断记录不是通过证据；最终通过依据明确列出。未声称归档所有中间响应。
5. [证据索引](evidence-index.json) 区分仓库可公开文件与私有证据。DB dump、Owner/数据库凭据、含任务租约的完整快照、运行配置、服务原始日志及浏览器认证库不纳入仓库；没有原始 HAR。私有证据仅索引路径、SHA 和用途。

[双轴复核](review.md) 的发现已修复并复核；规范与票单轴分别报告，不替代运行证据。根 `PLAN.md` 和无关规划文件未改、未暂存。此报告不代表 GitHub 票单关闭、整个 D 阶段完成或任何提交/发布授权。
