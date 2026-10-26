# T18 本地镜头口播与音轨复用（2026-10-24）

T18 已接管本期 TTS 设置、确认文本、镜头口播生成、同配置复用和显式失败重试。两条已有 Google/火山路径均通过实际 HTTP、原生 PostgreSQL、真实 Worker CLI、MP3 文件和 ffprobe 的受控离线验证；浏览器已操作设置/文本/生成并刷新查看音轨。本轮在线请求为 **0**，音频是本地生成的1.2秒测试提示音，不是真实 Provider 语音。

**默认5秒门禁历史失败及根因未解决；默认部署、在线生成、其他Provider和完整多能力Worker尚未验收的限制全部保留。** [T17中间一轮通过日志覆盖的说明](../stage-d-t17/README.md)继续有效；T18使用唯一编号保存原始日志，没有覆盖该历史说明，也不把本轮回归解释为修复 [B/T06历史问题](../stage-c-t06-followup/README.md)。未提交、推送、合并或操作生产，未实施T19/T20。

Owner 已认可本次 T18 受控离线本地验收，并授权将实现、报告、回归日志和证据索引提交到当前分支。下文及原始证据中的“未提交、无暂存、HEAD 不变”描述验收收尾时点；本次归档只纳入 T18 精确范围，不纳入根 PLAN、无关规划或含凭据的私有证据。全部验收限制、模拟资格、SecretStore 替身和 T17 中间日志覆盖说明均保留，不推送、合并、操作生产或开始 T19。归档提交 ID 以本文件 Git 历史为准，验收基线仍为 `d06b2a5`。

## 票单与边界

核对本地已发布 [T18/#124](https://github.com/DaNN-55/loop-control/issues/124)票单和Issue缓存，不联网刷新状态。依赖T17已认可，基线为其提交 `d06b2a5f1b0fb571c53ac36485d8d6fac5e22c46`；工作树 `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支 `codex/local-first-stage-a`。根PLAN、无关规划及旧验收报告不改。

沿用D原生PG固定容器/镜像/标签、55472、loop_imported/loop_empty、独立app/Worker最小角色和现有专用APFS媒体卷。仅创建本轮两个合成账号、两个连接及其测试Episode（包括失败样本），验收HTTP端口55181；使用原handler、session/Origin/CSRF、事务、队列和CLI。主进程与子进程网络guard只允许本机55472，Chrome仅允许本机域名。没有创建默认native-worker.json或读取生产凭据；T15 Pexels预算保持2/2，专用测试Keychain仍不存在。

**本轮资格是SQL预置夹具元数据，SecretStore是部署专用替身，不是真实Keychain，也没有Google/火山live认证。** 原SQL要求已验证连接才能冻结任务，因此仅在本轮新UUID中预置相应资格/绑定/验证记录，并以CONTROLLED名称和专用审计事件标记；没有放宽产品资格门禁。记录中的live字段是测试前置数据，不能作为联网证据。替身只返回可重建合成秘密；HTTP、DB和公开日志不含原值。结束后已撤销这两条版本，实际生成命令对旧冻结引用返回409，不留可继续使用的模拟资格。

## 验收标准与实现

| 要求 | 本次实现与证据 |
| --- | --- |
| 覆盖已有Google/火山路径，按本地连接版本取秘密，不增加Provider | 原mediaProviders与executeControlledMediaTask生成请求/解析响应；native输入队列仅显式放行generate_narration。Worker按task/attempt/lease围栏取精确版本元数据，验证Owner绑定、current/未撤销/Provider/Adapter/资格及官方Endpoint，再经SecretStore取秘密，没有env/最新版本/Vault回退。[HTTP](http-result.json)、[角色与故障](boundary-result.json)、[撤销](revocation-result.json) |
| 确认文本、冻结、同配置复用、失败重试和进度 | 本地命令复用原TTS设置、9参数文本草稿、声音覆盖和字幕契约SQL；同一事务保存。原配置hash冻结文本/声音/语速/语言/连接版本；同配置复用完成任务和旧音轨；显式retry新任务、新路径，旧失败记录保留。生成中与就绪在原页面实际显示。[HTTP](http-result.json)、[生成中](browser-generating-01.txt)、[浏览器任务](browser-google-task-01.json) |
| 音轨/实际时长/来源可查询，模拟与在线分别报告 | 真实MP3经过ffprobe验证1.2秒，实际文件SHA/字节数与索引一致，cookie GET返回相同字节；audio_tracks连接source_task/source_artifact/source_review_package。浏览器本地audio.readyState=4、duration=1.2，刷新后仍在。受控结果附native_narration_mode，不证明在线语音质量。[播放器元数据](browser-audio-metadata-01.json)、[刷新审计](browser-final-audit-01.json)、[可用截图](browser-volc-audio-ready-03.png)、[提示音样本](controlled-tone.mp3) |

主要源码：

- `014-narration.sql`：默认false的narration_enabled；同一allowlist控制领取/恢复/回写。新增fenced input_task_connection，只向持有当前租约的Worker返回符合冻结版本的秘密引用元数据，Owner不能直接调用，Worker不能保存Owner设置。
- `015-narration-retry.sql`：修复实测的旧唯一索引与显式重试冲突。普通任务保留原键唯一性，仅显式native_tts_retry_id增加历史维度与文件后缀；私有函数最小复用原generate_shot_tts逻辑，原public函数/历史Supabase迁移不改。没有通过提高max_attempts或放宽超时来通过。
- `episodeCommands.ts` / `LocalEpisodeDetail.tsx`：接管saveTtsSettings/saveTtsDraft/generateTts，验证Owner/当前审核包/实际分镜文件，保存必要文本和字幕契约。复用完成任务前再验证实际MP3，缺失或损坏409并回滚恢复动作；未接管的原声/画面/同步/Studio路径继续拒绝。保存设置、草稿及生成进度接入原界面。
- `narrationWorker.ts` / `localWorkerCli.ts` / `localWorkerService.ts` / `workerDatabase.ts`：仅部署配置可选择controlled或未来live端口；凭据只在Worker内存，官方Provider逻辑复用，Provider错误原文不进入结果；真实音频探测与安全写入。启动和领取前验证新元数据函数权限，失配503，不先写业务。

## 实测链条

[HTTP结果](http-result.json)对Google和火山各验证2次同键生成→1任务、冻结文本/声音/版本、生成中进度、真实音轨与文件、同配置复用不再调用响应替身、受控失败后不显式retry仍返回旧失败任务、显式retry产生新任务及独立文件、切回原文本恢复旧音轨。旧音轨/产物一直保留。

[边界](boundary-result.json)覆盖：损坏已完成MP3后复用409且草稿整行回滚；非法语速400、旧审核包409、未接管source音频400、未知secret字段400；跨Owner命令/文件404；Owner不能取Worker连接元数据；Worker不能保存Owner设置；失效租约不能读秘密元数据且task行不变。[权限故障](readiness-result.json)实际仅撤销input_task_connection EXECUTE，启动及generate均503、任务数和草稿未变、预检v2的worker分类正确，finally恢复授权。

独立headed Chrome在Google样本选择B声音和1.1语速，确认新文本、保存草稿并生成；原页面显示生成中→口播已就绪，冻结任务和DB保持B/1.10，播放器读取1.2秒。火山样本保存新文本后生成并刷新，保留火山声音、就绪状态、音轨/来源/时长。[Google刷新](browser-google-reload-01.txt)、[火山刷新](browser-volc-reload-01.txt)、[审计](browser-final-audit-01.json)。本期设置的独立即时试听路径未接管；这里验证的是生成后的实际音轨播放器。没有执行后续视觉素材或字幕对齐。

原有TTS完成触发器会登记align_shot_captions待处理任务；保留原语义，native allowlist没有领取该类型，没有运行WhisperX或T20。界面中对齐待处理/对齐中不代表已完成对齐。本轮仅认可T18受控链路。

结束后经原HTTP连接撤销命令撤销两条预置版本，再调用生成：均409、无版本回退、草稿不变。[撤销结果](revocation-result.json)。历史qualified/live夹具记录可保留，但revoked门禁已拒绝实际使用；这些行不是Provider验证证明。

## 失败、调整和原始证据

1. 首次local类型检查对unknown command缺少收窄，修正后通过；[失败](local-types-01.txt)。没有改测试或类型约束。
2. 第一次准备账号时原领域事务在Owner membership前插入蓝图，拒绝携带外部引用的初始policy。事务回滚，改为原UI顺序：先创建账号，再更新蓝图；复用已创建的本轮合成连接，不放宽校验。[首次](prepare-01.txt)、[第二次](prepare-02.txt)。
3. Google首轮成功与复用后，显式失败重试遇旧唯一索引23505，HTTP409；新增前向015后，两Provider原步骤通过。[首轮](http-01.txt)、[第二轮](http-02.txt)。失败任务及其尝试未删除。
4. 原Provider错误可能回显内容；本地执行器统一错误文案。受控火山故障刻意在响应message里放合成秘密，实际DB/HTTP/公开证据扫描无匹配，不发布原错误正文。
5. 浏览器切到后台时document.hidden=true，初次轮询未加载；激活标签后正常，未把未加载状态算通过。两张元素截图空白，DOM/可见性检查后改为整视口截图，只有已实际查看的[03截图](browser-volc-audio-ready-03.png)作为可用视觉证据；空白原图私有保留。AX把1.1显示为float32近似值，DOM input.value实为1.1、DB为1.10，未修改业务数据来消除工具显示差异。
6. 两轴复查指出新凭据函数执行权限漏入readiness，补齐并实际撤权验证503，原类型/构建与全部回归再核对。原始日志都用编号保存；T17的中间日志覆盖说明继续保留，未改写旧报告。

## 回归、历史与接续

默认5000ms最终应用回归94文件、740项通过；Node2通过、1既有skip；类型、Worker/编排预构建、本地前端构建通过。[回归清单](regression-results-01.json)、[应用](application-final-01.txt)、[Node](node-final-01.txt)、[类型](application-types-final-01.txt)、[本地类型](local-types-final-01.txt)、[前端构建](frontend-build-final-01.txt)、[预构建](runtime-05.txt)。没有新增依赖、Provider或超时门槛。

[T18前历史](pre-t18-history.json)38表21,836行逐条保留，包含此前已验证的C/D数据与T16/T17样本。原生迁移014/015两库摘要一致、新definer固定search_path且PUBLIC不能执行；[原生安全](native-security.json)。没有重跑云端advisor，原3条WARN保留。

[两轴复查](review.md)、[收尾](boundaries.json)、[脱敏扫描](credential-scan.json)、[证据索引](evidence-index.json)记录最终范围。验收服务与Chrome已关闭，专用媒体卷、测试音频和本轮合成历史保留。凭据、raw server日志、完整身份dump、含租约的snapshot-private不公开，不采集HAR或秘密指纹。

默认部署、Google/火山真实在线生成与live资格、T18真实Keychain端到端、其他Provider和完整多能力Worker未验收，T15既有Keychain/Pexels结论不被本轮扩大。默认5秒门禁历史失败及根因未解决、T17中间日志覆盖说明继续保留。未提交/推送/合并/生产或开始T19；自动登记的后续对齐队列不构成T20实施或验收。
