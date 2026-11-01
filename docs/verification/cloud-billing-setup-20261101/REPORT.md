# 余额入口与云账务配置

日期：2026-11-01。

## OpenAI余额链接

连接表与账务详情中的「控制台查看」已改为链接，固定跳转 `https://platform.openai.com/settings/organization/billing/overview`；新窗口打开并设置 `noopener noreferrer`。使用现有强调色、下划线和键盘焦点描边。

14项相关组件回归、类型检查与差异空白检查通过。真实浏览器核对两处地址及详情链接的 `_blank`，刷新账务后组织 Costs 正常显示。不涉及后端更改或服务重启。

证据：`.loop-control/maintenance/cloud-billing-setup-20261101/` 下 `link-tests.log`、`link-check.log`、`openai-balance-link.png`、`openai-details-link.png`。

## 云凭据准备

继续用户已登录的 Chrome 页面，没有读取登录密码。

- 阿里 RAM：用户名称 `loop-control-billing`，程序访问开启、控制台访问关闭。用户最终确认后已创建，平台安全验证由用户完成。创建自定义策略 `LoopControlBillingReadOnly`，仅 `bss:DescribeAcccount`、`bss:QueryAccountBill`，资源为`*`；策略编辑校验通过，已绑定到该用户，回执1/1成功。没有添加系统全局权限或主账号密钥。结果页保留供用户复制密钥。
- 火山 IAM：同名用户，编程访问开启、控制台访问关闭；审阅页仅1项 `BillingCenterReadOnlyAccess`，无用户组附加权限。获最终确认后提交，云平台短信多因素认证由用户完成；没有读取或代填验证码。创建成功，用户分别在视频／语音连接中安全录入并保存。
- 用户最终确认「确认创建两家只读账务凭据」已收到；创建和授权按上述范围执行，不扩大到全局只读或管理员权限。
- 密钥创建后由用户领取并在本机应用安全录入；不读取剪贴板或在聊天、报告中显示明文。供应商MFA需用户完成。

截图 `aliyun-before-create.png`、`aliyun-granted.png`、`volc-review.png` 保存于上述私有目录。创建阶段用户「阿里验证通过」仅指云平台验证；后续已完成安全录入并分别复查余额及账单，未将创建成功误记为真实账务通过。

## 真实接入发现与修复

用户随后完成阿里、火山视频、火山语音三处安全录入；正式库增加3条账务绑定，生成凭据版本不变。

阿里：余额真实返回¥0.00。初次账单读取失败，脱敏诊断只记录字段名／类型／行数，确认6天空记录、最后1天有PretaxAmount但无PaymentAmount。按[官方QueryAccountBill字段说明](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbill)固定汇总应付金额，标签为「账单7天」，说明非现金扣款及24小时延迟；不在不同记录之间混用金额口径。真实结构回归先失败，修复后通过；准备后的真实Keychain读取返回两项ready，账单7天¥0.00。

火山：视频／语音独立保存均返回可用额¥14.39、近7天已入账支付¥0.14。首次重启后同时加载出现部分失败，脱敏并发复现确认两个绑定使用相同账号凭据，供应商返回HTTP200及`AccountFlowLimitExceeded`，不是权限缺失。原实现每个连接独立节流，合并后超账号限流；改为同一reader共享云请求队列和最小间隔，失败不阻塞后续请求，排队期间受原30秒期限约束。限流有独立提示，不再误报IAM权限。

验证：链接相关14项通过；最终供应商9项、真实HTTP／PG集成2项、类型检查通过。新增并发测试先复现并行请求数2，修复后为1；真实两个火山绑定并发读取16个请求，最小启动间隔220ms，错误0，两项余额／7日支付均ready。日志分别为`aliyun-bill-red.log`、`provider-final.log`、`volc-queue-red.log`、`billing-final-integration.log`、`check-final.log`、`volc-concurrency-fixed.json`。`runtime:prepare`及日常服务更新成功；无新增数据库迁移。

不完整供应商载荷、混合币种、超页数仍返回失败，不使用估算值补齐。不扩大云授权或发送生成／充值请求。

## 最终正式页面复验

2026-11-01 22:33（Asia/Shanghai），服务更新后新打开连接页，四个绑定同时读取完成：

| 连接 | 余额／可用额 | 近7天 | 状态 |
| --- | --- | --- | --- |
| gpt-image2 | 官方控制台超链接 | US$0.00，组织Costs | 消费ready，余额API不支持 |
| 百炼-万象 | ¥0.00 | ¥0.00，阿里应付账单 | 两项ready |
| seedance | ¥14.39 | ¥0.14，火山已入账支付 | 两项ready |
| 火山语音连接 | ¥14.39 | ¥0.14，同一火山账号 | 两项ready |

火山两行是同一个账号资金及账务，不能累加。OpenAI链接地址再次核对正确。证据 `final-browser-balances.json`、`final-connections.png`；`final-metadata-proof.json`确认当前生产单、目录登记、生成连接及生成凭据版本不变，仅新增所需账务绑定。

Agent临时策略标签和Loop Control测试页28已关闭，仅原IAB页1保留。用户原有阿里／火山Chrome页面保留供凭据管理；没有读取剪贴板、将密钥原文输出到聊天或落入测试日志。未提交Git或推送。
