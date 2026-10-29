# T09 画面候选契约

基于 integration `2fa83c1a`。原生 project 是唯一可编辑时间线；091 仅保存不可变请求、来源与提交结果，复用 090 的 prepare/采用/拒绝记录，不另建时间线。

## Owner 命令

所有工作空间命令沿用 Owner/CSRF、episode 归属、expectedRevision、历史只读和当前脚本/分镜边界。重试同样先限定当前锁定 workspaceId/episodeId 下的候选；即使同一 Owner，另一生产单的 candidateId 也返回 404，原任务不变。嵌入操作还必须等真实 SDK `writable === true`；字段缺失不表示可写。

| 命令 | 输入与结果 |
| --- | --- |
| `registerWorkspaceVisualCandidate` | targetItemId、同一期 materialRevisionId、video/still/pan-zoom、图片明确时长；只建候选，不改工程 |
| `requestWorkspaceVisualCandidate` | targetItemId、同一期首帧、动作、none 的明确画面时长、现有 Provider 费用预留；只排已有视频任务 |
| `prepareWorkspaceVisualCandidate` | candidateId、keep-target/use-candidate、acceptTimelineImpact、motionPolicy；返回 090 adoptionId/edit |
| `adoptWorkspaceVisualCandidate` | adoptionId；live 模式先 native apply→flush→Owner save，再 nativeApplied 确认 |
| `rejectWorkspaceVisualCandidate` | 保留当前画面，记录拒绝 |
| `retryWorkspaceVisualCandidate` | 只恢复已保存 Provider ID 的原任务；未知提交不能重试或换 prompt 绕过 |
| `prepareWorkspaceVisualPool` | 已登记 materialRevisionId；校验原文件，live 返回可逆映射的运行时 URL，不重开 Studio |

目标必须是 bindings 中唯一原生实例；支持 video/image 互换及绑定的 text 占位。源是独立 candidate pool asset，不重链原 master；同源其它实例、声音、字幕、轨道、构图和手工关键帧保留。静帧、本地推拉无 Provider 调用。替换相关推拉关键帧必须显式选择 replace-motion，且 prepare 冻结构图防止迟到覆盖人工运动。

keep-target 对短 video 返回 409；不循环、不变速。use-candidate 必须明确接受空隙/覆盖，其它片段不移动；DTO 展示实际候选长度、当前长度、差值和同轨潜在覆盖项。图片可按当前窗口静态延长。

## 实际主声与 Provider

`resolveWorkspaceMainVoice` 是当前可听主声入口。source/tts 取真实已登记音轨、srcIn、使用窗口、playbackRate、partial coverage；none 才用明确画面时长。旧 muted TTS 不作为依据。当前窗口超过 Provider 上限时 409；不足最短时明确显示服务时长与实际使用时长，向上取整到既有服务允许整数，生成只产生候选，不改变当前初稿。

视觉身份只包含主声 route、源 SHA/路径、窗口、速率等创作输入；同一主声独立 gain/BGM 改动不使视觉候选失效。T08 音频采用的含 gain 路由指纹保持原样。

沿用既有 Provider/adapter/model/connection/首帧构造、授权和预算 RPC。091 的私有 workspace wrapper 仅把旧 approved-board 入口的阶段限制替换为已授权、当前 owned workspace lineage；原 RPC 和 Episode stage 不改。任务 snapshot 在 INSERT 时冻结主声身份；不补写或篡改不可变任务输入。

提交前 fenced Worker 从真实 project/file 复核指定目标和实际主声。native_edit_revision 仅作审计，不以全工程 epoch 阻止无关 B 编辑；已有 Provider ID 可继续轮询历史结果。未知 submit family 按 workspace/target 锁住，换 prompt 或其它镜头编辑不能重新收费；已有 ID 恢复仍只 poll。历史结果保留，采用继续严格检查当前输入。

## 上传与原生入口

Owner `importMaterial` → 本期 immutable material → verified live copy/reverseSources → `add-registered-source` → native flush/Owner save。未使用的不可用素材不会阻塞打开；采用、保存新增源仍做原归属与 SHA 校验。

所有 SDK 修改仅由 `scripts/openchatcut-embedded.mjs` 对嵌入实例作 adapter transform，和 `openchatcut-embed-client.mjs` 的已验证父窗口/channel/project/SDK ownership 协议生效；没有修改已安装 SDK 文件、依赖或独立 Studio 行为。

- toolbar/键盘启动上传及 drop：importAssetToPool 的同名覆盖确认之前、importMedia 的 placeholder 之前重定向。
- folder：DirectoryImportActions 的目录选择器之前重定向到实际可用的 Owner 上传；不以 CSS 隐藏入口。
- mobile/ingest：创建原生 asset 之前重定向。
- audio 类型重定向混音中的 Owner MP3 登记，再使用 T06 的本地声音准备入口，不伪装视觉素材。

## T13 接点

`resolveWorkspaceVisualLineage(c,row,shotId)` 是后续唯一扩展点。当前只接受现有当前合法分镜中的 a_roll/b_roll；不得临时改 Episode stage 或造 approval。

新增 `added-*` 镜头：本地素材登记/候选/采用返回 200；AI 生成明确 409。T13 负责新增镜头版本化生成 lineage 与正常默认入口；本票不宣称完成新单端到端。
