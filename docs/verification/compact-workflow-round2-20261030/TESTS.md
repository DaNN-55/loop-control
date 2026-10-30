# 第二轮验证记录

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 全量普通回归 | 165 个文件，1107 项通过 | [日志](logs/unit-suite-permitted.log) |
| 真实视觉候选集成 | 12 项通过，含任务镜头归属、时长决策、重复提交围栏、实际 Worker / HTTP / PG | [日志](logs/visual-integration.log) |
| 收尾定向回归 | 预览、交付轮询、可调分栏共 12 项通过 | [日志](logs/final-fixes.log) |
| 类型与前端构建 | `npm run build` 通过，包含 TypeScript 检查；沿用既有 bundle 大小提示 | [日志](logs/build-final.log) |
| Worker / 后端准备 | `npm run runtime:prepare` 通过 | [日志](logs/runtime-final.log) |
| 源码和运行产物完整性 | `assertPreparedRuntime` 通过 | [日志](logs/runtime-integrity-final.log) |
| 五种窗口四页 | 1440×900、1280×800、1024×768、800×900、390×844，共 20 项无页面级横向溢出 | [测量](responsive.json)；[截图](OPERATIONS.md) |
| 实际交付 | 当前单为 `production_completed`，5/5 技术检查、六类文件磁盘/HTTP SHA 和大小匹配、视频全片解码通过 | [文件读回](readback-4d27f8b8-0de5-478a-903e-d0bfbc6a67a0/verification.json) |
| 日常更新 | 本机 HTTP 200；七类业务记录更新前后指纹一致，待执行/运行任务为 0 | [前](daily-before.json)；[后](daily-after.json) |

## 失败与修正

- 一次普通测试在受限沙箱中运行，28 项本机 HTTP 相关测试遇到 `listen EPERM`。未修改断言；允许本机监听后全量 1107 项通过。
- 交付轮询在父组件频繁刷新时不断重启，导致已完成仍显示排队。新增回归先复现零次回调，再改为稳定计时器和最新回调引用，测试通过，实际 UI 自动显示六类已验证文件。[失败](logs/delivery-poll-red.log) / [修复](logs/delivery-preview-green.log)。
- 新增测试的局部类型夹具两次触发 TypeScript 检查，分别补全工程字段和交付记录字段；最终完整构建通过。未放宽产品类型或既有断言。
- 采用视频后预览读取原始绑定，现改读已保存原生工程；同步处理变速和精确源结束位置。当前视频实际播放至 3.000 秒暂停，媒体就绪、无错误。

完整从新建脚本到生成、剪辑、检查、交付的前轮全链验收和 7/7 在线 Provider 连接结果见 [迁移报告](../compact-workflow-migration-20261030/REPORT.md)。本轮增加同镜头双音效、就地上传与采用、直接进入剪辑、确认字幕、导出交付的实际链路；未重复在线 Provider 连接测试，未提交在线付费视频生成。手工字幕校时不代表 WhisperX 模型推理通过。
