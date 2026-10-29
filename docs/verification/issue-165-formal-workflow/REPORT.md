# #165 正式四步实施与验证

正式入口已统一为脚本确认、素材准备与匹配、剪辑工作台、检查与交付。新生产单不再依赖旧分镜批准；原 Provider、任务与原生工程协议继续使用。契约见 [CONTRACT](CONTRACT.md)。代码基线为 `35102847`，执行树为独立 `codex/t13-formal-workflow-152`，没有修改日常工作区/数据库、原片或 SDK，没有付费调用、推送或关闭 Issue。

## 实际验证

| 边界 | 本轮结果与证据 |
| --- | --- |
| 正式新单、legacy、普通脚本 | `formal-final-green.log`：6/6。真实 Owner HTTP 新单→脚本→准备；无旧批准；新增镜头 TTS/视觉实际受控 Worker；旧未提交原生文档保存/封存读取；旧任务晚报告保留历史但不推进新阶段；普通脚本实际 CLI 失败两次、刷新保持终态、错误任务重试拒绝、明确 Owner 重试后真实产物确认。 |
| 最终整片与交付 | `logs/release-formal-recovery.log` 内 delivery 单项通过（同组合ordinary的 wire attempt预期当时失败，后由 formal-final-green.log 整文件6/6覆盖）。最终 MP4 为 1080×1920 H264/AAC，7.445333 秒、468907 字节。真实 CLI 包含五份原字节与 manifest，Owner 下载逐一校 SHA，最终 `production_completed`。 |
| 采用正文与账务 | 真实包第一镜正文来源为 `owner_adoption`，包含“这一版局部口播已明确采用。”；未采用正文不进入包。两个 local-added source/none 镜头的 baselineText 均为空。交付后未采用在途 TTS task/run completed、actual_cost_cents=1、submission received，未覆盖工程/重开状态。 |
| schema、旧 T01、目录 | `final-formal.log`：5 文件12项通过（含当时6 formal 与1 delivery）；schema3、旧原生Studio1、Owner catalog1均真实执行。之后的 ordinary retry 与最终 delivery 另列在上两行，不与此计数相加。 |
| 跨票真实回归 | 首轮 `final-cross-ticket.log`：35/37，两个失败均保留。口播13、候选7、原生镜头9、字幕3整文件通过；交付另3通过。T11新未登记库项被 T09 正确拒绝，测试改为先真实登记、保存后删除未用副本；T12首次加绑定元数据误废确认已修，旧无元数据快照实际导出确认后 selection-only 保存保持确认。最终 T11/T12 两文件5/5通过，另见 logs/final-export-delivery.log。 |
| 普通套件 | 最终159文件1055/1055通过，见 logs/final-npm-test.log。首跑1053/1054的唯一失败是旧 HTTP 数据库替身不识别新 workspace 只读 guard；仅增加“无 workspace”的响应，保留确认、权限、CSRF、无写断言。原七项导航/分页基线已通过，未恢复冗余旧标题或使用 first() 绕过选择器歧义。 |
| 构建与 Worker | build/type 与 runtime:prepare 均执行，后者校验真实源码/产物 manifest。Vite仍提示现有大 chunk；没有新增仓库依赖；UI驱动复用临时缓存tsx，未改 package/lock 依赖。普通四步原型不进入默认路由或 production chunk。 |
| 浏览器 | Chrome156与Root IAB真实 UI。1543/1280/1024/800横向 scrollWidth均等于viewport；桌面 iframe底部866、host底部867，均在953可视高度内；800保留滚动stack且底部控件实际可访问。折叠定位、增删、上传/匹配、占位、原生手动13%保存刷新、实时素材采用均有截图/观察。最终后端 fresh52353 的脚本→准备→真SDK手动13%保存→刷新重开保持13%及只读诊断已由Root通过；该tab已关闭。 |

## 可独立核对的最终产物

[evidence](evidence/) 保留最终五份文件、原始 manifest、逐次下载 SHA、项目、检查、metadata、费用/提交记录及 ffprobe。视频 SHA 为 `6a879c3a38fa920e719849293aa4d3d03c3a28a13696c2d38d31bce5189d1e3a`，最终工程 SHA 为 `7261091a5998aeddd03bce546583d8fb0eb0898a6bb58d4dbb9e9bde38b22059`。

完整临时原始证据位于 `/private/tmp/loop-152-orchestration/t13-release-full/`；较早两镜头包在 `t13-final-full/`，其中新增镜头基准缺陷是修复前实证，不能当最终包。GUI证据分别在 `root-final-ui/` 与 `t13-browser/`。测试覆写的五个旧票证据已精确转存到 `t13-cross-ticket-evidence/`，再按旧 SHA 恢复，仅恢复本轮写入文件。

## RED 与修复界限

- 真实新单最初 start/prepare 均409：去除“先有视觉/旧批准”的耦合，建立真实制作依据，不 seed 旧批准。fixture早期 prompt/创建字段/mountpoint配置错误先纠正，没有把它们计成业务 RED。
- 字幕确认原始 SQL `40001 Caption text review identity changed`：未采用候选更新旧 draft 指针，已采用音轨却仍从该指针核对。改用实际 native 来源、正文、时间窗口及 workspace evidence；未回写草稿音轨掩盖问题。
- native retimed TTS 整源对齐实际错误返回200：泛化 alignmentReady guard后完整链409通过；手工时序仍可编辑，迟到结果不 revive。
- 最终包新增 source/none baseline 曾错误取 clip.text：两个 metadata 消费点统一 resolver，真实包断言并验证空基准。
- 普通规划耗尽后刷新卡旧失败任务：明确显示终态，只在带当前失败 task ID 的 Owner 重试时创建关联的新请求。测试遵守原自动重试与零基 wire attempt，没有放宽 lease/次数或将 ready 当 failed。
- 组合回归中测试新增静图使用方式枚举错误、将自动第一次失败误认为终态、将 wire attempt误认一基的失败均保留；按实际契约修测试后重新执行，不伪称这些日志全绿。

## 证据边界

HTTP/数据库/原生保存/实际 MP4/真实 Worker CLI/Owner 下载均实际执行。Provider是受控协议样本，音频是标明测试用途的音调，不能声称真实付费服务、语音/音乐质量或 ASR准确率已验收。声学对齐为受控 timestamp artifact加真实 claim/report 围栏，没有运行真实 WhisperX识别。自动测试中的 x13来自实际原生 store修改→Owner save/restart；GUI手动属性编辑由Root IAB另验，二者分开记录。

本票没有部署或迁移日常库。最终固定提交仍由Root独立 Standards/Spec review后集成；本报告不把中途有界只读审查替代最终审查。

## 收尾状态

两个本票localhost服务49571/52353已在Root关闭tab后有序退出；自有随机数据库、APFS/媒体目录、端口和临时凭据已清理。/export串行窗口已释放。较早服务/测试记录与最终fresh后端GUI证据分开保存。普通套件与最后实际导出/交付组均读到退出0；没有用重跑计数掩盖保留的分段失败。
