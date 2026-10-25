> 后续状态（2026-10-25）：本报告保留先前离线准备范围。之后用户批准最多17次、费用上限2元的有限在线验收；Pexels v1路径资格通过，Freesound第2次请求返回401后停止。完整五家链路未通过，录入页面已恢复锁网。详见[有限在线验收](provider-online-acceptance.md)，[本报告当时原文](provider-offline-preparation-before-online.md)。

# 六适配器正式探针与私密录入：离线准备

2026-10-25。基线 `bca697bbc1e12626771d1283ec87a17bf85f02fe`，固定优化 worktree。

**本轮只完成正式装配、共用请求预算与离线准备，新增在线 Provider 请求为 0，实际在线资格为 0。** OpenAI 无真实 Key，继续未验收；其他五家的真实凭据也尚未收到。[验收摘要](evidence/provider-offline-preparation/verification-result.json)

## 本机私密录入

选择页面密码表单→专用 Keychain，不创建 `.env`，不让用户在聊天中发送 Key。使用本轮独立恢复库和媒体；录入配置不装配 Worker，避免录入期间自动消费任务。原默认部署指针不变。入口仍是正式 `npm start -- --deployment … --offline-test`，Owner 登录后进入“蓝图连接恢复与版本维护”下的“外部连接”。锁网提示明确显示，按钮为“仅保存凭据”，保存成功清空密码字段，不自动调用 verify；重新测试按钮不可用。其他连接选择器即使尝试验证，也由统一关闭策略拒绝发出请求。

本轮只以合成材料验证了六类真实 HTTP→Postgres→Keychain 往返，并用真实浏览器验证仅保存、清空密码与无 localStorage/sessionStorage 明文。7 条测试连接已撤销、对应秘密已移除，Owner 测试会话及浏览器认证已撤销，正式服务已停止。保留空的专用 Keychain 和已关闭策略的录入配置，未来可通过私有 `open-intake.mjs` 启动。该辅助入口只解锁本轮自建 Keychain 并启动原服务，不读取登录/系统 Keychain。[HTTP](evidence/provider-offline-preparation/http-intake-result.json)、[页面](evidence/provider-offline-preparation/browser-intake-cleared.png)、[清理](evidence/provider-offline-preparation/cleanup-keychain-result.json)

Keychain 新建时权限为0644，现有严格存储入口正确拒绝并返回503。只将本轮新建文件设为0600后，同一未应用写入意图恢复成功；没有放宽代码校验。stage-d根目录由0755收紧到0700并保留；默认 Keychain、其他搜索项与顺序保持，最终自建 Keychain不在搜索列表中。私有解锁密码、部署、DB/Owner凭据、原始请求与秘密引用都不公开。真实录入时不得开启HAR、截取密码输入过程或记录请求正文。

## 正式装配和预算

`providers-budgeted` 由正式 application 工厂创建六家探针。固定 provider/adapter/endpoint，校验响应形状；401/403为invalid，错误/无关200不授予资格。Volcengine 没有以静态返回冒充资格，本探针执行短句 SSE 合成并检查音频魔数；实际可播放任务仍另验。新 Pexels 探针与已有素材执行器共用 `/videos/search`，旧 `/v1/videos/search` 的历史探针和两次请求证据未改。

探针和 live narration/media Worker 端口必须绑定完全相同的专用 Keychain、预算目录与策略SHA；无原始fetch后门。策略由 `local:prepare-providers` 创建，**只能生成关闭状态**。本轮 `enabled:false`、币种UNCONFIRMED、金额上限0、计数0；没有价格凭据或批准摘要，不能开启收费执行。本轮 profile 没有在线 Worker，不声称在线任务或完整 Worker 通过。

请求预算是跨进程持久文件锁：发送前先持久预留次数与声明的最坏费用，锁保持到响应判定和账本落盘；崩溃不退款、不抢孤锁。HTTP失败、重定向、超时、越限和资格探针的异常响应停止后续请求；无自动重试、无跟随重定向。计数包含资格、搜索、生成和下载。限制为本轮正式端口范围，不是宿主防火墙，也不是 Provider 实际账单计量；费用预留必须先依据已核实定价设置，不能凭摘要字段保证价格正确。

8个真实子进程竞争容量3时仅3次内存传输调用；真实SIGKILL发生在预留后，第二进程不传输、预留不回退、孤锁保留。另测试关闭、策略SHA变更、越权host/port、响应字节、超时、状态错误、六类正反响应，以及探针/实际Worker端口共享同一预算。[竞争](evidence/provider-offline-preparation/budget-concurrency-final-result.json)、[进程死亡](evidence/provider-offline-preparation/budget-crash-final-result.json)

## 待确认的在线清单

下列仅为未来执行计划，**当前没有在线授权**。先填五家凭据、确认启用的模型和服务权限，再核对官方定价、币种和总费用上限，单独生成有期限的新批准策略。本轮关闭账本和旧T15已耗尽的2次账本都不能重置后复用。收费金额在未查价、未获金额授权前保持0；本轮禁止在线请求，因此没有查价或声称免费额度可用。

| 适配器 | 固定模型/输出 | 最多请求 | 构成 | 费用确认事项 |
| --- | --- | ---: | --- | --- |
| Pexels | pexels-video-v1，单个视频 | 4 | 首次资格1、搜索1、下载1、重绑后资格1 | 服务与下载条件待确认，不能把下载漏出预算 |
| Freesound | freesound-preview-v1，单个预览 | 4 | 首次资格1、搜索1、下载1、重绑后资格1 | 只验preview；账户权限、许可与费用待确认 |
| Google TTS | cmn-CN-Standard-A，zh-CN，MP3 | 3 | 首次声音目录1、短句合成1、重绑后目录1 | 合成≤10字符，按账户实际定价核上限 |
| Volcengine TTS | seed-tts-2.0 / zh_female_vv_uranus_bigtts，MP3 | 3 | 首次短句资格1、任务合成1、重绑后短句资格1 | **三次均实际合成，均按可能收费预留**；每次≤10字符 |
| Cloudflare Workers AI | @cf/black-forest-labs/flux-1-schnell，steps4，单图 | 3 | 首次目录资格1、生成1、重绑后目录1 | 额度、计费及账户权限待核对 |
| OpenAI Images | gpt-image-1，1024x1536，PNG，单图 | 0（缺Key） | 如以后有Key，再另确认资格2+生成1 | 当前禁用，未分配3次，不以其他服务代替 |

五家最多17次；总硬上限20次，其余3次不分配，不是自动重试余额。将来补齐OpenAI且另批准时才可能扩至20；当前不能宣称六家全部在线通过。顺序：五家首次资格（5）→五家独立最小任务（7，含两次搜索和两次下载）→显式重绑/资格清零与再验证（5）。计划执行器/操作者须在任一任务失败时立即停，不追加请求；生成HTTP200但产物语义错误由任务验收拒绝，不能冒称账本已自动识别全部生成内容错误；本机解码/尺寸/时长/SHA、旧结果围栏、重启与预算校对不耗Provider请求。在线执行前仍需固定任务/连接版本与隔离输出、停止其他预算使用者。

元数据响应≤256KiB、Volc资格≤2MiB、生成≤16MiB、单下载≤20MiB。元数据网络期限5000ms，合成/下载最长60000ms；这是新增请求传输限额，**没有改变测试默认5000ms或模型probe30000ms**。预算不支持大规模媒体、任意模型/正文/尺寸；未列范围仍待验收。

获取入口（官网/控制台链接，本轮遵守不新增在线请求，未登录或联网核对页面）：

- [Pexels API](https://www.pexels.com/api/)：登录后申请 API Key。
- [Freesound 开发者入口](https://freesound.org/help/developers/)：登录后申请 API 凭据，使用 API Key。
- [Cloudflare 控制台](https://dash.cloudflare.com/)：提供 Account ID 和有 Workers AI 权限的 API Token，按 `Account ID:API Token` 填写。
- [Google Cloud 凭据控制台](https://console.cloud.google.com/apis/credentials)：对应项目的 Cloud Text-to-Speech 服务和 API Key。
- [豆包语音控制台](https://console.volcengine.com/speech/app)：新版 V3 语音 API Key；旧版 AppID/AccessToken 不直接当作本适配器的 Key。

正式录入时由操作者启动已准备的隔离入口并完成本机 Owner 登录，用户只在页面填写，不通过聊天交付秘密。官网当前开户/计费要求仍须在获准查价或用户自行准备时核实。

填写材料：Pexels API Key、Freesound API Key、Cloudflare `Account ID:Workers AI API Token`、Google TTS API Key、豆包语音V3 API Key；OpenAI留空。应为已开通对应服务的凭据；本轮没有测试它们的有效性。录入后“保存成功”只代表本机保存，不能当作资格通过。

## 离线结果、失败和保留门禁

最终同范围默认5000ms全量105文件807/807；新增路径断言先红（25绿1红）再修复。前一轮806/806也保留。类型/最终构建通过，Node2通过1既有跳过；原生构建图无SDK/旧控制面，既有约587KB chunk告警保留。[原始日志](evidence/provider-offline-preparation/full-default-03.log)

保留全部本轮失败：初建tmp的EEXIST、预算测试规范路径别名、focused误纳入私有历史副本、Keychain0644导致503、Pexels精确路径红测；晚期误用不存在的typecheck命令、误读helper missing退出协议、一次遗漏历史副本排除项的全量（已仅停止该次进程树）、新测试mock参数类型错误也分别记录。更正的是驱动/类型或本轮路径，不调大超时、不删除断言、不以错误范围结果计通过。

报告更新前逐项验证旧928公开/1378私有SHA全部一致，43无关文件及根PLAN保持，活动旧报告另存原文，旧索引私有快照保留。旧随访和门禁对象不改。模型首次30秒冷启动失败、120秒诊断不算验收、错误正文高分`.838`反例、T21当时740/745、历史5秒红测、旧Pexels预算耗尽和恢复资格清零继续保留。

**只关闭本报告的离线装配/准备范围。** 五家实际在线完整链路、OpenAI缺Key、在线重绑资格、完整多能力Worker、新主机/OS冷启动/默认生产部署、任意正文错误检测、真实通知、容量/性能/切换回退等仍未验收。历史5秒稳定性、自然30分钟租约、指定环境真实WhisperX及当前主机默认入口的既有狭义结论不扩大。不提交、不推送、不进入E/F；SQL一致性建议继续暂缓。见[完整索引](evidence-index.json)。
