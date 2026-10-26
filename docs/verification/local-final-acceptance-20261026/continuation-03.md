# 最小规划修复已验证，等待人工解锁日常 Keychain

Owner 已明确授权最小修复并接续重跑。实际完成：

- 日常 `scripts/runtime/codex.mjs` 能力名改为契约中的 `visual_planning`。
- 正常停止本次应用，运行 `npm run runtime:migrate`：迁移前生成完整备份，仅新增 048；旧迁移 SHA 不变。
- 真实日常脚本离线入口回归 3 项通过：视觉、分镜各只调用离线 stub 一次，不支持的 script_writing 在调用前拒绝。模型/Provider 调用均为 0，未用 stub 产物证明生产成功。
- 当前日常数据库真实回滚事务 4 例通过：新本地视觉/分镜任务的列及快照均为配置的 1；非规划/非本地记录保持原值。旧失败任务完整指纹未变，仍 failed/2/2。
- `npm run check` 和脚本语法通过。证据：`actual-runtime-offline-check.json`、`planning-limits-rollback-check.json`、`repair-migrate.log`、`repair-types.log`。

正常 `npm start` 在现存日常 Keychain 解锁处失败。原生 API 返回 -25293（errSecAuthFailed）；保存的密码未能解锁。此结果不足以断言密码一定错误或文件一定损坏。新建的空诊断 Keychain 使用相同源码/协议能完成 create→lock→unlock；用当前源码重编译的 helper 仍不能以保存密码解锁现存日常库。没有绕过秘密校验或修改现存密码。

现存加密 Keychain、密码文件、控制程序与部署已按原字节备份到 `.loop-control/local/state/final-acceptance-20261026/keychain-before-recovery`。原文件尚未替换/删除，也没有重建 Keychain、重新验证 Provider 或扩大 11 次请求上限。

Owner 随后要求「你重新打开一下密码，我数错了了好像」。已按当前 Keychain 上下文：

1. 在本机 TextEdit 打开日常 `keychain-password-private.json`，文件内容没有输出到聊天/报告，没有抓取包含密码的截图。
2. 发起仅针对日常专用 Keychain 的 macOS 原生解锁窗口，由 Owner 在系统界面输入；helper 不读取、保存或输出输入的密码，只返回状态。正常服务的非交互 helper 未被替换。
3. 已核验 TextEdit、临时 manual-unlock 与系统 SecurityAgent 进程在运行；等待本机输入结果。结束时将记录 `manual-unlock-result.json`。

**当前主程序因正常启动未通过而暂未恢复；尚无新的接续生产单或视觉产物。** Provider 仍为前两次资格验证，预留 ¥0.01、实际账单未知；实际模型调用仍 0/2。历史账号接入按 Owner 要求仍在新视频完成后进行。

若人工解锁成功，先恢复正常主程序并核对保存密码是否仍可支持后续正常启停，不把一次人工解锁等同完整生命周期通过。若仍无法解锁，保留现存库与结果，另列可恢复的重建方案及重新资格所需的额外两次请求，取得明确授权前不执行。
