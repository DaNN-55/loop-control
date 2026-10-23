# T15 / #121：接口及模拟验收完成，真实验收未完成

前置T14在`3ce95e7`通过本地验收及双审查。实际GitHub Issue已读取，保持OPEN；本票三项原验收均仍未标完成。父任务要求继续不依赖Keychain授权的实现后，新增下列代码与测试，没有执行真实Keychain、ACL、登录钥匙串状态操作或在线Provider调用。

## 已实现的边界

本地Owner会话、精确Host/Origin和CSRF保护的`GET/POST /api/local/connections`，仅create/rotate/rebind/update/revoke/verify白名单，拒绝任意字段和任意SQL。私有迁移007/008只保存操作意图、UUID绑定、验证模式/结果及资格；有限SECURITY DEFINER函数检查Owner，应用仍没有原始业务表UPDATE权限。原三张外部连接业务表、版本号、官方Provider/adapter/endpoint白名单、撤销与验证历史保留。历史`vault_secret_id`字段对新行仅含UUID；本地解析只读明确的`connection_bindings`，不会回退Vault或环境变量。

ADR0007要求区分本次结果与持久资格。008独立记录qualification：live verified授予、invalid清除、retryable保留原值但不授予新资格；显式rebind清除，轮换不传递，撤销/非当前版本拒绝。每次探测仍追加保留，模拟不授予资格。未更改已应用007的内容；旧apply实现撤回应用执行权，由新有限包装确保重绑清资格。

秘密字段在进入SQL前移除，没有保存明文或秘密哈希。先持久化不含秘密的意图和随机引用，再调用存储端口，最后同事务提交业务版本与回执；helper已写入但PG提交中断时，原意图/引用可重试，不能新建第二份秘密。不可变put遇到重复引用只接受完全相同的字节；更改秘密应新建轮换版本。已完成意图返回`replayed:true`，不再执行秘密写入；即使新输入不同也明确提示“原操作已经完成，未再次写入”，不能当成更新成功。元数据不同复用key409。未完成意图通过Owner目录显示，需重输原材料显式重试。

客户端sessionStorage只保存在**不含secret的元数据hash**下的随机操作UUID，不保存明文或低熵秘密指纹；认证草稿只在password输入框/内存。创建/验证/轮换/选择从原账号蓝图相应能力入口进行；同页“蓝图连接恢复与版本维护”内联区复用`ConnectionWorkspace`处理缺失绑定、撤销与原操作重试，没有新增独立连接页面。共享动作hook保留保存成功/读取失败区分。导入的历史verified字段不等于本机可用：无绑定、模拟或端口未启用时，DTO明确显示不可用/待真实验证，保留历史状态字段，数据库原记录不改。

蓝图引用保存只在服务端同时配置keychain存储和live验证端口时开放；按稳定顺序锁定连接，再以新语句核对Owner/当前/未撤销版本、原业务verified与本地live验证证据，并实际解析该精确引用检查可用性。解析字节不进入SQL或HTTP。默认门禁仍409；模拟验证不会开放选择。既有SQL触发器继续校验Provider/adapter匹配。此真实分支只有边界mock测试，未假装已跑真实Keychain验收。

`worker/localConnection.ts`提供受控Worker接口：HTTP验证传入不可变版本，Worker端口自行解析秘密；Provider返回文本/异常永不直接进入HTTP、数据库或日志，只记录固定状态和固定脱敏详情。生产凭据解析要求当前/未撤销/同Owner账号关系、真实keychain绑定和live验证证据，精确版本失败即阻塞，不换用最新版本或其他后端。当前测试只调用此Worker模块接口，**不是完整任务Worker CLI/Provider子进程闭环**，后者仍属T16及后续真实验证。

## 原生 helper 与默认禁用

`native/keychain-helper.m`候选用系统clang实际编译；固定service为`com.loop-control.stage-d.connections.v1`，仅规范UUID及put/get/remove。秘密经受控stdin JSON，get只回受控Worker stdout；不接受秘密参数或环境变量，无列举、更新覆盖、ACL扩大、同步或明文回退。输入64KiB/秘密16KiB有界。共享IPC检查接受FIFO和已连接AF_UNIX stream，拒绝普通文件/终端/网络socket。

候选现只允许编译时固定的`.loop-control/stage-d/keychain/t15-synthetic.keychain-db`：必须显式路径、规范路径一致，add指定该Keychain，查询/删除限定其搜索列表，**不再使用默认登录Keychain或默认搜索列表**。无创建/锁定/解锁/ACL修改实现。可选系统交互被禁止，锁定/拒绝/缺失等仅固定代码。文件型Keychain的兼容调用是系统已废弃API，局部编译标注保留，真实兼容性尚未验证。

`configuredKeychainStore`是部署层候选适配器：默认approved=false不读文件也不启动进程；未来明确启用时检查私有路径/所有者/权限/非symlink和helper SHA，再用无继承凭据环境、有限管道/超时调用。重复秘密只在内存恒时比对，不持久化哈希。**运行中的D应用没有启用此适配器**，只实例化disabled秘密/验证端口；HTTP或UI不能更改该配置。配置布尔值不是人类授权的替代。

## 验证及失败保留

- [真实HTTP/PG + 模拟端口](http-simulated.json)：8并发创建仅1连接/1秘密写入；6并发轮换仅1新版本，旧引用保持；已完成key重放不覆盖；存储成功后模拟中断，原意图恢复无重复；仅本轮新版本删除绑定模拟恢复缺失后显式重绑；撤销拒绝，不自动切换；恶意Provider异常文本脱敏；模拟结果只在私有证据记outcome，公共验证仍retryable、ready=false，蓝图409，生产Worker拒绝。匿名401、CSRF403、跨Owner命令404、无会员创建403，且拒绝前不写秘密。真实PG dump含public及local_identity，HTTP、dump及应用日志均不含本轮合成秘密。此处存储为内存Map，Provider为纯函数，没有真实Keychain/Provider调用或费用。
- [本机协议](protocol.json)：候选编译但从未执行；只执行`LOOP_KEYCHAIN_PROTOCOL_ONLY`预处理剔除Security代码的版本，nm断言无SecItem/SecKeychain导入。20项真实子进程协议/IPC检查通过。先以未实现协议返回not_implemented失败，再实现通过；后续审查修复Node socketpair误拒绝，共享检查现被协议测试覆盖。构建/模块缓存只在私有运行目录，不提交二进制。
- 单元测试：原组件网络故障、连接页password草稿及仅UUID存储；native适配器的子进程/文件系统边界均mock，覆盖默认禁用、参数/环境无秘密、不可变引用、stderr丢弃及hash拒绝；蓝图门禁的真实分支仅用边界mock验证，不创建live验证数据库夹具。
- [SQL资格状态转换](qualification-sql.json)：仅`loop_empty`内一笔最终ROLLBACK的事务、元数据UUID夹具，9断言验证verified→retryable保留、invalid清除、无资格retryable不授予、rebind清除、rotation不传递、revoke拒绝。只走SQL函数的live-mode状态机分支，不存在实际秘密/认证/Provider，不提交任何live验证夹具，D应用从不连接该库。最初夹具缺既有Owner membership，被原create_account前置条件拒绝；补齐回滚夹具，没有放宽业务检查。
- [完整回归](checks.txt)及[历史保留](original-history.json)记录最终结果。完整回归采用默认5000ms，排除运行目录保存的历史源码副本；Node既有原生n8n校验跳过保留。初次定向测试builtin mock缺default导出而失败，修正mock边界后通过，未改弱运行代码或断言。新增会员校验曾使跨Owner动作提前403，调整先核验资源归属后重测404，未放宽预期。失败留下的本轮合成连接/版本仅作诊断，原C记录未改。

API依据：[Apple SecItemAdd](https://developer.apple.com/documentation/security/secitemadd(_:_:))、[SecItemCopyMatching](https://developer.apple.com/documentation/security/secitemcopymatching(_:_:))及本机SDK的显式Keychain/IPC约束。源码、编译、mock、模拟Provider通过均不证明真实Keychain行为或在线服务通过。

接口初审另发现并修复：模拟outcome曾公开为verified，现HTTP与公共业务记录均retryable，真实模拟outcome只进私有证据；首个接口提交遗漏已测试的蓝图门禁文件，`7c6439c`补齐并重新核验提交状态；临时retryable错误撤销已验证资格，以008及上述SQL回归修复。没有将这些初审缺陷隐藏为最终通过。

## 精确待确认及未完成

[可供Owner确认的独立测试钥匙串方案](keychain-test-proposal.md)明确目标路径、service、仅本轮可重建合成条目、测试库专属锁定/解锁/删除范围、不动登录库或已有ACL、可能的测试库搜索列表项副作用及零Provider费用。**状态为待Owner明确授权、未尝试，没有工具拒绝或未知结果。**没有创建/打开/读取/写入/删除/解锁/锁定任何真实Keychain，没有系统认证提示或新持久权限。

仍须获准并实测真实Keychain存取、锁定/拒绝、不可变版本轮换、撤销和恢复缺失；通过真实helper的HTTP→Worker脱敏及日志/备份检查；显式可用Provider的真实验证及真实蓝图版本选择。完整任务Worker迁移未完成；D完整备份恢复含本地私有绑定/意图的接管仍是T24，当前dump仅验证没有合成秘密，不冒称完整恢复。T15三项原验收仍未完成；#122–#131不越过依赖门禁。

C历史五秒不稳定、3条既有advisor WARN、n8n原生校验既有跳过、真人审批链和在线Provider未测保留。无生产切换、推送、合并、部署、关闭Issue或凭据传输。
