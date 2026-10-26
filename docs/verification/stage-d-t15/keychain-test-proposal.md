# 待确认的真实 Keychain 测试方案（尚未执行）

建议只使用**专门隔离的文件型测试钥匙串**，不使用默认登录钥匙串。目标路径为本工作树私有运行目录`.loop-control/stage-d/keychain/t15-synthetic.keychain-db`，service固定`com.loop-control.stage-d.connections.v1`，account仅本轮随机UUID。仅随机生成、无任何外部服务权限、可重建的合成秘密；不读取或迁移已有条目、生产API Key或其他凭据。

需确认的范围：创建/打开这个新测试库；新增、按精确service+UUID解析、删除本轮合成条目；仅锁定/解锁该测试库以验证拒绝。**只删除本轮新建、可重建的合成UUID条目**。若库由本轮自动新建且获准清理，可最后删除该新测试库；若Owner提供已有专用测试库，则保留库本身及全部其他条目，不删除Owner提供的文件，测试库锁定状态按约定恢复。测试库密码经私有管道传递，不用命令行参数、环境变量或日志。**不锁定、解锁或切换登录/系统钥匙串，不切换默认钥匙串，不扩大现有条目ACL，不使用“始终允许”、共享access group、entitlement或新增持久认证授权。**新合成条目自身必然有系统默认访问控制，随测试清理；不将它说成零权限对象。

文件型Keychain创建/删除可能会自动新增/移除该测试库的搜索列表项（Apple的删除API明确会移除搜索列表项）。这一潜在全局偏好副作用不能用改HOME来保证隔离。优先由Owner提供已准备好的、路径明确的专用测试库；若授权自动创建，则需同时明确允许仅新增/移除本次测试库的搜索列表项，已有项及顺序不更改。不能保证这一点时停止，不自动重写整个搜索列表或尝试恢复未知并发变更。测试helper每次查询显式限定该库，绝不回退默认搜索列表。

正常/缺失/重复引用/新版本轮换/撤销后拒绝/显式缺失重绑均只针对本轮UUID。锁定拒绝只在此测试库进行；不同helper的ACL拒绝测试如需创建额外条目访问限制，将另列精确临时ACL变化供确认，不先扩大权限。任何系统认证提示或安全工具拒绝都停止该动作并报告，绝不自动点“始终允许”或解锁登录库。

Worker部分只调用本机受控接口，使用模拟Provider；不会调用OpenAI、Google、Pexels、Freesound、Cloudflare或火山服务，不购买服务、不产生Provider调用费用，也不以模拟“verified”解除蓝图真实就绪门禁。在线Provider与真实业务Key验证是另外的授权和验收，不包含在本方案内。

此文件是供Owner确认的具体方案，不是执行授权。当前真实Keychain操作数仍为0。参考：[Apple SecKeychainDelete](https://developer.apple.com/documentation/security/seckeychaindelete(_:))、[Keychain实现说明TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)。
