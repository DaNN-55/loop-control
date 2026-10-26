# 接续 04：新媒体完成与字幕启动阻塞

本次生产单：7ac796f5-ca57-4fbe-8e7c-fbcf87db3dbc。主程序运行，阶段 storyboard_approved；两个内容审核已按 Owner 回复经原界面写入。视觉和分镜实际 Codex 任务各一次完成，两个逻辑规划额度已用完。

## 实际完成

- 3 路 Pexels 搜索与下载、3 段豆包配音均成功，无 Provider 失败或重试。加上两家资格验证，独立账本共 11/11 请求，预留 ¥0.46，实际账单未知。四家豁免未调用。
- 音色 zh_female_vv_uranus_bigtts、zh-CN、rate=1；三段 18.672、19.104、19.920 秒，总计 57.696 秒。未试听触发新 TTS。
- 通过原界面正常上传本单新生成的视频并标注 B-roll，保存为 b-shot-001/002/003。三路材料与对应新 artifact 的字节指纹一致。该绑定是 Agent 操作正常界面完成的人工步骤，不能写成自动绑定。
- 原界面为各镜头选取对应原片，裁切为各自完整配音时长，保存全屏/cover/中央构图、硬切、TTS 主声音、无 BGM/SFX。三个本地 FFmpeg 任务各一次成功。原下载任务由正常流程标记 superseded，原产物未删除。
- source 为两路 360×640、一路 540×960；1080×1920 输出属于放大，不能称源素材为原生高清。

## 本次任务执行

时间为 UTC，换算上海时间加 8 小时。耗时来自 task_runs 的实际 started_at/completed_at；tasks.claimed_at 在结束后写回，不用它计算时长。

| 阶段 / 镜头 | Task ID | Provider / adapter | 开始 UTC | 结束 UTC | 秒 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| generate_narration / shot-2 | 12a6fe77-3f0f-4234-bee2-3811c8c04e80 | volcengine_tts / volcengine_tts | 2026-10-26T06:31:17.36253+00:00 | 2026-10-26T06:31:21.411539+00:00 | 4.049 | completed / attempt 1 |
| generate_b_roll / shot-3 | 2189bc91-599f-4f6e-98e6-d75ee6f71d8f | pexels / pexels_video | 2026-10-26T06:27:16.438284+00:00 | 2026-10-26T06:27:23.40956+00:00 | 6.971 | superseded / attempt 1 |
| align_shot_captions / shot-1 | 242a0d71-4c6f-484e-b253-cd130013743c | whisperx / whisperx_local | — | — | — | ready / attempt 0 |
| align_shot_captions / shot-2 | 296c7345-ef5b-4e3a-a047-51166afe740f | whisperx / whisperx_local | — | — | — | ready / attempt 0 |
| generate_b_roll / shot-1 | 3f5b79bf-01cc-4442-8f6c-82e9d278c28c | ffmpeg / ffmpeg_trim_video | 2026-10-26T06:42:01.624734+00:00 | 2026-10-26T06:42:03.953215+00:00 | 2.329 | completed / attempt 1 |
| generate_narration / shot-3 | 4af14d72-e7af-4b5f-8416-b4f0c9079634 | volcengine_tts / volcengine_tts | 2026-10-26T06:31:49.499396+00:00 | 2026-10-26T06:31:53.348529+00:00 | 3.849 | completed / attempt 1 |
| draft_storyboard / 整单 | 4d088f95-34b9-4057-a3eb-1d3bd051943d | codex / codex | 2026-10-26T06:21:37.370648+00:00 | 2026-10-26T06:23:17.397357+00:00 | 100.027 | completed / attempt 1 |
| generate_b_roll / shot-2 | 4ddb2f66-d9f9-47f4-a251-cee346e1b3ba | pexels / pexels_video | 2026-10-26T06:27:23.496106+00:00 | 2026-10-26T06:27:41.891957+00:00 | 18.395 | superseded / attempt 1 |
| generate_b_roll / shot-1 | 51e67543-33fc-4a9a-a53a-fddc8f596557 | pexels / pexels_video | 2026-10-26T06:27:41.993631+00:00 | 2026-10-26T06:27:58.755882+00:00 | 16.762 | superseded / attempt 1 |
| generate_narration / shot-1 | 57a27d39-4150-4725-a60c-c7c8f166ec66 | volcengine_tts / volcengine_tts | 2026-10-26T06:29:53.804368+00:00 | 2026-10-26T06:29:57.543732+00:00 | 3.739 | completed / attempt 1 |
| generate_b_roll / shot-2 | 852e0b06-450c-4b52-966a-a119f5dcf8f4 | ffmpeg / ffmpeg_trim_video | 2026-10-26T06:42:45.846797+00:00 | 2026-10-26T06:42:49.487419+00:00 | 3.641 | completed / attempt 1 |
| generate_b_roll / shot-3 | a32d1d98-543a-45e0-956e-346d665aaaf7 | ffmpeg / ffmpeg_trim_video | 2026-10-26T06:43:32.177697+00:00 | 2026-10-26T06:43:33.945107+00:00 | 1.768 | completed / attempt 1 |
| prepare_visual_brief / 整单 | d0565687-4d4f-4e11-ac6e-2b268bb512dd | codex / codex | 2026-10-26T06:01:45.780129+00:00 | 2026-10-26T06:03:26.887355+00:00 | 101.107 | completed / attempt 1 |
| align_shot_captions / shot-3 | fa41330a-9a62-41e8-801a-b39899c7d15a | whisperx / whisperx_local | — | — | — | ready / attempt 0 |

每项冻结输入、蓝图版本、输出路径/大小/SHA、运行记录见 run02-clips-final.json。新下载与音轨的流参数见 run02-media-probe.json；完整解码结果另存 run02-media-full-decode.json。

## 当前阻塞与最小候选补丁（未应用）

真实运行已复现：三条 align_shot_captions 均 ready/attempt0，当前生产单 alignment_enabled=false，因此 input_task_allowed=false，Worker 正确拒绝领取。UI 却把 ready 也等同 running，导致两个现有对齐启动按钮一直禁用。正常 requestAlignment 命令本来就会校验本地执行器并开启当前单对齐许可，但按钮无法触发它。证据：alignment-gate-blocker-run02.json。

候选只改 src/episodes/EpisodeProduction.tsx 的一行状态判断：只有 running 禁止重复启动，ready 显示已保存的 waiting 状态并允许经现有正常按钮启动。补丁为 alignment-ready-resume-proposed.patch；尚未修改产品源码或数据库。现有 API 仍验证 Owner/审核包/音轨文件，复用同一 ready 任务 ID；不手改 gate、不新增任务、不跳过正文确认。需要 Owner 授权本次新增的 UI 修复，原两处规划修复授权不扩大解释。

获准后：补充 ready/running 的界面交互回归，执行针对性检查与类型检查；正常构建核对指纹后，从原界面点击本地对齐，验证原任务被领取、输入/输出 SHA、实际执行器与重试次数。若发现新阻塞，保留证据，不扩额或绕过。

## 人工内容决定与未执行

尚未替 Owner 点击音频正文确认、同步预览确认或 QC。正文已逐字对照配音请求，但没有冒称已实际听取。实际听审与后续视频审核仍需要 Owner。Studio/审核渲染/最终渲染/QC/发布包及生产后重启尚未执行。历史账号按 Owner 指定顺序在新视频完成后接入。原项目全量迁移仍无完整源清单证据。

Keychain 第二次本机系统解锁成功后，实际读取两个凭据成功；现存库未重建，密码未输出。已读取设置 useLockInterval=0、lockOnSleep=1，不能把 lockInterval=300 当作已启用的五分钟超时。保存密码自动解锁失败与重锁原因尚未解决。

## 后续授权与实际回验

Owner 明确回复「授权最小修复并继续」后已应用候选一行修复，新增 ready/running 真实组件交互回归：未修时1失败8通过，修后9通过；类型、前端构建与正常 runtime:prepare 通过，assertPreparedRuntime 确认源码/输出匹配。原界面点击本地 WhisperX 后，原三条任务各1次完成，分别20.705/15.057/20.913秒；本地 Python 由 sandbox-exec deny network* 限制。Provider账本仍11，无新模型任务。

shot-1和shot-3对齐状态completed；shot-2任务执行完成但对齐内容为needs_review，首句「再沿着水流向前。」候选0.060～1.121秒，置信度0.714714低于0.72。未降低阈值，未回填为通过；保留原候选等待Owner时序检查。对齐成功不等于字幕正文正确。

Owner 已播放确认三段当前音频正文（call_51464e6349f044738d0947115117acbf「三段正文均确认」），已按实际音轨SHA及对齐输入身份从原界面逐镜头保存正文确认。该批准不覆盖时序、第三路画面偏差和最终QC。

抽帧发现第三路新下载素材是俯拍河谷，未见已批准分镜要求的层叠山脊。此为本次真实素材偏差，不能沿用历史成片取舍自动豁免，也不擅自消耗新Provider额度替换。

## 同步预览等待 Owner

三段同步预览各一次完成，均为1080×1920/30fps/H.264 + AAC；实际容器时长分别18.709333、19.157333、19.989333秒。自动QC报告通过，文件大小/SHA与DB一致，三个预览完整解码通过。抽查有效cue帧字幕可见；shot-1在8秒恰位于两个cue间隙，9秒帧正常显示「叶片轻轻摇动，」，未把字幕间隙误判为缺字幕。

Owner确认第二段候选时序后，已从正常「调整时序」入口保存11条现有cue，method=manual。原自动低置信度JSON未改写；人工保存变更对齐身份，已依据同一音频正文批准重新记录当前身份。未把人工接续写成自动通过。

已展示三个真实同步视频，等待 Owner 对三段同步及第三镜头河谷素材偏差作出明确决定；尚未替 Owner 点击「确认并处理下一镜头」。Studio、整期审核视频、最终QC与发布包仍未执行。Provider仍11/11、预留¥0.46，模型仍2个逻辑任务；无新外部请求。

检查点秘密扫描：当前部署/Owner初始化/日常Keychain保存密码共4个实际值，在151个证据文件中无命中。尝试使用当前两家真实Provider凭据扫描时，本地Keychain get均denied，随后只读status确认unlocked=false；本轮Provider秘密扫描未完成，不能把0个已读取值的空扫描记为通过。没有尝试猜密码、修改锁策略或重绑，后续本地预览不需要Provider；正常重启恢复仍需重新核验。

浏览器检查点：当前原界面生产单URL仍为本单，已加载3个1080×1920同步视频，当前resource记录仅127.0.0.1:5174。第二次规划/素材期间的进程元数据另存network-observation-storyboard-media-run02.json，观察到git helper参数域名github.com；大部分模型网络经过既有本机代理，全部HTTPS目标与TLS正文尚不能由TCP元数据确定，未将其声称为已完全审计。

诊断脚本修正记录：一次只读查询误用不存在的tasks.last_error列，改用既有capture快照；一次直接Node加载TS Keychain模块因.js相对导入失败，改从正常worker构建产物读取。均不改变业务状态、不触发Provider、保留终端失败。
