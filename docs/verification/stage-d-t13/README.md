# T13 / #119：本地 Owner 与读取隔离

承接 T12 双审查通过的d219216，隔离工作树。未关闭Issue，未生产切换/推送/合并/部署。T12配置目录与现有生产界面分开，后续T14按票要求接回原有配置页面；本票只完成身份与读取边界。

本地凭据使用Node crypto带32字节随机盐的scrypt（N32768/r8/p1、64字节摘要），不导入Supabase Auth密码或会话。显式CLI仅接受已有Owner UUID，通过stdin设置独立本地密码，不创建或扩展账号成员关系；更改密码会撤销旧本地会话。真实验收使用隔离环境中的随机测试密码，不替Owner设置真实生产密码。

会话随机32字节，库中只存SHA-256与Owner/到期/撤销时间；浏览器HttpOnly、SameSite=Strict cookie，12小时绝对到期，Cookie不存于localStorage。重新登录更换token，退出和密码变更服务端撤销。变更请求校验精确Origin与CSRF，全部API核对Host并拒绝cross-site；不接受Bearer/JWT或可编辑metadata充当本地身份。每Owner失败计数经行锁串行保存，五次失败锁定15分钟。

local应用不再导入或调用Supabase Auth。目录和18分区详情经经过本地会话验证的Owner ID，在最小应用角色事务中读取原生PG；详情复用T10聚合函数与原RLS。文件请求先验证Owner与账号，再查DB产物索引；保留冻结蓝图/路径，利用只读部署元数据把源账号素材根映射到D媒体副本。校验规范路径、非符号链接、单链接普通文件、大小和SHA-256，成功才流式返回。不能读取原媒体根、任意路径或私有配置。282份C备份媒体仅复制到D目录，Worker挂载和生产能力未由本票接管。

## 真实验收

`node scripts/local/owner-acceptance.mjs`：真实本地登录、目录、18分区详情与产物hash；匿名401、跨来源/错误Host403、旧Bearer401、跨账号详情404、无CSRF403；退出后旧会话401、重新登录换token、重启仍有效、DB到期后401；遍历及符号链接文件409；私有配置HTTP403。仅新增的无效文件探针Episode/产物会清理，历史产物不改写。

`node scripts/local/owner-isolation-acceptance.mjs`：另一个明确合成的无成员Owner经过真实本地登录，账号/Episode目录为空，读取主Owner的Episode和产物均404；秘密未出现在应用日志；该新身份/会话随后清理。

断网范围：`node scripts/local/start.mjs --offline-test`对D应用进程阻断所有出站HTTP和除127.0.0.1:55472原生PG外的socket，启动自检确认Supabase Auth端口也被拒绝。上述真实登录/读取/重启在该约束下通过。没有断开整机网络、停止其他服务或宣称物理断网/离线外部AI生成。普通启动不加该测试guard，local代码同样没有Auth依赖。

迁移入口：`node scripts/local/migrate.mjs`在两个已记录D测试库应用不可变002/003前向迁移；`node scripts/local/media.mjs`核验并复制已批准的C备份；`node scripts/local/owner.mjs <已有Owner UUID>`从stdin读取密码。CLI不写真实Keychain或外部认证权限。数据库凭据、测试密码、cookie不提交，原始私有日志在`.loop-control/stage-d`。

## 保留失败与待验范围

初次Host测试使用Node fetch，其忽略自定义Host，改成真实http.request，不改变服务防护；初次文件请求409揭示账号素材子目录映射缺失，新增003部署映射迁移后重测。没有放宽路径/指纹检查。首次外账号样本没有产物，明确记录并另以真实合成本地Owner测试对主Owner产物的404。

C五秒历史不稳定、3条既有advisor WARN、n8n原生校验跳过、真人审批和在线Provider未测继续保留。T14+命令/原页面配置、Worker/生成/审核/交付/恢复不由T13完成。完整回归及两路独立审查待补最终结果。
