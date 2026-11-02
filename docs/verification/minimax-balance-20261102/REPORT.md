# MiniMax 账号可用额接入

核查日期：2026-11-02。现有 MiniMax 国内站连接此前未接入余额读取；本轮增加按量 Key 的只读查询，不创建独立账务凭据、不修改生成凭据或生产单。

## 接口与口径

官方 CLI 已通过 [PR #216](https://github.com/MiniMax-AI/cli/pull/216) 支持 `GET /account/query_balance`，使用 Bearer 按量 API Key；[当前地域配置](https://github.com/MiniMax-AI/cli/blob/main/src/config/schema.ts) 的国内站为 `https://api.minimax.cn`、国际站为 `https://api.minimax.io`。沿用连接密钥内冻结的地域，单次只读请求，不跨地域重试、不跟随重定向。

直接使用本机现有 Key 的国内站实际请求返回 HTTP 200、`base_resp.status_code=0`：

| 字段 | 金额 |
| --- | --- |
| 可用额 `available_amount` | ¥23.00 |
| 现金 `cash_balance` | ¥10.00 |
| 代金券 `voucher_balance` | ¥13.00 |
| 信用额度 `credit_balance` | ¥0.00 |
| 欠款 `owed_amount` | ¥0.00 |

主表显示账号可用额，明细留在已有提示中，避免把代金券当成现金。金额保留供应商小数值，不按整数分换算。未查询到可确认的官方近7天账单接口；页面显示「暂不支持」，不使用余额差额、套餐百分比或本平台预留补算。国内站可按[官方账户说明](https://platform.minimaxi.com/docs/faq/about-account)进入[余额控制台](https://platform.minimax.cn/user-center/payment/balance)核对。

## 验证范围

- 单元及组件：覆盖国内／国际地域、精确金额、HTTP／业务错误、重定向、无效数据、非按量 Key、自动加载和不额外请求账务凭据。
- Owner HTTP／真实 PostgreSQL：覆盖本机读取、其他 Owner 隔离、无登录拒绝、按当前凭据版本缓存、轮换后重新读取、生成资格与凭据版本不因余额查询改变。
- 前端及本机服务 TypeScript 检查通过。

## 正式服务与页面验收

用户回复「已保存，允许更新本机服务」后，保留旧 Worker／本机服务运行包和当前剪辑 SQLite 恢复副本，执行 `npm stop`、`npm run runtime:prepare`、`npm start`。运行完整性检查通过，首页 HTTP 200。

重启前后现有 3 份生产单、连接绑定、生成凭据版本、4 条独立账务凭据及已登记交付的数据库指纹一致。比对 34 份当前工程文件，JSON、SQLite 主文件及 WAL 内容未变；2 份 SQLite 共享内存文件有瞬态变化，不作为工程内容差异。私有旧运行包与 SQLite 恢复副本保留。

用户恢复所有者登录后，正式服务真实页面显示「可用额 ¥23.00／近7天 暂不支持」，提示含现金 ¥10.00、代金券 ¥13.00、信用和欠款各 ¥0.00。OpenAI、阿里和火山账务亦正常返回。截图见 `live-connections.png`，页面内容见 `live-row.json`；未发起付费生成。

临时测试页 30 已关闭，用户原页 1 保留。未提交本轮源码；另一任务旧代码清理保持原样。
