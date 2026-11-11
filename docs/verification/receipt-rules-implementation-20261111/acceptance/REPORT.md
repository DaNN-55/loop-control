# 48类流程独立复核

2026-11-11。任务：只读审查与独立测试，不修改产品实现；主Agent实施4/5/17/24，另一个子Agent迁移紧凑设置。全部数据库测试使用本任务随机容器与无业务数据隔离库，未调用付费Provider、未访问真实Keychain、未改变真实作品或重载日常服务。

## 结论

本轮独立保留回归未发现剩余失败。两个新协议缺口由本审查实际复现并交主Agent修复，均已独立复验通过：

1. 明确的发送标记拒绝被通用transport catch重新包装为unknown：`provider-marker.log`红1项 → `provider-marker-green.log`绿1项。
2. 新口播替代任务已completed后，旧unknown仍占据当前generationTask，导致按钮隐藏且操作受阻：`speech-projection.log`红1项 → `speech-projection-green.log`绿1项；原请求仍为started，未改写历史。

48类均已映射到当前复验或既有保留证据；“逐类有证据”不等同穷举所有状态组合，也不代替主Agent最终新协议集成、全量检查、正式迁移及服务回执。4/5/17/24的主Agent最终批次应以其最后日志为准。

## 实际执行与结果

|编号|证据|结果与范围|
|---|---|---|
|WF|[workflow-regression.log](workflow-regression.log)|4文件13/13通过：workflowRules、Retry、QueueStop、Legacy QC；真实HTTP/PG/files/Worker。|
|U|[retained-unit.log](retained-unit.log)；[主Agent旧mock修正复验](../receipt-client-retest.log)|初验12文件143条，139通过4失败；失败来自两个旧回执mock未支持新只读协议。主Agent修正后这2文件39条与客户端3条共42/42通过。未把初验写成全绿。|
|MS|[media-state-unit.log](media-state-unit.log)|6文件65/65通过：试听、样音生命周期、音频面板、任务状态与真实持久重试投影。|
|SI、CI、C、P、DI|[retained-integration.log](retained-integration.log)|6文件25通过，1字幕浏览器门控未执行：脚本修订2、字幕5、候选7、Pexels6、交付4、交付输入1。|
|LI|[lifecycle-manual.log](lifecycle-manual.log)|4通过：归档1、managed/legacy永久删除2、manual/none口播1；15非目标/门控跳过不算通过。|
|RC|[recycle-independent-final.log](recycle-independent-final.log)|回收站独立3/3通过。前两轮误用环境开关而全跳过，发现后读源码改用`LOOP_RECYCLE_ACCEPTANCE=1`，仅本最终日志计通过。|
|MARKER|[provider-marker.log](provider-marker.log)、[provider-marker-green.log](provider-marker-green.log)|独立红→绿1/1；synthetic transport，没有真实出网。主配置排除verification目录，专用config仅加载此证明。|
|PROJECTION|[speech-projection.log](speech-projection.log)、[speech-projection-green.log](speech-projection-green.log)|独立真实HTTP/PG/Worker红→绿1/1，确认新任务完成后的当前投影与旧unknown历史分离。|
|RX、RCPT、SSE|主Agent本目录下receiptRules、commandReceipt、clientCommandReceipt与speech rejection日志|新协议的最终批次由主Agent记录，不与本独立回归重复相加。|
|UI|[紧凑设置迁移报告](../../compact-connection-migration-20261111/REPORT.md)|执行Agent报告72项/8文件通过，主Agent负责最终整合和真实服务验收。|
|沿用|[前轮48矩阵](../../workflow-rules-implementation-20261111/acceptance-48.md)|只对本轮未改变的完整媒体/规划/legacy规则沿用已有实际证据；下表逐项说明代表范围。|

带PG的命令均使用`LOOP_TEST_CONTEXT_MODULE=.../receipt-rules-implementation-20261111/environment/runtime-context.mjs`；并发1。各日志首行保留实际命令与门控变量。没有使用日常runtime环境作为fixture源。

## 逐项映射

|#|场景|证据|本轮复核内容与限制|
|---|---|---|---|
|1|只读浏览、切步骤、关闭提示/详情|U、MS|浏览、详情与导航只改变视图；不撤回已保存动作。|
|2|保存/修改的共同前置条件|WF、LI、RC|当前Owner、CSRF、Origin、只读scope、当前工程与目录门槛均有真实断言。|
|3|重复点击、并发写入、切换生产单|U、WF；主Agent RCPT|重复提交、旧异步回包、原操作回读；新回执协议的旧mock已修正并复验。|
|4|请求未发出 / 明确被拒绝|MARKER；主Agent RX、SSE|发现mark-before-send明确拒绝被包装为unknown，实际红→修复→绿；SSE明确业务拒绝由主Agent另验。|
|5|本机写入503/超时/断线，回执未知|U；主Agent RCPT、RX|命令503后只读查询同意图；不把缺回执当未执行。HTTP Owner/hash/敏感投影以主Agent回执测试为最终证据。|
|6|后台ready/running|WF|ready未发送可停；running与未知保留；停用不触发新请求。|
|7|后台failed/blocked|WF|旧失败、已替换/删除/停用内容只作后台提醒，不无条件阻塞整期。|
|8|生成完成但尚未采用|WF、C|生成结果保留为候选；未采用不改原生工程。|
|9|文件已产生但登记/发布未完成（hold）|主Agent RX|已验证文件后received写失败、COMMIT拒绝/回执丢失均走原发布恢复，不再请求供应商。|
|10|导入/填写主脚本|U|正文/原因校验、草稿与保存/启动分开；不声称穷举文件格式。|
|11|脚本保存成功但制作启动失败/未知|U|保存成功后启动失败/旧回执/新脚本版本安全恢复；旧mock按新只读回执协议修正后通过。|
|12|修改已确认脚本/排版修订|SI|格式修改保留精确编辑工程；实质正文变化不能绕过stale保护。|
|13|保存规划模型/Harness/默认值|U；沿用P|规划选项保存和启动分开；冻结旧任务与新明确规划的规则保留。|
|14|建立/重建分镜工程|WF、C；沿用R1|本轮每个真实fixture均通过公开prepareWorkspace；完整重建与不足素材门槛沿用前轮R1。|
|15|上传/导入本地图片或视频|U、P|上传状态、重复操作、实际受控媒体导入与指纹保留。|
|16|Pexels搜索/预览/导入|P|Pexels搜索/预览/导入/显式采用、短素材、坏URL/字节、轮换及跨镜头记录六例。|
|17|生成图片|MARKER；主Agent RX|新的image阶段分类和unknown显式新请求由主Agent最终图片集成验收；marker明确拒绝独立绿。|
|18|生成视频/从图片生成视频|WF；沿用V、QS|已发送/未发送语义及目标删除已复验；保存Provider ID只查询原任务的完整视觉组沿用既有23例证据。|
|19|采用图片/视频候选、比较时长影响|C|时长策略、旧输入/篡改候选拒绝、真实原生保存与显式采用。|
|20|清除画面引用/删除镜头/重排与片段范围|WF、C|清除/删除目标停止未发队列；保留旧请求与当前原生结构。|
|21|关闭镜头口播开关|WF|关闭未知口播解除当前依赖，保留未知证据；重开不自动提交。|
|22|关闭口播详情或错误提示|MS|关闭详情不等同关闭内容；详情只读，未知和hold动作分开。|
|23|保存模式/模型/文案/音色/语速、确认本镜|WF、C|none/tts/manual用途、当前确认与冻结请求保留；新候选不会恢复已关闭用途。|
|24|TTS生成/失败重试|PROJECTION、WF；主Agent RX、SSE|发现并修复旧unknown优先投影导致新completed仍被隐藏阻塞；真实HTTP/PG/Worker红→绿，旧started保持。|
|25|人工录音导入/登记/加入候选|LI|真实人工口播/关闭不创建TTS；时长冲突保留可恢复提示。|
|26|采用/恢复口播版本、撤回已采用音轨|WF、C|关闭后的迟到结果只成候选；历史候选、恢复与撤回不自动重生成。|
|27|原片声音提取/切换主声/分离视频声音|WF；沿用RT、A|本轮真实提取失败重试、冻结范围与目标变化门槛复验；完整存储组沿用前轮证据。|
|28|配乐/音效开关|WF|关闭声音移除当前依赖；未发ready停止、在途未知/hold保留。|
|29|音乐/音效检索、上传、在线准备|WF、MS；沿用S|原片失败恢复、声音历史与不开启自动检索；Freesound完整候选流沿用前轮。|
|30|试听候选/音色样音|MS|试听关闭/离页释放、失败局部重试、原媒体与当前语速使用。|
|31|采用声音/音量/闪避/位置/移除|MS、WF、C|音量/位置/主声音与候选切换保留；停用音轨从导出依赖剔除。|
|32|关闭字幕|CI、WF|字幕enable与原生cue保留；导出仍按实际使用图检查。|
|33|编辑/保存字幕正文、模式、安全区、手工校时|CI、U|每镜lane、手工时序/百分比安全区、原生拖动保存/重开、字段错误局部验证。|
|34|请求声学对齐、采用结果、确认正文|CI、C|当前正文/音轨的真实alignment队列；晚到旧对齐拒绝，采用口播只使相关证据过期。|
|35|进入/重开剪辑工作台|C、WF；沿用R2|当前来源和原生编辑路径保留，停用口播不成为进入Studio的门槛。|
|36|保存编辑器/保存并返回/结束剪辑|U、C|编辑器应用/保存/登记分开；已有保存的登记恢复不再次应用编辑；旧工程不可越权完成。|
|37|导出并技术检查|WF；沿用EX|停用缺失或长尾口播仍可真实导出；重启媒体后实际字节验证继续生效。|
|38|记录问题、标为解决、确认成片|U、DI；沿用EX|问题/确认与实际当前成片绑定；关闭提示不当作解决。|
|39|确认后继续编辑/修改实际已用内容|DI；沿用EX、R2|交付绑定精确确认成片，工程变化使旧确认不适用；完整样式变化规则沿用前轮。|
|40|封面、标题、简介、标签|DI、U|封面真实内容、标签边界、标题/介绍与确认成片绑定，非法输入不入队。|
|41|生成交付包、失败重试、下载|DI|实际Worker打包、完整性、篡改/缺失、重试、下载与重启；旧导出不可完成新交付。|
|42|归档/恢复归档|LI、WF|真实归档恢复保留legacy用途、Owner/历史/CSRF边界，未启用原来关闭的制作。|
|43|当前永久删除与文件清理恢复|LI；沿用R2|真实managed/legacy精确永久删除与空账号清理、删除围栏保留；不是修改真实用户文件。|
|44|回收站容量与恢复|RC；沿用回收站报告|本轮新增真实Owner/CSRF/Origin、字节变化、容量/版本冲突复验；FIFO/共享/离线/在途保护沿用160完整报告。|
|45|连接/密钥/模型/额度/目录|UI；沿用P、RT、V|迁移Agent真实组件72项、权限/敏感读取、不可变旧版本、模型/计费分开API与浏览器布局；主Agent负责最终整合。|
|46|自动退避、重试次数耗尽、旧版本被替代|WF、MS；主Agent RX|实际available_at拒绝早claim，旧输入不可重试；本机最多2次持久恢复另由主Agent新协议PG验证。|
|47|旧整期自动续作的配置、暂停和恢复|U；沿用P|自动续作选择/暂停/授权/工作台取代legacy调度保留；未运行依赖日常命名fixture的旧整期跨进程集成。|
|48|受控QC合成修订、分镜结构退回、逐镜输入修订|WF|受控QC合成、结构退回、逐镜修订4真实HTTP/PG/files/SDK场景，本轮全部重跑。|

## 不能据此宣称的内容

- 没有真实供应商成功率、扣费金额或WhisperX识别质量证明。全部生成响应为测试替身，发送次数按受控出口核对。
- 代表集成的字幕浏览器项未启用门控；本轮并未独立重跑全部浏览器矩阵，已有UI执行Agent浏览器证据另外记录。
- 旧整期专用跨进程测试依赖日常命名fixture，未擅自运行；本轮复验稳定授权/暂停等纯决策和工作台公开流程。
- 本报告不是正式5174已重载的证明。日常部署、迁移161/162和最终版本由主Agent独立验收。
