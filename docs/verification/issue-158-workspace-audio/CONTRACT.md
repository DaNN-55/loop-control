# T06 音频准备与实际混音

## 权威与身份

`workspace.audio.preparations` 仅保存准备任务、人工材料、检索词、来源许可、输入指纹和采用引用。`workspace.audio.mix` 每次从当前原生工程读取，不以口播准备表单或旧 draft 模式声称当前正在使用的主声。

`src/workspaceAudio.ts` 提供受限公共接口 `applyWorkspaceAudioMix(project, edit)`、`readWorkspaceAudioMix(project, shots)`、`resolveWorkspaceMainVoice(project, shotId)`。主声 canonical 为 `workspace-narration-shot-${shotId}` 或 `workspace-source-shot-${shotId}`，环境声为 `workspace-ambience-shot-${shotId}`。同 shot 的视觉实例全部静音；并行槽不会把完整口播复制多次。明确 none 删除主声和环境声，保留视觉实例中的稳定 `{workspaceId,shotId,voiceMode}` 标记，字幕 resolver 不会回退到旧 draft 音轨。

source 由 Owner 指定实际原生视频实例。真实 `extract_embedded_audio / ffmpeg_extract_audio` 任务只提取 Owner 所选实例的源窗口，沿原 Worker lease、attempt output、result 和 `audio_tracks` 登记，native 从该裁切音轨的零入点建立唯一 source 主声。请求冻结原片 SHA/大小、源入点、原生 fps、窗口和速度；采用前再次比较当前实例。旧任务未提供可选 `start_seconds` 时仍完整提取原片。准备不会伪造旧 `video_ready` 或准备素材。多画面构图使用明确选中的原片音轨，不将多个槽声音叠加。切回 TTS 可从本期已采用的原生素材池恢复完整 canonical 主声；时长与 shot 聚合窗口不符时明确阻塞。

`loopControlAudio` 携带稳定 ID、类型、锚点/偏移；裁切音轨资产另保存原视频 asset ID、SHA、源入点帧数和 fps 的来源关系，不携带自定义路径。实际 `src/sourceAssetId` 仍由 native doc 持有，来源由 `resolveWorkspaceSource` 验证本期登记、SHA、大小和文件。TTS 默认原片静音，显式环境声限 -60～-12 dB。

## Owner 命令

所有入口使用现有 Owner/session、Origin/CSRF、字段白名单、幂等回执、Episode 可见性及 `lockProductionWorkspace` revision CAS：

| 命令 | 字段与行为 |
| --- | --- |
| `prepareWorkspaceAudio` | `kind=bgm/sfx/source`；Freesound 用 `query,description,durationSeconds`，人工用 `materialRevisionId`，source 用 `sourceItemId,shotId?`；SFX 用 `anchor=absolute/shot,offsetSeconds,shotId?`。`preparationId,retry=true` 明确重试失败任务。 |
| `refreshWorkspaceAudio` | 读取持久任务与结果，不自动改工程。 |
| `adoptWorkspaceAudio` | `preparationId`；核对实际文件、source 原片身份和当前原生窗口后采用；打开 Studio 时拒绝闭态添加。 |
| `mixWorkspaceAudio` | `edit`；闭态受限混音，同一 native content CAS 中递增已有 `native_edit_revision`，防止迟到首次组装覆盖 Owner 选择。 |

整期 BGM canonical 为 `workspace-bgm`，从 0 覆盖当前实际画面长度；素材不足明确阻塞，不自动循环。SFX 为 `workspace-sfx-${preparationId}`，绝对位置不随镜头移动，shot 锚点携带 shotId，复用 T10 结构操作随镜头移动/删除。音量作用于 item，闪避 UI 为 0～30 dB 深度，写入专用轨 `role=follower,audioRouting.duckDepthDb=-depth`；0 表示关闭闪避。主声专用轨 `role=anchor`。字幕轨、正文、cues 与混音独立保留。

剪辑内 Host 使用限制 action `apply-audio-mix`，沿 T10 `inspect → live revision/SHA → applyDoc → native flush → Owner save/CAS`。准备页面没有另一份混音时间线；当前混音面板读取 live native doc。

## 执行与来源

外部仅复用已注册 `freesound/freesound_preview/freesound-preview-v1` 检索/预览 API；不声明 AI 作曲。当前蓝图连接、模型、预算、max_attempts、allowed_tools 原样冻结；需要当前 script production 授权与执行指纹、readiness 和已验证连接。关闭/人工路径不创建外部任务；Freesound 结果沿现有 `mediaSource` 保存来源页、作者、许可与 previewUrl，并提供本地登记音频试听。Worker 提交前验证真实 lease、当前准备输入和制作授权；过时结果可保留历史，不能自动采用。

迁移为 `088-workspace-audio.sql`，依赖 084、086、087；验收 fixture union 另含 089、092、093、094。它不保存当前编辑时间线。

## 相关消费者

- T07：`resolveWorkspaceMainVoice` 返回 actual `coverage=full/partial/none`、`alignmentReady` 和真实主声窗口。仅覆盖部分 shot、非零音轨入点、裁切/变速或旧整片轨无法匹配使用窗时，整段声学对齐返回明确 409；独立字幕仍可手工校时，但不把它登记成完整语音对齐证据。实际可听 source 优先，其次 canonical TTS；explicit none 不回退 draft。实际 source 不能冒用旧 TTS 正文核对 follow_tts；须切换独立字幕或恢复 TTS。
- T08：口播 target 缺失时保持显式恢复阻塞，不悄悄将 source/none 切回 TTS；已存在的 canonical 音轨采用继续保留 item gain/track。
- T12：使用实际 native audio item/sourceAssetId 查询登记 audio_tracks；没有来源正文的 source 维持 unknown，不将 mutable narration draft 作为已用正文。

实际 Worker、原生渲染、频谱与浏览器证据见 REPORT。受控正弦波只能证明路由、时序、增益和闪避，不能证明语音或音乐质量。

## T13 普通入口接续

088 在真实 `loop_worker.plan` seam 上排除已有 `production_workspaces` 的隐式旧媒体规划；内部旧函数私有，非工作空间 Episode 的原路径保留。新四步流程的提前生成必须由明确匹配/授权动作创建任务，不能靠打开页面或启动旧 planner。旧任务晚回报的业务失效由 T13 另行收口。

source 不自动拼接其他串行范围。Owner 选择一个实际 video instance，状态与 UI 展示该实例、源入点和使用窗口；并行画面不复制主声。`coverage=partial` 不是整 shot 原声覆盖，`alignmentReady=false` 不是声学对齐可用。整段 TTS、SFX 和原生手工音频编辑继续按实际文档处理。

## T08 显式口播主声采用接点

当前 T06 没有 inactive TTS item：source/none 移除 canonical TTS，但保留 native pool 资产。T08 的准备动作不得改变路由；明确「采用为口播主声」才可创建或恢复 `workspace-narration-shot-${shotId}`、解除 muted 并同步唯一实际主声。

当前公共 mixer 调用为 `applyWorkspaceAudioMix(project,{kind:'voice',workspaceId,shotId,visualItemIds,mode:'tts',gainDb,ambienceGainDb:null,narrationAssetId:'audio-track-'+registeredTrackId})`。候选资产必须先经现有受控来源注册进入 native.assets。helper 保留 BGM/SFX/字幕，删除同 shot source/ambience，视觉实例全部静音；caption voice identity 随实际音轨改变而过期。已有主声 gain 应明确沿用，不能把一个仍 muted 的 TTS 仅换源后声称采用成功。

T06 初次恢复的整窗检查保持严格。T08 另负责 Owner 明确 keep-target 时的短候选采用：音轨使用实际长度、画面长度保留，不循环、不加速、不冒充全窗覆盖。该跨票合同需 T08 合入后的真实场景联验，T06 不将它记为本票已完成的候选能力。

BGM/SFX 重新采用仅替换受控源身份，保留当前 native timing、volume、track role/ducking 与效果；准备页位置只用于首次实例，不回写成另一份时间线。
