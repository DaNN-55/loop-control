# #158 / T06 验证记录

状态：本票实现与受控验收已完成，最终提交见 Git 历史。唯一写树 `/Users/dan/.codex/worktrees/t06-workspace-audio/loop-control`，分支 `codex/t06-workspace-audio-152`。最终同步 integration `1a06150f`，保留 T10 last-effective native-save 保护。未改日常数据库、凭据或 Keychain，未触发付费调用或社媒发布。

## TDD 与接收边界

批准 seam 为 Owner 原生 HTTP、隔离 PostgreSQL、真实 loop_worker lease/result、真实 native 工程与实际音频渲染。最初纯 native 路由测试缺模块为 RED；实现后 GREEN。首个 Owner HTTP 人工整期 BGM 用例在命令不存在时返回 400 为 RED；接线后完成采用、gain/ducking、重启恢复与 CSRF 验证。

仅 JSON、排队成功和 iframe 出现均不计完成。受控 Provider 明确使用 synthetic secret/module，不读取或测试 Owner 真实外部连接；所有素材为受控正弦音/纯色画面，仅验证传输、路由、时间、相对增益与闪避。

## 隔离资源与排障记录

每个场景新建 `loop_studio_153_<random>` 数据库，仅 schema-only 读取日常结构；所有后续 DDL/DML/Owner/Worker 池绑定该随机库。原生、Owner/UI 和 Worker DB 转发均随机 loopback 端口；转发只接收该确切随机库和 `loop_worker`，拒绝其他 role/database/startup 选项。

首次真实 CLI source/Freesound 路径被生产 `verifyMediaLibrary` 正确阻塞：普通 tmp 目录不是实际 mountpoint。未放宽此 guard。经 root 明确授权，测试在随机 `/private/tmp/loop-t06-volume-*` 中创建独立 256 MB APFS sparseimage，并仅将其挂载到自身 `mounted` 目录；`embeddedStudioFixture.testRootParent` 把本次账号媒体建在该卷中。finally 先关闭本次 Worker/Owner/Studio、删除本次随机测试库/媒体，再精确 detach 此 mountpoint 并删除自身映像。记录 `isolated-volume-log.txt`；不操作日常卷。

实际 source 提取 CLI→lease/result→`audio_tracks`→native 采用已单例 GREEN。Freesound 的受控 HTTP 503 沿既有 Worker 协议为 `failed`，允许 Owner 显式重试。

两次执行在 runtime:prepare 或测试期间继续修改受跟踪音频源码，被 manifest 完整性保护拒绝。原因是本票执行顺序；没有将其当作业务 GREEN。改为冻结所有 runtime 依赖，先完成前端 build，再 runtime:prepare，随后串行 Worker/渲染，期间只写测试/文档。

OpenChatCut 外层 Vite 使用本次随机端口，内部 renderer 使用原生固定 localhost:3000。与 root/T10 协调串行渲染；没有停止任何他人进程。T10 曾遇 renderer500，缺少同时运行的双进程证据，因此只记为潜在并行干扰，未认定根因。

## 已读取的检查

- `src/workspaceAudio.test.ts`：主声路由、多槽不复制、source/TTS/none、BGM/SFX 独立与未准备 source 阻塞。
- `WorkspaceAudioPanel.test.tsx`、`ProductionWorkspacePanel.test.tsx`、`EmbeddedStudioHost.test.tsx`：显式准备/应用、TTS 原片默认关闭、真实 Host 协议的单元回归。早期合计 12 项通过；新增公共接口用例另通过。
- 前端 build、worker:build、backend:build、runtime:prepare 已成功；生产 bundle 保留现有 >500 kB 提示。

## 最终集成与渲染

Owner HTTP、真实 Worker、实际原生工程和音频边界均已验证。五份混音 MP4 的早期完整场景集成 4/4 通过（177.9 秒），真实裁切合同变更后又明确以 Owner 的 72 帧同窗重跑组合（138.5 秒）；合入最终 T10/T12 后又通过三条 Owner/Worker 非渲染链和两条真实 planner 新旧对照。非零 source-window 裁切、native MP4、partial/retime 对齐保护在最新 `1a06150f` 上通过（42.9 秒）。Worker 契约/执行器/任务解析与 UI/公共接口兼容组 62/62 通过；Host/字幕/工作流受影响组 14/14 通过。最终非渲染组 6/6 通过（83.4 秒），覆盖新旧 planner 和显式口播采用：采用使共享 native_edit_revision 增加 1，另一个迟到首次结果仍保留候选。最终集中兼容/Host/UI 组 8 文件 73/73 通过，保留一条 React act 提示，未出现失败。

实际渲染捕获并修复了原生闪避符号错误：UI 正深度必须写 native 负 `duckDepthDb`；早期正值会提升配乐，不能计为通过。最终独立 DFT 数值如下（幅度，采样窗 0.5–0.9 秒；SFX 另测 1.1–1.3 秒）：

| 场景 | 330 Hz 口播 | 440 Hz 原声 | 110 Hz 配乐 | 说明 |
| --- | ---: | ---: | ---: | --- |
| source | 0.0000408 | 0.124524 | 0.009693 | 原声独立主轨 |
| TTS | 0.118676 | 0.00000761 | 0.009722 | 原片默认静音 |
| 两个并行画面 | 0.118676 | 0.00000761 | 0.009722 | 与单画面口播完全同幅 |
| TTS + -24 dB 环境声 | 0.118647 | 0.007834 | 0.009720 | 原声约为 source 的 0.063 倍 |
| none | 0.0000000337 | 0.000000203 | 0.029808 | 移除主声/环境声后配乐恢复 |

SFX 880 Hz 在定位窗约 0.05944，之前约 0.000000515；没有提前播放。无主声的后段配乐约 0.02931，主声期间约三分之一。BGM/SFX 独立音量、闪避字段与字幕轨保留；已确认独立字幕在 BGM 采用和混音后仍保持相同输入指纹、current 和 textConfirmed。

## 非零 source window 与对齐

真实 RED：Owner 选择源 1–2 秒时，旧提取结果为 4 秒。修复后的实际裁切 MP3 时长为 1 秒，SHA 为 `3da3bf65ea1313022d955b59e3393ba55fd0890ce9bad2875be1007111d21023`。输入在不同时间段为 440/660/880 Hz；结果 660 Hz 幅度 0.125045，440/880 Hz 低于 0.00001。不能以恒定频率只测时长冒充入点正确。

native 将这份裁切轨从零入点播放。相关 MP4 首段 660 Hz 为 0.125001；第二串行 range 的 660/880 Hz 都为 0，明确保留 Owner 选定的单实例主声，没有自动拼接。状态为 coverage=partial（主声 1 秒，shot 2 秒）；整段声学对齐返回 409“部分”。删除另一个 range 后，真实 native-store/Owner-save 把主声设为 0.5 速，覆盖为 full 但 alignmentReady=false；整段对齐返回 409“变速”，工作版本可继续读取。独立字幕仍允许明确手工校时，不会登记成完整语音对齐证据。

可选 `start_seconds` 同步生产者、parser、Worker 契约和 ffmpeg transport；负值、非有限值和超过 7200 的值拒绝。旧任务不传此字段时保持原来两个参数的完整提取调用。各输入与输出的 format/stream duration、start_time、codec 和 sample_rate 单独保存于 `input-codec-probes.json` 与 `media-manifest.json`，不把编码 padding 当作创作窗口。

## 真实 planner 与原路径

真实 `loop_worker.plan` RED：明确准备一个 BGM 后又自动排入一个旧分镜 cue（expected 0，actual 1）。088 最小 wrapper 使已有 native workspace 的隐式旧 planner 返回 0，明确请求任务仍只有一个；非 workspace 对照仍可排出旧 soundtrack cue。两个场景均 GREEN，旧内部函数取消 Worker 直接执行权限，不放宽 claim/lease/连接规则。T13 正常入口须通过明确匹配/授权动作创建新任务，旧晚回报失效仍由 T13 收口。

## 真实浏览器

用独立 agent-browser Chrome 会话、随机测试 Owner、随机库和自有 APFS 卷验证：准备页选原片 → 真实 Worker 完成 → 自动出现采用 → 采用并本地试听 → 人工 BGM 准备/采用 → 真正 iframe 连接 → live inspect/SHA/原生 flush/Owner CAS 把 source 主声保存为 -6 dB。`ui-final-project.json` 回读实际 volume 为 0.501187，不是只看输入框。

浏览器发现准备轮询被父组件重渲染反复取消；稳定 callback ref 后，相同步骤能自动恢复 completed/采用入口。已完成结果不再把 Worker 的“Completed successfully”展示为错误。

最终新夹具通过可见当前混音页面把 BGM 设为 -18 dB、闪避 14 dB；等待操作结束后刷新页面，再进入当前混音，数值仍为 -18/14。实际 native 文件 volume=0.125892541、track duckDepthDb=-14，与页面一致。Source 所选实例和 0.00–2.00 秒窗口明确显示。1280/800 宽度截图可查，800 下 document.scrollWidth=800，无横向溢出。两次早期 UI 长时夹具超时清理导致后续刷新无法连接，不当作刷新通过；最终独立刷新链另行完成并留存。

## 产物与限制

证据位于 `evidence/`：五份混音 MP4/工程、一个 source-window MP4、所选 MP3/原始分段源、独立频谱、精确媒体 SHA/大小、codec probes、真实 Worker result/attempt，以及浏览器保存和刷新文件。所有临时数据库/进程/挂载只按各自记录清理；日志保留精确 mountpoint 与 detach 结果。

没有在线 Freesound/真实 TTS 质量或正式内容生产证明；没有自动拼接其它 source ranges；没有替 T13 声称普通新入口全部就绪。Owner 可继续在 native 工程明确调整其它串行范围。


补充恢复边界：先提取 2 秒 source，再采用实测 2.376 秒 TTS（72 帧、2.4 秒原生窗）后，复用旧 source 作环境声返回明确 409；操作前后工程 SHA 相同，现有 TTS 和其他音轨不被覆盖。之后的混音组合以 Owner 明确 72 帧的源窗作为同窗输入，不放宽短源检查。证据为 `short-source-409.json`。

最后的 Owner HTTP RED/GREEN：对已混为 -18 dB / 闪避 14 dB 的 BGM 再次采用，旧实现实际重置为 -12/10。最小修复只在首次建立实例时使用准备位置和默认混音；重新采用保留当前 native timing、source-in、播放速率、volume、track/ducking、fade 和效果，仅更新受控源身份与采用引用。相同 Owner HTTP 用例 GREEN（12.3 秒），已确认字幕仍保留；最终 build → runtime:prepare → 人工采用/Freesound 真实 CLI 复验 2/2 GREEN（25.7 秒）。没有放宽短源或当前窗口校验。

本票自有 APFS 卷、随机数据库、UI/native 子进程与独立浏览器会话均已关闭；最后检查未发现 `loop-t06-volume` 挂载。未启动/停止日常服务，未 commit 其他工作树的用户改动，未 push、发布、关 Issue 或清理工作树。跨票 T08 候选显式切换与 T13 普通入口仍按 CONTRACT 另行联合验收，不能把本票 GREEN 当成父规格全部完成。
