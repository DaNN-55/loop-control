# D 阶段六组本地归档

2026-10-25，Asia/Shanghai。基线 `bca697bbc1e12626771d1283ec87a17bf85f02fe`，分支 `codex/local-first-stage-a`。按 Owner 明确批准完成六组本地归档；账号新功能与无关规划保留，未关闭 Issue、推送或合并。

| 组 | 本地提交 | 内容 |
| --- | --- | --- |
| D1 | `85db5419bec5a2a9694ea7a587159178df1482df` | test(local): stabilize default 5000ms regression |
| D2 | `477bd54acc3531f2778c9f030406275d47773540` | fix(worker): retain lease recovery when stdout closes |
| D3 | `e9b87596efa72ed2e601ca059d4dc7aeb5b5e24c` | docs(verification): archive real offline WhisperX inference |
| D4 | `99c5c83ec724e0d31c7c848ddf1d54754abf75d7` | feat(local): prepare offline assets and select default deployment |
| D5 | `614c9056ebe9a58def4398217d1e595be556f776` | feat(local): budget Provider requests and archive scoped online acceptance |
| D6 | 本文所在提交 | 当前状态、归档检查与总索引 |

共享文件按对应代码块形成提交：默认指针与离线准备先于 Provider 预算；应用工厂及测试只提交 Provider 装配，账号命令导入、实例、关闭和测试留在工作区。账号功能已有另行形成的报告与证据，本次按用户要求不纳入，也不使用其 815 项结果证明此处源码。

本轮将基线和 D1–D5 的精确内容在独立临时目录展开，复用现有依赖，使用允许列表隔离测试环境和拒绝外网的 Node 封套。默认 5000ms 完整回归 **105 文件、807/807**；TypeScript 与原生类型、前端构建通过；Node **2 通过、1 项既有 n8n 原生检查跳过**。保留既有 act 警告、构建 chunk 告警及预期故障日志。历史源码副本仍显式排除，裸 npm test 的发现问题未修复。

这次验证的是归档源码快照，未重新执行历史真实 HTTP/PG、浏览器、自然租约、WhisperX 或在线 Provider 验收，没有新 Provider 请求。历史专项证据只做存在性、大小与 SHA 核对：开始时 1211 项公开、1954 项私有全部一致；本提交索引只归档账号功能加入前的 1133 项加本轮记录，账号新增条目保留在工作区索引。私有配置、Keychain、cookie/CSRF、备份、模型、node_modules 和 dist 不进入提交。

Provider 技术结果仍限定 Pexels 视频和豆包短句样本；Google `BILLING_DISABLED`、Freesound 401、Cloudflare/OpenAI 未通过或跳过保持。累计 **10/17 次，费用预留 0.03/2 元**，未查询实际账单。新主机/冷启动、任意错误正文检测、完整多能力业务、真实通知可见送达、秒级故障切换、存活过期执行器文件隔离等未验收范围不关闭，SQL 建议继续暂缓，E/F 不进入。

原始日志、历史报告快照、旧失败结果与预算账本原字节保留。当前入口文档只同步最新状态及区分历史阶段；既有报告里的“未提交”“根因未解决”等按其时间与范围阅读，不追认旧失败通过。

[本轮命令与退出码](evidence/local-commit-archive/validation-results.json)、[完整回归日志](evidence/local-commit-archive/validation-full.log)、[保留范围核对](evidence/local-commit-archive/preservation-result.json)。原始运行工具及完整快照留在本机临时归档，不把本次记录称为独立评审。
