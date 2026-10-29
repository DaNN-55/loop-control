<div align="center">

# Loop Control

**单一 Owner 使用的本地多账号短视频生产控制台，串联素材、脚本、审核、剪辑、QC 和交付包。**

<img src="assets/banner.png" alt="Loop Control 短视频生产控制台封面" width="100%">

</div>

## 使用方式

账号蓝图和系列规则确定内容边界；创建 Episode 时冻结版本。Owner 导入并确认主脚本，在生产节点检查视觉、分镜、镜头、字幕和审核结果，使用 OpenChatCut 编辑，最后完成 QC 和发布包校验。“生产完成”表示交付包通过校验，不表示已经发布到第三方平台。

当前程序通过本地 Owner API、原生 PostgreSQL、Keychain 和 Worker 运行。Supabase/n8n 执行栈及旧启动入口已退役；共享界面不提供云端回退。

## 在当前 Mac 启动

需要 Node.js 24，以及已经准备好的本地部署、PostgreSQL、媒体磁盘、专用 Keychain 和 OpenChatCut。当前仓库不是任意新机器的一键安装器。

```zsh
npm start
npm stop
```

正常启动读取 `.loop-control/local/deployment.json`，核对数据库、媒体和秘密引用，准备本地后台与 Worker，再启动控制台。当前配置的控制台为 `http://127.0.0.1:5174`，Studio 为 `127.0.0.1:5175`；缺配置时明确失败。

- [日常运行、数据位置与故障检查](docs/local-daily-runtime.md)
- [当前产品约束](docs/specs/current-product.md)
- [交互式架构与运行流程](docs/architecture-map/README.md)
- [当前计划](PLAN.md) · [阶段完成索引](docs/completed-work.md)

## 开发与验证

```zsh
npm run check
npm test
npm run build
```

默认测试排除需要显式隔离配置的数据库集成测试。构建前端会清理 `dist`；日常后台依赖该目录，构建后执行 `npm run runtime:prepare` 恢复完整后台和 Worker 产物，再通过正常入口运行。

`runtime:prepare` 只编译和核对本地程序，不启动任务、不执行数据库迁移或 Provider 请求。新增本地迁移使用 `npm run runtime:migrate`，它会校验已执行迁移的原始摘要，并尊重 Owner 的备份配置。

OpenChatCut 的真实渲染集成检查需要本机对应源码与媒体工具：

```zsh
npm run test:openchatcut-integration
```

## 技术与边界

- React 19、TypeScript 5、Vite 7；PC 优先，支持浅深主题和受限宽度。
- 原生 PostgreSQL、Owner 会话、CSRF、版本和幂等控制；Node.js 24 本机 Worker 与持久调度。
- 专用 Keychain 存放秘密，运行配置保存引用；普通连接表单不回显凭据。
- OpenChatCut、FFmpeg 和本地语音对齐工具承担媒体生产。供应商能力及付费生成始终受当前连接、任务和预算约束。
- `.loop-control/local/` 保存当前配置、媒体、历史内容与工具环境，受 Git 忽略；它不是可以整体删除的旧缓存。
- `db/local/` 的基线和已执行迁移保持原样。历史文件、秘密别名及只读生产单保留现行引用和还原能力。

任务使用 [GitHub Issues](https://github.com/DaNN-55/loop-control/issues)；领域词汇见 [CONTEXT.md](CONTEXT.md)，架构决定见 [ADR 索引](docs/adr/README.md)。
