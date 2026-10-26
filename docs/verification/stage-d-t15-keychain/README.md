# T15 真实 Keychain 补验（2026-10-24）

**本次授权范围的 Keychain 与 HTTP→受控 Worker 模块缺口可以关闭；T15 整票仍不能关闭。** 在线 Provider 未授权、调用数为0，真实连接资格及真实蓝图版本选择仍待单独验收；完整任务 Worker CLI 属后续范围，未开始 T16。

**默认 5 秒门禁历史失败及根因未解决的限制继续保留。** 本次默认5000ms通过不能覆盖[B/T06四轮失败](../stage-c-t06-followup/README.md)。本次修复的是 native helper 的 IPC 拒绝问题，未诊断或修复历史审核台测试时序根因。

Owner已认可本次补验结论，并另行授权将本次修复、报告、回归日志和证据索引归档到当前分支的本地提交。下文“无暂存/提交、HEAD/index未变”描述补验执行完成时点；本次归档仅纳入本票相关文件，不纳入规划文件或含凭据的私有证据，不推送、合并、操作生产或开始T16。实际归档提交ID以本文件的Git历史为准，验收基线仍为`d081077`。

## 授权与隔离

Owner明确允许按既有方案创建专用测试钥匙串、使用可重建合成秘密，验证存取、锁定/拒绝、轮换、撤销、缺失重绑及HTTP→Worker脱敏；不动登录/系统库或已有ACL，在线Provider另行确认，不提交/推送/合并/开始T16。

- 工作树：`/Users/dan/.codex/worktrees/local-first-optimization/loop-control`；分支`codex/local-first-stage-a`；起止HEAD均为`d0810773468070ef8348ed9d8cf3d49c774ac7e9`。
- 读取了实际GitHub [#121](https://github.com/DaNN-55/loop-control/issues/121)、CONTEXT、ADR0007/0008及[原方案](../stage-d-t15/keychain-test-proposal.md)。GitHub状态未改。
- 仅原生D容器`loop-control-stage-d-postgres`、库`loop_imported`、DB55472、固定镜像/标签及指定Colima socket，应用最小角色`loop_app`。未新建或覆盖数据库，未运行迁移或恢复旧库。
- 钥匙串仅为`.loop-control/stage-d/keychain/t15-synthetic.keychain-db`，固定service `com.loop-control.stage-d.connections.v1`；创建前不存在，所有条目均本轮随机UUID/合成秘密。
- 现有D服务PID8140、127.0.0.1:55177及其offline guard未变。HTTP验收另起127.0.0.1临时端口，使用相同handler/真实PG与真实Keychain适配器；结束关闭验收服务并退出其会话。没有改动默认Vite配置或启用现有D服务的原生端口。
- 验收进程只允许D数据库及自身HTTP端口，出站HTTP和其他socket拒绝；Provider为纯函数模拟，无在线请求或费用。这不是整机物理断网验收。

## 实测结果

| 场景 | 结果与证据 |
| --- | --- |
| 真实helper及部署适配器存取 | 真实Security API写入/读取一致；同引用同秘密幂等，不同秘密冲突，原值保持。[native-result](native-result.json) |
| 锁定与拒绝 | 仅锁定专用库，状态确认locked；helper返回`locked_or_denied`，异步适配器返回`denied`；用测试库密码显式解锁后恢复读取。覆盖锁定导致的拒绝，未制造或更改ACL拒绝条件 |
| 删除及缺失 | 本轮普通条目删除后真实读取`missing`；HTTP中删除本轮秘密条目后验证不进入Provider，显式重绑恢复同引用 |
| 真实HTTP/PG并发 | 8个同意图create仅1连接；6个同意图rotate仅1新版本；新旧秘密分别保持。[HTTP结果](http-result.json)、[事件记录](events.jsonl) |
| 轮换、撤销与Worker边界 | 轮换后的旧版本解析被拒绝；撤销当前版本后verify为503且不调用Provider；不自动换最新版本 |
| 两类缺失重绑 | 真实Keychain条目缺失保留DB引用后重绑；删除本轮新版本DB binding模拟导入缺失后重新录入，产生新的明确引用。没有操作历史连接 |
| HTTP→受控Worker脱敏 | 实际`LocalConnections`→`verifyLocalConnection`→`configuredKeychainStore`→真实helper/Keychain→模拟Provider；模拟回调收到匹配的真实解析字节。恶意异常带入秘密后，HTTP/DB仅保留固定脱敏结果。Worker模块同进程运行；不是完整任务Worker CLI或Provider子进程验收 |
| 就绪门禁 | 模拟公开结果仍为`retryable`/`ready:false`；`externalReady:false`，生产Worker解析拒绝、蓝图保存409。没有创建live验证夹具或授予真实资格 |
| 身份边界 | 匿名401、缺CSRF403；沿用原Owner会话及账号隔离逻辑。不同Owner的完整测试沿用原T15证据，本轮未重复宣称实测 |
| 秘密不泄漏 | 本轮HTTP合成秘密逐一扫描响应、public+local_identity真实dump、验收事件及D应用日志，均未出现；秘密及测试库密码不经参数/环境变量。含秘密的管道输入/解析输出只在内存，不落日志。未采集HAR |

“缺失重绑”证明本票受控恢复路径，不代表包含本地身份、队列、全部连接私有元数据及媒体的完整新环境恢复；该闭环仍属T24。浏览器秘密输入/提交本轮未重跑，未修改UI；原T15浏览器只读证据不能升级为真实连接提交证据。

## 发现并修复的 IPC 缺陷

原20项协议检查使用同步`spawnSync`；真实部署适配器使用异步`spawn`。异步父进程`stdin.end`后对端可能先关闭，macOS `getpeername`返回EINVAL，但完整请求仍在输入缓冲区；原检查误报`pipe_required`，适配器对外表现为`unavailable`。这不是Keychain权限不足。

- 最小复现使用不含Keychain调用的同一协议版本：[修复前](ipc-red.txt)同步validated、异步pipe_required；[修复后](ipc-green.txt)两者均validated。
- [只读fd探针](ipc-metadata.txt)及[准确关闭时序探针](ipc-debug-before.json)、[errno/peek探针](ipc-debug-errno.json)保留实际结果；诊断源及二进制只留私有目录，未进入业务helper。
- 最小修复保留AF_UNIX/SOCK_STREAM约束；仅stdin的已关闭对端允许`recv(MSG_PEEK|MSG_DONTWAIT)`确认有缓冲数据或EOF；stdout仍必须有真实本地域对端。未连接/监听socket不能因此通过，不接受网络socket、datagram或普通文件。
- [最终协议记录](protocol-result.json)为26项：原20项、3项真实异步管道、未连接AF_UNIX/datagram/真实连通loopback TCP三项拒绝。[首次修复失败](protocol-ipc-red.txt)仅处理ENOTCONN，实际Darwin为EINVAL，保留后调整；[最终通过](protocol-green.txt)。协议步骤自身不执行Security代码，其`candidateExecuted:false`与`realKeychainOperations:0`仅描述该步骤；随后真实native/HTTP步骤已执行候选。

本轮修改`native/keychain-helper.m`与协议检查脚本，增加测试专用控制器/验收驱动；没有新增依赖、修改业务SQL、默认端口、ACL或原有冻结/资格语义。实际控制器只提供固定专用库的create/status/lock/unlock/delete及只读搜索列表快照；没有设置默认库、重写搜索列表或ACL的API。

## 保留失败与清理

首轮适配器unavailable及上述同步/异步分歧保留在事件和最小复现中。诊断helper创建的本轮条目由原helper删除时返回unavailable；未修改ACL或批准提示，最终仅通过Security API删除本轮从无到有的整个专用库。随后以修复后的helper新建专用库完成正式验收，不借用诊断条目冒充通过。

首轮清理脚本误用`parseInt('0o755',8)`得到0，导致D私有目录临时EACCES；已恢复原权限、改用`Number`并保留事件记录。最终清理成功。该工具错误不影响生产、既有Keychain或业务数据。

[清理结果](cleanup.json)及[收尾边界](boundaries.json)：专用库和测试密码文件已删除，原默认库标识及完整搜索列表/顺序与开工完全一致。没有出现系统认证提示，没有创建持久授权或修改已有ACL。D私有目录权限恢复开工值0755，测试产生的零字节Security锁文件保留在私有诊断目录；秘密库已不存在。合成连接/版本/意图保留便于诊断，当前版本已撤销，旧版本非current且不可解析；没有删除历史业务记录。

根`PLAN.md`原有内容的SHA256、Git index字节及HEAD均未变；无暂存、提交、推送、合并、部署或生产操作。

## 回归与证据索引

- [应用回归](application-final.txt)：默认5000ms、90文件726项通过；无超时覆盖。日志为stdout后接stderr，各流原字节保留，未伪造时序交织；既有React `act`提示保留。
- [应用类型](application-types.txt)、[local类型](local-types.txt)：退出0。
- [Node回归](node-final.txt)：2通过、1既有n8n原生校验跳过，未将跳过计为通过。
- [原始历史](original-history.json)：C归档38表20,379行逐条仍存在；本轮新增合成连接等另存。未覆盖原T14/T15历史审计指针或旧归档日志。
- 没有SQL变更，未重复SQL全量回归/advisor；原3条advisor WARN保留。在线Provider、真人审批链、完整任务Worker CLI、整机断网及T24完整恢复均未执行。
- [证据索引](evidence-index.json)记录公开证据、源码与私有原始诊断文件的SHA256/字节/性质。私有dump含身份摘要和会话元数据，不复制为公开文件；测试密码已删除，不保存其原值或指纹。原T15及C补验原始证据未改写。

复现入口为`scripts/local/keychain-real-acceptance.mjs native|http|cleanup`及`scripts/local/keychain-helper-check.mjs <私有证据路径>`。本轮状态目录已完成，**不要直接重跑native或盲目重编译仍有条目的helper**；新的真实验收必须先建立新的独占私有运行记录、重新确认专用路径不存在及环境身份。控制器源码不等于未来任意Keychain操作授权。

API范围依据为本机macOS SDK `SecKeychain.h`及Apple的[创建](https://developer.apple.com/documentation/security/seckeychaincreate(_:_:_:_:_:_:))、[删除](https://developer.apple.com/documentation/security/seckeychaindelete(_:))说明；删除仅针对本轮新建专用库，未调用全局默认库/搜索列表设置函数。
