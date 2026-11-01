# 独立供应商账务接入

日期：2026-11-01。源码、隔离测试、正式迁移和实际页面验收已完成；真实账务凭据配置单独记录，不能将模拟供应商结果当作真实余额。

## 已实现

- 连接更多操作中的「账务设置」：独立录入、验证保存、刷新、更换和断开；普通生成凭据不变。
- 阿里云中国站：`QueryAccountBalance.AvailableAmount`、按日分页的 `QueryAccountBill.PretaxAmount`（应付账单，显示「账单7天」）。真实接入发现不返回现金支付字段后已修正，详见[云账务接入记录](../cloud-billing-setup-20261101/REPORT.md)。
- 火山中国站：`QueryBalanceAcct.AvailableBalance`、按日分页的 `ListBillDetail.PaidAmount`。不使用应付估计值代替已支付金额。
- OpenAI：组织 Admin Key 读取 Costs API；公开预付余额 API 未接入，余额显示「控制台查看」。
- 近7天为北京时间今天及此前6个自然日，范围是供应商账号／组织，可能包含其他工具、项目和服务。阿里展示应付账单、火山展示已入账支付、OpenAI展示组织 Costs，不能混为当前生成 Key 的独立钱包。
- 既有 Kling 任务扣费、Pexels 请求余量、Freesound 请求次数读取保持原口径。

## 凭据与查询边界

沿用 Owner 会话、Origin、CSRF、RLS 和真实 Keychain；数据库仅保存不可变凭据引用和轮换状态。新凭据先读取验证，再保存；失败不替换原配置。请求重试使用内存操作标识，不向浏览器存储写入秘密或秘密摘要。

端点固定为官方域名，只发送读取动作；不跟随重定向。单次最多24次请求、响应上限2 MiB、30秒期限；账单页数超限或字段不完整则报错，不展示部分合计或推测的0。金额以定点整数汇总，退款保留负号。缓存5分钟，换 Key／断开后拒绝旧请求结果。

架构记录：[ADR 0022](../../adr/0022-provider-billing-credentials.md)。迁移：`db/local/132-connection-billing.sql`。

## 已执行检查

- 9个相关测试文件49项通过；随后补充重定向／响应体上限测试，再跑5个目标文件20项通过。
- 真实 HTTP／PostgreSQL 隔离集成2项通过：Owner隔离、CSRF、不可变记录、验证失败与 Keychain 失败、幂等重试、轮换、旧版本隔离、断开、秘密目录引用、生成凭据不变。
- `npm run check`、`npm run runtime:prepare` 和准备产物完整性检查通过。
- CSRF 回归：热重载导致内存令牌丢失时先恢复会话，再发送一次原操作；非空令牌被403拒绝时不重发写请求。2项红转绿。

私有完整日志：`.loop-control/maintenance/connection-billing-20261101/` 下 `tests.log`、`targeted-tests.log`、`integration.log`、`check.log`、`prepare.log`、`prepared-integrity.log`。完整性检查曾使用不存在的 tsx／错误产物路径，随后依据项目已有脚本改用 Node 原生 TS 入口，最终检查成功；没有安装依赖。

## 尚待完成

- 用户录入阿里 RAM 和火山 IAM 账务凭据后的真实供应商验证。OpenAI 真实验证已通过，见下文；未将模拟密钥保存到正式库。

## 正式更新与页面结果

- `npm run runtime:migrate` 仅应用132；旧迁移摘要不变。没有传 `--no-backup`；运行配置中 Owner 已关闭自动整库备份，脚本按该设置执行。本轮另有精确历史恢复备份，不能宣称做过新的整库备份。
- 按既有「已保存，允许更新本机服务」授权更新并重启5174服务成功，原 Owner 会话仍有效。
- 真实页面检查阿里、火山与 OpenAI 菜单／凭据表单；空凭据保存禁用，Secret／Admin Key 默认密码框，未写入真实或虚构密钥。
- 620px窄窗阿里弹窗宽596px、表单宽556px，无页面横向溢出；桌面弹窗宽640px。截图：`aliyun-desktop.png`、`aliyun-narrow.png`、`volcengine-desktop.png`、`openai-desktop.png`。
- 更新前后当前生产单、目录绑定、生成连接、生成凭据版本完全一致；正式账务记录0、运行任务0。私有证据 `formal-update-proof.json`。测试页24已关闭，用户原页未导航或关闭。
- 历史清理独立完成后才执行账务迁移；[清理报告](../history-cleanup-20261101/README.md)保留3份删除回执及文件摘要核验。

## OpenAI Admin Key 领取

连接器仅支持创建普通项目 Key，不能代替组织 Admin Key；使用官方 `platform.openai.com/settings/organization/admin-keys`。用户已登录 Personal 组织，页面提供创建权限。

已准备名称 `loop-control-billing`、Restricted、仅 `Usage API Scope → Read`（`api.usage.read`）、其余 None、有效期90天；创建前截图 `admin-key-prepared.png`。在最终确认提问后，用户回复「我已创建」。主Agent没有再提交创建，未读取或输出密钥原文。页25保留供用户领取；页26打开本机安全输入框，等待用户自行粘贴并「验证并保存」后核对真实 Costs 结果。

用户随后回复「已保存」。实际页面显示「已配置账务凭据 · 不回显密钥」和保存成功，密码输入框已移除。再点击一次「刷新账务」，使用已保存 Keychain 凭据真实查询成功，页面显示「账务数据已更新」。近7天（北京时间2026-10-26 00:00起至读取时刻）的组织 Costs 为 `US$0.00`；余额仍为「控制台查看」，没有把组织花费或网页充值余额伪装为公开余额API结果。

真实页面截图 `openai-live.png`；关闭对话框后表格同步为「余额 控制台查看／组织7天 US$0.00」。正式库仅新增1条 current OpenAI账务记录；生成连接、生成凭据版本、当前生产单和目录绑定完全不变，私有证明 `live-key-metadata-proof.json`。没有读取浏览器密码值或剪贴板，也没有将明文 Key 写入报告。页25／26已关闭，仅用户原页1保留，临时视口已恢复。
