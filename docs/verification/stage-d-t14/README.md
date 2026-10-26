# T14 / #120：本地账号、蓝图和系列

基线af147ee，延续已通过T12/T13。GitHub Issue保持OPEN。仅隔离库/工作树，无生产切换、推送、合并、部署或真实Keychain/Provider操作。用户原PLAN.md及未跟踪规划文件保留。

## 实现

Owner通过同一本地会话、Host/Origin/CSRF边界提交配置。服务只有固定白名单命令、参数化SQL，无任意表/函数/SQL网关；账号引用在DB确认归属。公共业务函数继续原有校验、版本、审计与引用语义。私有账号锁函数只锁本人账号，避免为了FOR UPDATE授予原始业务UPDATE。当前蓝图通过服务提供的policy revision作并发控制，陈旧提交409。

命令在身份事务内再次锁定/验证会话，持久幂等回执与业务结果同事务提交；同Owner/同key并发只执行一次，不同内容复用key409。客户端合并进行中的同意图请求，sessionStorage只保存UUID（按请求hash索引），网络结果未知后保留key供重试，成功响应后清除。无双写/旧后端回退。统一Owner事务包装消除T13审查指出的重复身份清理逻辑。

复用原`AccountWorkspace`、`BlueprintConfigurationForm`、系列表单/确认弹窗；原`AccountForm`/时区选择器抽到共享文件，旧App继续使用同一组件。local模式仅载入已接管配置/目录页面。配置页的旧SDK只在旧模式目录操作时动态装载，local不调用。原文件夹原生选择/打开尚未接管，明确提示不可用；可填写已授权D媒体目录，保存时服务端规范路径校验。检查栏明确外部连接未就绪，不能把配置保存当生产前检查通过。

外部执行路径/credential_ref暂时409，秘密字段400，不回落Vault。原生PG迁移004/005/006仅给应用角色授权这些业务函数、私有锁与回执表，仍无原始业务UPDATE。006撤回旧连接查询锁函数执行权，先锁账号再以新SQL语句读取revision，避免READ COMMITTED等待锁期间持有旧policy快照。新素材根限于存在且无符号链接的D媒体目录；保留已有导入根时通过部署映射读取D副本。时间区、字段、规则、确认、引用仍有服务/数据库校验。

## 实际验收

[HTTP](http.json)：8并发同意图创建1账号，6并发提交1系列v1；系列v2、Prompt版本、蓝图创建/激活/归档、账号改名/归档/恢复通过；陈旧蓝图409、同key不同内容409、活动蓝图归档400、外部未就绪409、秘密字段/非法时区/生产素材根400；有Episode的账号删除409，空账号必须正确确认名称才删除。仅删除本次新建空测试账号，没有删除历史数据。

保持既有快照语义：修改已有Episode引用的当前蓝图时，原函数创建旧policy快照并将该测试Episode引用移到快照；Episode ID和冻结规则保留，当前蓝图只影响未来。该引用移动明确记录，未宣称整条Episode字节不变。

[真实浏览器](browser.json)：独立Playwright会话载入私有合成cookie文件，参数/截图不含密码或token；原账号表单创建成功，原蓝图选择已登记Harness后保存，刷新并从PG确认定位；原系列页确认保存v3，刷新后保持v3/规则。[系列截图](series.png)、[刷新系列](series-after-reload.txt)、[刷新蓝图](blueprint-after-reload.txt)、[创建账号](account-created.txt)。[浏览器请求URL](browser-requests.txt)仅本地业务/身份，没有Auth/REST回退。测试自动化不是真人业务审批。

[不同Owner](isolation.json)：真实合成本地登录后目录为空，跨Owner配置命令/详情/产物404；新身份/会话清理。[新本地素材根](local-media.json)：真实产物HTTP及hash通过。测试在D应用进程出站HTTP全拒绝、socket仅原生PG允许的guard下完成，不改变主机网络，不是离线AI生成。

[原始历史](original-history.json)：原C归档38表20,379条记录逐条仍原样存在，新增行均为本票合成配置/生产单/回执等，保留诊断夹具。[完整回归](checks.txt)：85文件707项默认5000ms通过，Node2过/1既有跳过，应用和local-app类型通过。

审查发现的真实竞态先被复现：[修复前](race-before.json)两条不同key、相同revision的HTTP事务同时等锁后均200；[修复后](race-after.json)同条件200/409。新增`configuration-race.mjs`强制观察到两事务都阻塞后才释放账号锁，未以顺序调用替代并发。另一个HTTP边界故障测试先红后绿：配置POST已经提交、后续目录GET失败时，界面提示“配置已保存”，关闭确认框；刷新仅重读，不再发第二次POST。该故障注入使用模拟fetch，与真实PG/HTTP验收分开报告。

## 保留失败与范围

首次服务自己用最小角色直接FOR UPDATE账号被42501拒绝；增加私有且检查Owner的锁函数，未扩大原始业务UPDATE权限。首次系列夹具使用不支持tone字段，被原SQL400拒绝；改用契约支持的format字段，未改弱SQL校验。页面开发热更新重置过未提交测试草稿并使引用失效；重新snapshot核验尚未提交后重做，未重复未知写入。失败测试留下的合成账号/快照保留可诊断，未伪装为生产样本。

T15连接/Keychain和T16+输入/Worker/生产尚未完成；T14保存不代表执行就绪。C历史五秒不稳定、3既有advisor WARN、n8n原生校验跳过、真人审批与在线Provider未测保留。[双审查](review.md)在8bc2490复核后通过，T14本地完成。
