# T15 / #121：部分实现，验收未完成

前置T14本地验收及双审查在`3ce95e7`通过。实际GitHub Issue于本轮读取；保持OPEN不作为未完成的独立判断依据。这里的未完成来自缺少真实Keychain和Worker路径验收。

## 已安全完成

`native/keychain-helper.m`是隔离D环境的候选Security.framework helper，系统clang实际编译通过。固定service为`com.loop-control.stage-d.connections.v1`，仅接受规范UUID引用和put/get/remove白名单；秘密只在受控stdin JSON和get的Worker stdout管道中传递，不接受秘密命令行参数或环境变量。限制输入64KiB、秘密16KiB；put使用SecItemAdd，重复引用不覆盖，没有SecItemUpdate、列举、ACL扩大、同步或明文文件回退。

候选源码禁用可选系统交互，锁定/拒绝、缺失、重复、未知错误返回固定代码，未把系统错误描述或秘密回显到错误日志。真实操作默认disabled，需显式`--keychain`且stdin/stdout均为FIFO或已连接AF_UNIX stream socket；普通文件/终端/网络socket拒绝。该开关是未来受控调用边界，不能替代Owner授权。默认macOS文件型Keychain的交互禁止兼容调用是系统已废弃API；保留局部编译标注，未隐瞒此兼容成本。未创建access group、entitlement、证书或永久ACL。

`node scripts/local/keychain-helper-check.mjs`编译两个二进制，只执行以`LOOP_KEYCHAIN_PROTOCOL_ONLY`编译的协议测试版本。该版本在预处理时剔除所有Security调用，`nm -u`再次断言无SecItem/SecKeychain导入。20个真实本机子进程检查通过，含合法操作、无效JSON/字段/UUID/类型/空值/大小、默认禁用、试图开启真实操作被禁用及普通文件stdin/stdout拒绝。生产候选与协议版本共享同一IPC校验，真实Node stdio管道成功。秘密只使用内存合成文本且输出不包含该文本。测试先以未实现协议返回not_implemented失败，再以实现通过。[记录](protocol.json)明确候选编译但从未执行、真实Keychain操作0、Provider调用0。构建产物和模块缓存仅在私有`.loop-control/stage-d/native`，不提交二进制。

部分交付审查发现并修复了IPC兼容问题：Node24的stdio:'pipe'由libuv socketpair实现，原候选仅S_ISFIFO会误拒绝。现在共享检查接受FIFO和经本地/对端地址、socket类型检查的已连接AF_UNIX stream，协议版本同样执行该检查，不能在安全测试中绕过边界。没有为修复执行候选或Keychain调用。

API依据：[Apple SecItemAdd](https://developer.apple.com/documentation/security/secitemadd(_:_:))、[SecItemCopyMatching](https://developer.apple.com/documentation/security/secitemcopymatching(_:_:))及本机SDK的SecItem.h/SecKeychain.h交互约束。源码/协议通过不证明真实Keychain行为通过。

## 精确阻塞与未完成

状态：**待Owner明确授权，未尝试、未被工具拒绝、没有未知结果**。遵守本轮用户限制“涉及真实Keychain/新认证权限等超出当前授权的步骤须报告具体要求”。没有读取、写入、删除、解锁或枚举用户Keychain，没有访问现有生产凭据。

下一步需要Owner允许：仅以本轮新建、无外部权限的合成秘密，在固定D service下执行候选helper的新增/解析/删除，验证不可变旧引用、轮换新引用、缺失恢复绑定；在Owner控制的独立测试Keychain或明确许可的锁定/拒绝情景中检查失败行为。任何系统认证提示、应用访问授权或Keychain选择必须另行明确处理；不得自动解锁、扩大现有条目ACL或读取生产连接。不可为测试随意锁定Owner登录Keychain。当前未创建测试Keychain。

仍未实现/验收：HTTP连接创建/轮换/撤销/验证记录到本地PG的接管、复用连接界面、蓝图版本选择解除门禁、受控Worker按引用解析及脱敏验证、导入缺失秘密重新绑定，以及实际数据库/页面/日志/备份的秘密不泄漏检查。真实Provider凭据和在线验证另需合适的显式授权与可用服务；本轮未调用。候选helper尚未接入运行中的应用，不能通过它创建可用外部连接，T14的外部配置409门禁保留。

T15三项原验收均未标完成，不以协议测试替代真实存储/轮换/Worker验证。根据实际依赖，#122直接依赖#121；#123–#129、#130（亦直接依赖#121）、#131均仍被后续链条阻塞，未跳过门禁推进。无生产切换、推送、合并、部署、关闭Issue或凭据传输。
