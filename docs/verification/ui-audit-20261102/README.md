# 全界面优化：隔离实测证据

结论、覆盖限制及新增清单见 [REPORT.md](REPORT.md)。原 U01–U76 与阶段约定见 [规格](../../specs/ui-full-audit-20261102.md)，跟踪项为 [Issue #196](https://github.com/DaNN-55/loop-control/issues/196)。

本目录的脚本是一次交互式审计协调器，不是自动证明产品全部通过的回归套件。它复制当前源码与 SDK，以既有真实故事夹具建立独立数据库、媒体卷、页面和 Worker，等待审计者操作并记录 T01–T08，最后清理资源。只在复制的浏览器夹具中暴露独立会话名，不修改产品入口或日常运行环境。

## 复用方式

1. 在项目根目录运行 `node docs/verification/ui-audit-20261102/run.mjs`。需要已安装的 Docker 镜像、Colima、Node、ffmpeg、agent-browser 与 SDK 依赖；脚本不下载新镜像、不安装依赖。
2. 等待日志输出 `AUDIT_READY` 及本次 `audit-context.json` 路径。该文件及 `private-control` 只留在临时目录，不发布。
3. 使用 `node docs/verification/ui-audit-20261102/control.mjs <本次上下文路径> <action> '<JSON>'` 操作本次现场。浏览器命令经 `browser` 动作传入 `args`；工作区命令用 `send`，原始 HTTP 用 `raw`。大工程可在 JSON 后附加 `summary`，完整响应仍保留在私有控制目录。
4. 用 `mark` 逐项记录八类结果及限制，用 `finish` 结束。协调器核对八个编号是否均有记录；记录可以包含失败或阻塞，不能据其退出码推断产品无缺陷。

掉盘时使用 `raw` 获取真实错误；`send` 会先读取并断言工作区可用，不适合验证读取失败。页面动作需等待真实加载完成后截图；每次切换窗口、布局或标签后重新取得可访问树。内嵌 SDK 的桥接 URL 不应直接作为独立顶层窗口测试，其结果不等同于正常嵌入使用。

## 证据边界

- `T01.json` 至 `T08.json`：场景结果、事实和限制。
- `screenshots/`：筛选后的合成故事截图，不含日常内容或真实凭据。
- `run.json`、`vitest.json`、`tests.log`、`snapshot-manifest.json`：运行、清理与源码身份记录。
- 原始请求、上下文、合成会话状态和未筛选工具输出留在本机临时目录；不进入 Issue 或公共证据。

本次仅保存基线 MP4 的验证结果、大小与 SHA-256；实际测试媒体随独立卷清理。没有保存日常数据库、密钥、用户媒体或 Keychain 内容。
