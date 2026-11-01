# 余额与近7天账务的获取方法

核查日期：2026-11-01。本页区分供应商资金余额、资源包／请求次数、实际账单；不以本平台费用预留推算实际扣费。后续接入进度及确定的账号级汇总口径见[账务接入验收记录](../connection-billing-20261101/REPORT.md)。

## 百炼／万象

1. 在阿里云 RAM 创建专用子用户或角色，配置访问凭据，仅授予需要的余额与账单读取权限。普通 DashScope 生成 Key 不能代替云账号账务凭据。
2. 余额通过 BSS OpenAPI `QueryAccountBalance` 读取。该接口文档当前列出的权限动作是 `bss:DescribeAcccount`，按官方文档配置，注意与接口名不同。分别展示可用额度、现金、信用等口径，不能混为已充值现金。
3. 近7天通过 `QueryAccountBill` 按日读取：`Granularity=DAILY`、`BillingDate=YYYY-MM-DD`、相应月份 `BillingCycle=YYYY-MM`；取齐分页，按百炼实际账单产品范围筛选。跨月分开查询。最终展示哪种费用字段，需要与该账号账单核对，不能把原价、折后应付、优惠券和实际现金扣款混用。
4. 当月账单可能调整；官方说明账单数据在实际消费后24小时更新。展示供应商返回时间和账务窗口，不承诺实时扣费。

官方：[余额接口](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)、[账单接口](https://help.aliyun.com/en/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbill)。

## 火山视频／火山语音

1. 在火山引擎访问控制 IAM 中配置专用 AK/SK 和对应费用中心查询权限。它们与方舟 API Key、语音应用凭据用途不同。
2. 通过 `QueryBalanceAcct` 读取资金账户余额。
3. 通过 `ListBillDetail` 按日期／产品和项目查询，指定 `BillPeriod`、`ExpenseDate`，按需要使用 `GroupPeriod=1`，跨月拆分并取齐分页；金额定义与费用中心核对。
4. 若视频与语音由同一火山账号结算，可能共用资金账户，不能当成两份独立余额。账单应按对应产品范围区分，以实际结算关系为准。

官方：[鉴权方式](https://docs.volcengine.com/docs/billing-center/api-call-instructions?lang=zh)、[余额接口](https://docs.volcengine.com/docs/billing-center/query-balance-acct-query-user-account-balance-information?lang=zh)、[账单明细](https://docs.volcengine.com/docs/billing-center/list-bill-detail-page-query-bill-details?lang=zh)。火山页面正文抓取多次超时，本轮相关接口与参数依据官方搜索索引内容核实，未进行真实账务调用。

## OpenAI

1. 由组织所有者在平台 Admin keys 创建专用 Admin API Key；当前 gpt-image2 生成 Key 不能代替它。账务接入只调用读取接口，不需要修改组织设置。
2. 花费调用 `GET /v1/organization/costs`，设置 `start_time`、`end_time`，取齐分页后汇总 amount；按需要用项目／Key筛选，明确是账号总额还是该连接的花费。
3. 本轮未找到官方公开的预付充值余额查询接口；预付余额先通过官方 Billing 控制台查看，不使用历史网页内部接口，不用充值减估算成本伪造余额。

官方：[Admin API](https://developers.openai.com/api/docs/guides/admin-apis)、[Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)。

## MiniMax

本轮未找到可确认用于本项目的公开稳定现金余额／7天账单接口。现阶段在与Key所属站点一致的控制台查看钱包和账单；若支持下载可取得账单文件，但本应用尚无账单导入功能。后续先向官方确认是否提供账号级账务接口，再接入，不能复用猜测的内部网页端点。

官方：[API服务账务说明](https://platform.minimax.io/protocol/paid-agreement#4-api-services)。此为国际站服务说明；国内账号的具体入口与可下载能力仍应以其国内控制台为准，本轮未操作用户MiniMax控制台。

## Kling

现有实现已用该连接读取资源包与扣费明细；`POST /account/billing/balance` 提供扣费明细。当前页面“无扣费记录”仅指本查询窗口未返回现金扣费，“资源包未返回”也不代表现金余额为0。

现有近7天采用“最近7天创建的任务”的供应商实际扣费口径，不等同于最近7天发生的全部扣款。若改口径须先核对供应商账单定义。

官方：[扣费明细接口](https://kling.ai/document-api/api/assets/billing-deduction/balance)。

## Pexels／Freesound

- Pexels：现有实现读取真实响应头 `X-Ratelimit-Remaining`。它是当前周期请求余量，非资金余额；现有接口没有提供本应用可用的7天历史查询，不补估算金额。
- Freesound：现有实现调用 `GET /apiv2/usage/?num_days=7`，读取最近24小时限额及历史请求次数；这些都是次数，非现金费用。

官方：[Pexels响应头](https://help.pexels.com/hc/en-us/articles/900005368726-How-do-I-see-how-many-requests-I-have-remaining)、[Freesound Usage](https://freesound.org/docs/api/resources_apiv2.html#usage)。

## 当前应用状态

Kling、Pexels、Freesound 的对应读取已实现。后续已完成 OpenAI、阿里云、火山账务凭据入口和读取适配的代码及隔离验证，正式更新、页面检查和真实凭据配置进度以[新验收记录](../connection-billing-20261101/REPORT.md)为准。未录入真实账务凭据前，不能宣称已经取得真实余额。
