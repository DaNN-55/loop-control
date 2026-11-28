# 同机 Harness 制作包交接 v1 验收（2026-11-28）

## 环境

所有测试从 Loop Control 主项目工作区发起。使用隔离 PostgreSQL 17、Owner 会话、媒体根、OpenChatCut 副本（本地渲染时）、交接目录与临时 Harness Web profile。日常部署、DSH profile、数据库、Keychain 和运行产物未用于验收；未安装到日常环境，未调用付费供应商或发布第三方平台。

## 结果

- 主项目默认回归：391 个文件，2,775 项通过，1 项跳过；类型检查及写往临时输出目录的前端构建通过。构建仍报告 CSS 压缩和 chunk 大小警告。制作包、结果写入、Owner 接单界面和启动接线定向回归 26 项通过。
- 策稿 PR #4 本地分支与独立 Loop Control bundle：插件测试 47 项通过；策稿构建、插件语法检查通过。真实隔离 DSH 中，由策稿界面确认并导出，Loop Control 面板显示等待接单；供给受控回执后，正确展示生产单链接、实际播放 2 秒 MP4 至结尾，Range 返回 206，未认证列表请求返回 401。这一步验证 Harness 浏览器，成片是受控样片。
- 另一份经同一 DSH Host 导出器实际提交的 v3 包 `tcw-1ff912c3a11998f0bb84c411b0c41ee8/v0001` 进入真实 Loop Control Owner HTTP 和 PostgreSQL：两次并发接单复用一张生产单，重启可复用；未认证、非指定 Owner、缺 CSRF 请求均被拦下；接单后生成任务数为零；同修订变更不覆盖，追加修订等待确认。
- 同一张隔离生产单完成实际 OpenChatCut 两镜头静态渲染。只导出或仅确认/排队时不返回成片。通过正式 Worker 实现执行已领取的交付任务（测试进程内，不是单独运行的生产守护进程）后，回写成片的字节数及 SHA-256 与正式导出一致；FFmpeg 全片解码通过；重启后交付结果不变。

实际交付取证：生产单 `06ce04ba-cff6-4e62-b24a-5e410a8ef3cf`，5.056 秒，260,238 字节，SHA-256 `0c6ef13e43e062341bd2c577c83eb09353e8960cd74278f8844c3bfc8077fbf3`。测试库、媒体和独立 SDK 副本已清理。

浏览器播放和正式生产集成分别验证，没有把受控浏览器样片当成实际生产出的成片，也没有测量线上负载下的状态延迟。

## 复验

从主项目运行 `node scripts/e2e/harness-handoff.mjs` 可用内置样包验收接单与回写。指定 `LOOP_TEST_OPENCHATCUT_ROOT` 指向隔离 OpenChatCut 副本可增加本地渲染和正式交付验收；指定 `LOOP_HANDOFF_GOLDEN_PACKAGE` 可改用实际 Host 制作包所在修订目录。需要本机 PostgreSQL 工具，非默认位置可指定 `LOOP_TEST_POSTGRES_BIN`。交接格式见 [交接规格](../specs/harness-loop-control-handoff-v1.md)。
