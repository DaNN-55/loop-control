# T15 Pexels 在线补验（2026-10-24）

**本次批准的 Pexels 在线 Provider、真实 live 资格、真实蓝图版本选择三项缺口可以关闭。** 有效 Key 由 Owner 在隔离 Chrome 密码框私下录入；共发出 **2/2 次**固定在线 GET，分别得到 200 和 401。没有追加请求、自动重试、重定向、视频下载或生成。预计 Provider 费用 US$0，未读取账单。

**默认 5 秒门禁历史失败及根因未解决的限制继续保留。** 本轮默认 5000ms 回归通过，不覆盖 [B/T06 四轮失败](../stage-c-t06-followup/README.md)，也不证明该历史时序问题已修复。本次结果限于 Pexels 代表路径；其他 Provider、完整任务 Worker CLI、T24 完整恢复、真人审批链及生产部署未验收。未开始 T16，未关闭 GitHub Issue 或宣称 D 阶段全部完成。

Owner 已认可本次补验结论，并授权将本次实现、报告、回归日志和证据索引提交到当前分支。下文“起止 HEAD 不变、未提交、无暂存改动”及原始收尾 JSON 描述补验执行完成时点；本次本地归档仅纳入本票相关文件，不纳入无关规划文件、私有 dump、凭据或 HAR，不操作生产、不推送或合并、不开始 T16。归档提交 ID 以本文件的 Git 历史为准，验收基线仍为 `0f86d22`。

## 授权、实现和环境

Owner 明确批准最多两次在线请求、预计 US$0；仅使用私下输入的非生产测试 Key，不读取生产凭据。此前 [真实 Keychain 补验](../stage-d-t15-keychain/README.md)的存取、锁定拒绝、缺失重绑及 IPC 修复证据仍保留，本轮补足其余在线路径。

- 工作树 `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支 `codex/local-first-stage-a`，起止 HEAD `0f86d22ff26e7831c4570fe2f9eb59551eca1fc4`。
- 沿用原生 D 容器 `loop-control-stage-d-postgres`、固定镜像和隔离标签、库 `loop_imported`、DB55472、指定 Colima socket；应用角色仍为 `loop_app`，未增 SQL 权限或迁移。
- 原 D 服务 PID8140 / 55177 的 offline guard 与默认 disabled 端口保持不变。验收服务另用 `127.0.0.1:55178`，显式注入真实 Keychain 和 Pexels probe，使用同一 handler、HTTP 会话/CSRF、配置命令、PG 事务和 Worker 凭据解析模块。验收目录只展示本轮新账号/连接的真实数据，其他账号行过滤；未以 mock 数据替代本轮结果。
- 浏览器为独立 headed Google Chrome 会话 `t15-pexels-live-437166911c13`，仅允许本机域名；使用原连接面板与蓝图表单。录入期间不运行 DOM value/React 状态读取、截图或 HAR；提交后表单清空才采集证据。
- 专用 Keychain 路径 `.loop-control/stage-d/keychain/t15-synthetic.keychain-db`，service `com.loop-control.stage-d.connections.v1`；创建前不存在，只有本轮两个 UUID 条目。helper 沿用已验收二进制，SHA 未变；不改登录/系统库、已有 ACL、默认库或其他搜索项。

新增 `src/local-app/pexelsLiveProbe.ts`：只接受 `pexels/pexels_video` 及官方 Endpoint，固定 GET `https://api.pexels.com/v1/videos/search?query=nature&per_page=1`。Key 只经内存 Authorization header 使用；绝对截止 5000ms、响应上限 256KiB、`agent:false`，无重试或重定向。200 必须符合一页一条视频元数据结构才记 verified；401 记 invalid；其他状态、异常、结构不符记 retryable。正文、响应错误文本和秘密不进入事件、HTTP 或 SQL。

验收驱动 `scripts/local/pexels-live-acceptance.mjs` 在网络 I/O 前持久记账，文件锁串行保护，positive/negative 各只放行一次；每次结束进入 hold，全局最多两次，非预期结果停止。`LocalCatalogApp.tsx` 改为按部署端口能力展示提示，保留“本地生产前检查尚未接管”，没有把 externalReady 当成生产就绪。没有改变默认启动配置、资格/冻结规则、SQL、依赖或超时门槛。

## 实测链条

| 场景 | 实际结果与证据 |
| --- | --- |
| 真人秘密提交 → 真实 Provider | Owner 点击一次“保存并测试”；11:22:37–39（UTC+8）第1次请求 HTTP200、3119字节，验证视频ID10395606，`mode:live / outcome:verified / ready:true`。[事件原文](events.jsonl)、[提交后空密码框及已验证状态](connection-live-verified.png) |
| 持久资格 → 原蓝图页面保存 | 页面启用 B-roll，选择 external / Pexels / pexels_video / pexels-video-v1 / b-roll-v1 / max_attempts=1，引用版本 `54a49f01-5c96-4b8e-86d6-b6ad128d50ef`。确认保存 HTTP200；真实 policy 只含版本UUID，资格表 qualified=true；实际 `resolveLocalWorkerCredential` 解析精确版本成功。[保存后审计](audit-positive-before-restart.json) |
| 保存后重启与真实刷新 | 关闭并重启本轮验收 Node 服务，Chrome reload 后 B-roll 已配置、显示当前 v1 已验证，模型/预设/尝试次数保持；DB 引用及 Worker 解析保持，预算仍1。[刷新页面](blueprint-after-restart.txt)、[对话框原文](blueprint-selection-after-restart.txt)、[截图](blueprint-after-restart.png)、[重启后审计](audit-positive-after-restart.json) |
| 可重试故障不撤销已有资格 | 切换本地网络策略至 fault，原页面点一次“重新测试”；预算拒绝发网，返回 retryable/ready:false，但 qualified=true，页面明确保留上次资格，Worker 仍能解析。[UI](network-fault-ui.txt)、[审计](audit-local-fault.json)。这是本地网络策略故障注入，不冒称真实 Pexels 故障 |
| 轮换后真实认证拒绝 | 通过原 HTTP 命令将本轮连接轮换成随机合成无效 Key；11:31:15–17 第2次固定 GET 得 HTTP401、64字节，v2 `77c390c3-2bf3-4302-8c62-fa71ee136ff4` 为 live/invalid/ready:false、qualified=false。[HTTP结果](negative-http.json)、[资格/引用审计](audit-negative.json) |
| 不回退、不自动迁移 | v1 已非 current，Worker 按旧精确版本解析被拒绝；保留旧页面表单提交，真实配置 HTTP409，显示“连接版本未绑定、已变化或已撤销”。原 policy 仍指向 v1，未静默改为 v2。刷新页面显示当前 v2 认证失败；该显示不构成持久化改绑。[拒绝页面](stale-blueprint-rejected.txt)、[截图](stale-blueprint-rejected.png)、[刷新](rotation-after-reload.txt)、[截图](rotation-after-reload.png) |
| HTTP → Worker 脱敏 | 实际 LocalConnections → verifyLocalConnection → Keychain helper → HTTPS probe；成功后实际生产凭据解析函数解析匹配的秘密字节。HTTP 出口逐响应内存扫描；public+local_identity dump、事件、日志、浏览器证据和源码扫描未发现两个 Provider Key 原值。[扫描](credential-scan.json)。秘密及其指纹均不落证据 |

Worker 为实际受控模块同进程调用，不是完整任务 Worker CLI 或生成任务执行。没有创建 Episode、task、task_run 或媒体产物，也未用 SQL 人工插入 live 成功结果。Pexels Key 本身是否在 Provider 后台撤销不在本轮范围，未操作 Provider 账号设置。

## 失败、调整及边界

1. 探针单测首轮 builtin mock 缺 default 导出；下一轮异常 mock 未限定一次，影响后续用例。保留 [首轮](unit-initial.txt)、[第二轮](unit-final.txt)，修正 mock 后 [11项通过](unit-second.txt)，未放宽业务断言。
2. 第一版验收目录过滤掉全部 Prompt Harness，原蓝图表单因此拒绝保存，未写入 DB。[首次阻塞](blueprint-save.txt)、[刷新未写入](blueprint-after-reload.txt)。修正隔离驱动为按本轮账号过滤真实 Harness，并登记本轮合成 Harness 后，经页面选择保存。没有放宽既有必填规则，Harness 未执行。
3. 审计脚本直接读受保护版本表被最小角色 42501 拒绝，改用已有 `list_external_connection_versions`；不扩大授权。首次 audit-failed 与后续成功均保留在事件中。
4. 首次服务重启时专用库 status 为 locked，native 读返回 denied；用本轮专用密码显式解锁后恢复，未修改锁定配置或 ACL。[状态](restart-keychain-state.json)、[服务原日志](server.log)。不能声称服务可自动绕过锁定。
5. 浏览器 wait-text 用在 textarea 内容上等待超时；随后依据实际 snapshot 核对完整加载、对话框、持久值和 DB 审计，未把该等待超时算作产品失败或通过。部分即时 snapshot 早于异步刷新；正式证据使用后续加载完成的记录。
6. 首轮全量回归用了只含工具路径的环境，3个 suite 因缺少 Supabase 测试客户端配置而无法收集、719项通过，[原日志](initial-environment-application-final.txt)及[退出码](initial-environment-regression-results.json)保留。改用既有 `cleanEnvironment(verifiedSource())` 隔离测试配置；未访问生产、改测试或增加超时。

## 回归、历史和清理

- [最终应用回归](application-final.txt)：默认5000ms，91文件737项通过；既有 React act 提示原样保留。[应用类型](application-types.txt)、[local类型](local-types.txt)退出0；空文件表示无诊断，命令及退出码见[回归清单](regression-results.json)。[Node](node-final.txt)为2通过、1既有 n8n 原生校验跳过。
- [历史逐行检查](original-history.json)：原 C 归档38表20,379行仍逐条存在，保留旧 v2 JSON/libc 排序指纹差异的历史解释；本轮新增测试账号、Harness、连接版本、验证记录独立保留。无 SQL 变更，未重复全量迁移/advisor；原3条 advisor WARN 保留。
- [HTTP清理](fixture-cleanup-http.json)：清除本轮蓝图 b_roll 引用、撤销两个测试版本、归档新测试账号；[清理后审计](audit-after-cleanup.json)及[Worker拒绝](credential-scan.json)确认不能继续使用。qualified 历史行可以保留true，但 revoked/current 的有效门禁拒绝，不能等同仍可生产使用。
- [钥匙串清理](keychain-cleanup.json)：专用库和测试密码文件删除，默认库和搜索列表全量/顺序与开工快照完全一致，目录权限恢复0755；没有删除历史连接记录或撤销 Provider 后台 Key。
- [收尾](boundaries.json)：55178关闭、独立 Chrome关闭、测试会话注销；现有55177/PID8140/offline guard未变。根 PLAN SHA、HEAD不变，index无暂存改动。未提交、推送、合并、操作生产或开始T16。

## 原始证据与接续

[证据索引](evidence-index.json)列出公开证据、源码和私有原始文件的 SHA256/字节/性质。私有运行目录 `.loop-control/stage-d/state/t15-pexels-live-20261024` 保留原始失败、快照及 dump；dump 含本地身份摘要/会话元数据，不复制入文档。未采集 HAR、原始 Authorization 或秘密请求体；测试密码和钥匙串按方案删除，不保留秘密指纹。原 Keychain/C 证据和无关规划文件未改写。

归档时核对114条证据指纹及暂存文件字节，源码与已验收版本一致，未重跑在线请求。原始测试日志中的空行和源码摘录尾随空格按原字节保留，因此全量 `git diff --check` 会提示这些日志的空白；排除原始日志后检查通过，未为消除提示而改写证据。

本轮驱动和状态属于已完成、预算已用尽的独占运行，**不要直接重跑 prepare、重置预算或重新录入 Key**。默认 D 服务仍未启用在线端口。后续如扩大 Provider/调用范围或接管完整 Worker，需按后续票范围单独推进；本轮没有这些操作授权。

Provider范围依据为 [Pexels API 文档](https://www.pexels.com/api/documentation/)及[免费 API 说明](https://help.pexels.com/hc/en-us/articles/47677890260761-Is-the-Pexels-API-free-to-use)。本轮两次请求的实际状态由本地事件/资格证据证明，免费说明不代表已查询个人账单。
