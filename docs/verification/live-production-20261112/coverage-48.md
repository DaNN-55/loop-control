# 48 类覆盖与证据

> 产物清理记录（2026-11-18）：本报告所链接的部分历史截图、视频、日志或导出附件已按用户要求清理；原验收事实保留，已删除附件改为文字标记。生产单、数据库、业务素材及必要测试输入未删除。


48 是操作与流程规则的分类数，不是所有输入、状态组合或供应商故障的穷举。本轮可见生产单为 A01 主链、F18K、F18S 三张；真实供应商调用用于主成片及两条实际拒绝路径，其他边界使用独立临时库中的真实 HTTP/PG/文件/SDK 夹具。没有生成48个付费成片，也没有把受控供应商响应写成在线成功。

下表按用户原48类逐项对应。第47类的跨进程旧整期执行未运行；第33类有1个明确门控浏览器例未运行。测试日志中的中途失败、定向复验、非目标跳过均保留，汇总规则见 [报告](REPORT.md)。

| # | 场景 | 证据层级 | 本轮检查与限制 | 证据 |
|---|---|---|---|---|
| 1 | 只读浏览、切步骤、关闭提示/详情 | 真人界面＋默认单测 | 切换步骤、关闭详情、刷新保留成片；导航未产生新供应商任务。 | 14-delivery-complete.png（历史附件已清理：`14-delivery-complete.png`） |
| 2 | 保存/修改的共同前置条件 | 受控真实集成 | Owner、CSRF、旧基准、篡改输入及只读范围的拒绝；实际未绕过 API 直接改任务状态。 | regressions.log（历史附件已清理：`regressions.log`） |
| 3 | 重复点击、并发写入、切换生产单 | 真人界面＋受控集成 | 外部 API 更新后旧页面提交因版本变化被拒绝，刷新恢复；回执和并发测试另验。 | regressions.log（历史附件已清理：`regressions.log`） |
| 4 | 请求未发出 / 明确被拒绝 | 真实拒绝＋受控集成 | Kling 429/1102、Seedance 404 均明确拒绝且不自动重发；未发两次恢复预算由受控故障验证。 | task-audit.json（历史附件已清理：`task-audit.json`） |
| 5 | 本机写入503/超时/断线，回执未知 | 受控真实集成 | 模拟 COMMIT 丢确认、登记前失败，真实 HTTP/PG/文件只读核对并恢复原回执。 | regressions.log（历史附件已清理：`regressions.log`） |
| 6 | 后台ready/running | 真人界面＋受控集成 | 真实视频/TTS/对齐排队完成；已失效未发送 ready 不再让生成器永久繁忙。 | invalidated-ui-green.log（历史附件已清理：`invalidated-ui-green.log`） |
| 7 | 后台failed/blocked | 真人界面＋受控集成 | 主单保留历史视频与音效失败，实际替代文件完整时仍可导出并交付。 | task-audit.json（历史附件已清理：`task-audit.json`） |
| 8 | 生成完成但尚未采用 | 真人界面＋受控集成 | 候选完成后逐个显式采用；旧失败和未采用候选不当作成片内容。 | 14-delivery-complete.png（历史附件已清理：`14-delivery-complete.png`） |
| 9 | 文件已产生但登记/发布未完成（hold） | 受控真实集成＋原文件恢复 | hold/COMMIT 故障受控恢复不再 POST；主单01/02失效结果另经正常导入登记，原失败历史保留。 | recovered-videos.json（历史附件已清理：`recovered-videos.json`） |
| 10 | 导入/填写主脚本 | 真人界面 | 完整六镜参考脚本适配 v2，按正式主脚本确认与准备入口执行。 | [01-caiyun-v2.md](01-caiyun-v2.md) |
| 11 | 脚本保存成功但制作启动失败/未知 | 默认单测 | 保存成功/start 失败或未知后不重传脚本的恢复测试；本轮未人为切断真实主单启动响应。 | default-tests.log（历史附件已清理：`default-tests.log`） |
| 12 | 修改已确认脚本/排版修订 | 受控真实集成 | 仅排版修订保留原工程；实质内容改动不能绕过 stale。 | regressions.log（历史附件已清理：`regressions.log`） |
| 13 | 保存规划模型/Harness/默认值 | 受控真实集成＋默认单测 | 冻结模型/预算及新意图选择；v2 本地准备不依赖未使用的规划服务。 | regressions.log（历史附件已清理：`regressions.log`） |
| 14 | 建立/重建分镜工程 | 真人界面＋受控集成 | 主单和两个失败单均用 v2 准备六镜；缺素材保留占位，主单补齐才进原生 Studio。 | failure-cases.json（历史附件已清理：`failure-cases.json`） |
| 15 | 上传/导入本地图片或视频 | 真人界面＋新增真实集成 | 相同引用上传复用同一版本；改成有效的新 PNG 仍失效原请求。 | material-reimport-final-green.log（历史附件已清理：`material-reimport-final-green.log`） |
| 16 | Pexels搜索/预览/导入 | 受控真实集成 | Pexels 查询、预览、导入、坏字节/URL拒绝及旧连接冻结；本轮未在线检索 Pexels。 | regressions.log（历史附件已清理：`regressions.log`） |
| 17 | 生成图片 | 受控真实集成 | 图片明确拒绝/未知、显式新请求及作为视频首帧；用户指定原图，因此主链不生成替代图片。 | regressions.log（历史附件已清理：`regressions.log`） |
| 18 | 生成视频/从图片生成视频 | 真实供应商＋受控集成 | 6 个 MiniMax 输出进入成片；Kling/Seedance 各一次真实拒绝；原 Provider ID 恢复由受控集成补验。 | task-audit.json（历史附件已清理：`task-audit.json`） |
| 19 | 采用图片/视频候选、比较时长影响 | 真人界面＋受控集成 | 六视频逐个确认采用，比较时长影响；跨镜位移经原生接口校正并保存读回。 | supplemental.log（历史附件已清理：`supplemental.log`） |
| 20 | 清除画面引用/删除镜头/重排与片段范围 | 真人剪辑＋受控集成 | 主单连续画面顺序和时长复核；删除/替换/最后镜头保护由独立夹具覆盖。 | supplemental.log（历史附件已清理：`supplemental.log`） |
| 21 | 关闭镜头口播开关 | 受控真实集成 | 停用未知口播解除当前需求，保留历史及已发送事实，刷新仍不自动生成。 | regressions.log（历史附件已清理：`regressions.log`） |
| 22 | 关闭口播详情或错误提示 | 默认单测＋真人界面 | 关闭详情只是 UI 动作，不撤销已保存内容或清掉原任务证据。 | default-tests.log（历史附件已清理：`default-tests.log`） |
| 23 | 保存模式/模型/文案/音色/语速、确认本镜 | 真人界面＋受控集成 | 真实选择火山连接、Vivi 2.0、语速1，保存并逐镜确认；旧输入变更保护由夹具补验。 | real-alignments.json（历史附件已清理：`real-alignments.json`） |
| 24 | TTS生成/失败重试 | 真实供应商＋受控集成 | 6 段火山 TTS 真实成功；未知、明确拒绝及恢复预算另有真实本机边界测试。 | regressions.log（历史附件已清理：`regressions.log`） |
| 25 | 人工录音导入/登记/加入候选 | 受控真实集成 | 人工音频登记、manual/none 不发 TTS，以及短画面时长冲突。其余12个非目标未运行。 | manual-narration.log（历史附件已清理：`manual-narration.log`） |
| 26 | 采用/恢复口播版本、撤回已采用音轨 | 真人界面＋受控集成 | 六段采用后读回 adoptedAudioTrackId；关闭后完成不自动采用/撤回行为由夹具补验。 | regressions.log（历史附件已清理：`regressions.log`） |
| 27 | 原片声音提取/切换主声/分离视频声音 | 真实本机处理＋受控集成 | 原生采用提取视频原声；成片中关闭六段原声，仅保留口播与选择的配乐音效。 | export-checks.json（历史附件已清理：`export-checks.json`） |
| 28 | 配乐/音效开关 | 受控真实集成 | 配乐/音效关闭移除当前依赖，保留 running/unknown/hold；未采用声音失败仅提醒。 | regressions.log（历史附件已清理：`regressions.log`） |
| 29 | 音乐/音效检索、上传、在线准备 | 真实 Freesound＋受控集成 | 2次配乐准备、3次音效准备：3成功/2失败，采用当前配乐和已成功音效，来源许可保留。 | task-audit.json（历史附件已清理：`task-audit.json`） |
| 30 | 试听候选/音色样音 | 真人播放＋默认单测 | 最终文件在浏览器从0播放至30.826667秒 ended=true、无媒体错误；试听生命周期另有单测。 | final-ffprobe.json（历史附件已清理：`final-ffprobe.json`） |
| 31 | 采用声音/音量/闪避/位置/移除 | 真人界面＋受控集成 | 配乐 -12dB、遇人声降低10dB、音效 -6dB、位置保存进入成片；源依赖未靠音量0伪装移除。 | export-checks.json（历史附件已清理：`export-checks.json`） |
| 32 | 关闭字幕 | 受控真实集成 | 字幕关闭保留正文及 cue，导出只取启用字幕。主片字幕保持开启。 | regressions.log（历史附件已清理：`regressions.log`） |
| 33 | 编辑/保存字幕正文、模式、安全区、手工校时 | 真实字幕结果＋受控集成 | 6条独立字幕 lane，16个声学短语；百分比/秒值及无效字段拒绝有HTTP/SDK集成。浏览器门控例未运行。 | real-alignments.json（历史附件已清理：`real-alignments.json`） |
| 34 | 请求声学对齐、采用结果、确认正文 | 真实本地 WhisperX | 六段均实际离线对齐并采用，method=local_whisperx、status=completed；最终文件确认字幕。 | real-alignments.json（历史附件已清理：`real-alignments.json`） |
| 35 | 进入/重开剪辑工作台 | 真人界面＋真实 SDK 集成 | 进入/重开原生编辑器，六画面有来源后可进入，最终已完成单只读。 | supplemental.log（历史附件已清理：`supplemental.log`） |
| 36 | 保存编辑器/保存并返回/结束剪辑 | 真人界面＋真实 SDK 集成 | 原生草稿编辑→应用→正式保存/关闭→读回及重开；未直接覆写工程文件。 | supplemental.log（历史附件已清理：`supplemental.log`） |
| 37 | 导出并技术检查 | 真实渲染 | 1080×1920、923帧，实际容器30.826667秒；6/6技术检查，黑帧0，最终SHA登记。 | export-checks.json（历史附件已清理：`export-checks.json`） |
| 38 | 记录问题、标为解决、确认成片 | 真人确认＋受控集成 | 实际确认当前成片与字幕；未解决问题/旧文件不得确认由测试验证，未伪造主单问题。 | supplemental.log（历史附件已清理：`supplemental.log`） |
| 39 | 确认后继续编辑/修改实际已用内容 | 真实 SDK 集成 | 确认后的原生内容修改使旧导出失效，需重新导出确认；主单交付后不再改。 | supplemental.log（历史附件已清理：`supplemental.log`） |
| 40 | 封面、标题、简介、标签 | 真人界面＋受控集成 | 原图封面、标题、简介、4标签实际提交，封面字节与用户原图相同；边界校验另验。 | download-verification.json（历史附件已清理：`download-verification.json`） |
| 41 | 生成交付包、失败重试、下载 | 真实交付与下载 | 打包任务完成/verified，浏览器下载ZIP；6文件CRC、MP4和封面SHA相符，重启后仍已交付。 | download-verification.json（历史附件已清理：`download-verification.json`） |
| 42 | 归档/恢复归档 | 受控真实集成 | 归档/恢复保留身份、状态、权限；未归档用户日常作品或主验收成片。 | regressions.log（历史附件已清理：`regressions.log`） |
| 43 | 当前永久删除与文件清理恢复 | 受控真实集成 | 隔离夹具实际清单删除/恢复及旧来源保护；未永久删除日常数据。 | regressions.log（历史附件已清理：`regressions.log`） |
| 44 | 回收站容量与恢复 | 受控真实集成 | 隔离回收站真实容量、恢复、FIFO和共享/在途保护；不把它写成全供应商验收。 | regressions.log（历史附件已清理：`regressions.log`） |
| 45 | 连接/密钥/模型/额度/目录 | 真实连接＋新增真实集成 | 实际验证 MiniMax/火山/Freesound/Kling/Seedance；资格缺少live回执时目录改为待重验，正向已有验证保留。 | connection-probe-green.log（历史附件已清理：`connection-probe-green.log`） |
| 46 | 自动退避、重试次数耗尽、旧版本被替代 | 真实拒绝＋受控集成 | Kling/Seedance均attempt1、max1且未重试；失效未发送ready允许新明确请求，其他付费围栏保持。 | invalidated-queue-green.log（历史附件已清理：`invalidated-queue-green.log`） |
| 47 | 旧整期自动续作的配置、暂停和恢复 | 部分：默认单测 | 默认决策/稳定授权/禁旧调度测试有覆盖；旧整期专用跨进程集成未运行，也未拿新四步流程冒充。 | default-tests.log（历史附件已清理：`default-tests.log`） |
| 48 | 受控QC合成修订、分镜结构退回、逐镜输入修订 | 受控真实 SDK 集成 | QC 合成修订、结构退回、逐镜草稿→预览→确认→冻结；HTTP/PG/文件身份及旧证据保留。 | regressions.log（历史附件已清理：`regressions.log`） |
