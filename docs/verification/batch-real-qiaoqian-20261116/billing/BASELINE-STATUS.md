# 账务基线

首次查询在正式 `runtimeSecret` 的 `requireUnlockedKeychain` 处被 `keychain_locked` 拒绝，未读取凭据，未发出供应商网络请求，未改变 Keychain 或数据库。已通知主 Agent 通过正常 `npm start` 流程解锁后重试。

快照脚本 `.scratch/batch-real-qiaoqian-20261116/read-billing.mjs` 仅查询当前 MiniMax 按量账号余额和现有火山独立账务绑定的余额、近七日入账明细；不生成、不测试连接、不修改配置，不保存秘密或认证请求头。正常快照写入本目录 `baseline.json` / `final.json`。

正常启动解锁后，2026-11-16 19:36:55（+08）基线成功：MiniMax 可用额及现金余额均为 ¥24.50，代金券、信用额度、欠款均为 ¥0；火山可用余额 ¥14.21。`baseline.json` 共 17 次只读查询，所有 HTTP 200。

另根据[火山官方 ListBillDetail 文档](https://docs.volcengine.com/docs/billing-center/list-bill-detail-page-query-bill-details?lang=zh)增加 `GroupTerm=0`（计费项）／`GroupPeriod=2`（明细）查询，保存 `baseline-detail.json`：当前日期无已入账项；昨日已有 `TTS-SeedTTS2.0` 小时结明细，可返回产品、字符量及账单／资源 ID。因此不再沿用旧报告“供应商未提供产品字段”的笼统结论；此前读取的是账号按日聚合。小时结明细仍不能直接证明每次请求真实费用。

两条现有火山账务连接返回相同账号／账单，汇总时按账单身份去重，不重复加总。基线完成时本单 `b53cfbbc-22ec-4bde-8791-c0d11b244748` 尚无任务。
