<div align="center">

# Loop Control

**单一 Owner 使用的本地多账号短视频生产控制台，串联脚本、素材、剪辑、技术校验和交付包。**

<img src="assets/banner.png" alt="Loop Control 短视频生产控制台封面" width="100%">

</div>

## 使用方式

账号蓝图和系列保存版本化创作规则，Episode 固定引用原版本。每个账号设置实际专属目录，其生产单按稳定 ID 存放脚本、素材、原生工程、字幕、导出与交付文件。已有文件更换目录须经盘点、复制、校验和原子切换，原件保留。

Owner 按脚本确认、素材准备与匹配、剪辑工作台、检查与交付四步制作。普通正文在本地按段落建立镜头，v2 脚本直接读取已编写分镜；默认准备流程不调用 Codex CLI。图片、视频、语音、配乐与音效在制作时选择实际服务。视频支持 AI、Pexels 检索和上传。每次请求冻结自己的连接和输入，改选不改变旧任务与候选，采用需要明确操作。

OpenChatCut 拥有实际编辑时间线，成片与字幕确认绑定真实导出文件。「生产完成」表示交付包通过校验，不表示已经发布到第三方平台。蓝图不再配置媒体能力、执行模型、审核开关或资产目录。

旧 Codex CLI 视觉与分镜规划入口、重试及执行器已退役，历史记录保留。[后续数据库与统计计划](docs/plans/native-postgres-and-clean-schema-20261112.md)记录了原生 PostgreSQL 已完成切换的验收，以及干净 SQL 基线、统计与组件迁移的后续顺序。

当前程序通过本地 Owner API、原生 PostgreSQL、Keychain 和 Worker 运行。Supabase/n8n 执行栈及旧启动入口已退役；共享界面不提供云端回退。

历史上使用过 Cloudflare 图像服务和 Google TTS；当前图像使用已登记的 OpenAI 服务，语音使用豆包语音。Supabase 的应用职责已由本地 Owner API、PostgreSQL 和 Keychain 承接，n8n 调度由应用内调度器承接。旧迁移、冻结快照验收与历史文档保留，当前运行代码不再提供这四项的专属适配。详见 [2026-11-12 核查与验收](docs/verification/lucide-and-toolchain-20261112/REPORT.md)。

后续已核查并清理无使用方的独立 OpenChatCut 安装，保留项目内运行副本；本机 Worker 全局并发配置改为 2，重任务保持 1。生效边界、历史 SQL 清单与待决定方案见 [并发与工具链后续核查](docs/verification/worker-concurrency-and-audit-20261112/REPORT.md)。

## 在当前 Mac 启动

需要 Node.js 24，以及已经准备好的本地部署、PostgreSQL、媒体磁盘、专用 Keychain 和 OpenChatCut。当前仓库不是任意新机器的一键安装器。

```zsh
npm start
npm stop
```

正常启动读取 `.loop-control/local/deployment.json`，核对数据库、媒体和秘密引用，准备本地后台与 Worker，再启动控制台。当前配置的控制台为 `http://127.0.0.1:5174`，Studio 为 `127.0.0.1:5175`；缺配置时明确失败。

- [日常运行、数据位置与故障检查](docs/local-daily-runtime.md)
- [当前产品约束](docs/specs/current-product.md)
- [交互式架构快照](docs/architecture-map/README.md)
- [当前计划](PLAN.md) · [阶段完成索引](docs/completed-work.md)

## 开发与验证

```zsh
npm run check
npm test
npm run build
```

默认测试排除需要显式隔离配置的数据库集成测试。构建前端会清理 `dist`；日常后台依赖该目录，构建后执行 `npm run runtime:prepare` 恢复完整后台和 Worker 产物，再通过正常入口运行。

`runtime:prepare` 只编译和核对本地程序，不启动任务、不执行数据库迁移或 Provider 请求。新增本地迁移使用 `npm run runtime:migrate`，它会校验已执行迁移的原始摘要，并尊重 Owner 的备份配置。

当前日常库仍为 `legacy-v1`；普通启动和迁移不会自动采用 `clean-v2`。已完成的基线与旧执行退役代码已分批保存本地，日常采用尚未执行，步骤和回退边界见 [日常数据库切换方案](docs/plans/clean-sql-daily-cutover-20261112.md)。

OpenChatCut 的真实渲染集成检查需要本机对应源码与媒体工具：

```zsh
npm run test:openchatcut-integration
```

## 技术与边界

- React 19、TypeScript 5、Vite 7；PC 优先，支持浅深主题和受限宽度。
- 原生 PostgreSQL、Owner 会话、CSRF、版本和幂等控制；Node.js 24 本机 Worker 与持久调度。
- 连接按实际功能分组；专用 Keychain 存放秘密，运行配置与任务只保存引用，普通连接表单不回显凭据。
- OpenChatCut、FFmpeg 和本地语音对齐工具承担媒体生产。供应商能力及付费生成始终受当前连接、任务和预算约束。
- `.loop-control/local/` 保存当前配置、媒体、历史内容与工具环境，受 Git 忽略；它不是可以整体删除的旧缓存。
- `db/current/` 保存隔离验收中的当前 SQL 基线；`db/archive/legacy-v1/` 按原字节保留旧基线和迁移，通过 manifest 校验旧 ledger。日常启动不会自动跨代，历史文件、凭据引用和只读生产单保持。见 [ADR-0047](docs/adr/0047-clean-sql-baseline-generations.md)。

制作与目录归属见 [ADR-0018](docs/adr/0018-per-request-production-and-account-storage.md)；受控验收与未执行范围见 [#166 验收记录](docs/verification/blueprint-166/REPORT.md)。

任务使用 [GitHub Issues](https://github.com/DaNN-55/loop-control/issues)；领域词汇见 [CONTEXT.md](CONTEXT.md)，架构决定见 [ADR 索引](docs/adr/README.md)。
