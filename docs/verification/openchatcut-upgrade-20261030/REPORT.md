# OpenChatCut 0.2.17 升级与工具行迁移

2026-10-30。新版先在独立目录完成验证。用户确认“全部已保存并退出，可以切换”后，已激活0.2.17、完整保留0.2.14备份，并将常驻片段工具移入默认收起的“镜头设置”。

## 激活后的验证

- 当前路径 `.loop-control/local/OpenChatCut` 为0.2.17；旧版完整保留在 `.loop-control/local/OpenChatCut-v0.2.14-backup-20261030`。记录：`activation.json`。
- 官方克隆目录初始权限755触发既有本机私有路径检查；仅将SDK根目录收紧为与旧版相同的700，未放宽检查。5174服务已重新启动。
- 切换前备份用户最新保存的三个工程，切换后逐字节SHA全部一致。见 `projects-before-activation.json`、`projects-after-activation.json`。
- 173文件、1163项普通回归；39项定向/实际SDK集成；构建和运行包准备全部通过。日志位于本目录。
- 右侧真实日照原单加载的完整内容指纹与用户最新保存版本一致。字幕实际右移45px、上移40px，一次撤销恢复用户原有偏移；保存后再次核对指纹一致。见 `upgraded-pointer.json`、`native-before-pointer.json`、`native-after-pointer.json`。
- 常驻工具行已消失。“镜头设置”保留整镜构图、平台时长规则和受保护删除引用；原生重复的片段选择、起终帧、填充、位置和转场入口移除。时长规则明确不限制原生时间线修剪。
- 右侧展开/收起补充工具时，iframe的真实 `backendNodeId` 保持71693，未重载编辑器。见 `frame-identity.json`。
- 新版连接连续观察176923ms，14个原生轮询响应，0个409、0次重新注册。见 `upgraded-connection-stable.json`。
- 实际点击到首次可编辑消息为11404ms，第二轮10879ms；拆分为后端准备1831ms、原生文档14ms、前端页面加载约8.74秒、注册140ms。修正Vite的绝对预热路径并预热Editor入口后10347ms。修复重复复制相同素材造成mtime与预览cache失效后，右侧实际重新打开为3566ms，较首轮缩短约69%。这是本机本工程的一次复测结果，不是首次安装或所有工程的时延保证。见 `open-phase-summary.json`、`open-warmup-only.json`、`open-cache-reuse.json`。
- 相同内容通过实际文件SHA比较后跳过复制，保留mtime与SDK波形cache；内容不同即使大小/mtime一致仍更新。软链接、硬链接拒绝和两次来源验证继续有效。实际SDK回归4项通过，见 `media-cache-results.json`、`targeted-final.log`。本次未采用跨调用跳过校验或永久保持编辑权。
- 最终真实编辑器的完整内容指纹仍为用户最新保存的 `d381bff469e81c20694508a0f156c5384cedb28ca60938179cb2210de6f0ff8d`；新排序、效果、字幕偏移均保留。见 `native-after-cache-reuse.json`。
- 最终实际上下滚动，主工作区前后均800px；计时用临时监听已移除。见 `final-height.json`。

临时计时监听已移除；未生成或交付真实内容，未提交或推送。普通全量回归与定向集成均通过；此前SDK集成组中有1项旧URL断言仍期待 `/#/editor`，实际既有入口为 `/?lcBridge=1#/editor`，保留原始失败记录，没有改断言掩盖。

## 版本与来源

| 项目 | 结果 |
| --- | --- |
| 升级前安装 | 原为0.2.14，无独立 `.git`；现完整保留为旧版备份目录 |
| 当前安装 | `.loop-control/local/OpenChatCut`，0.2.17；由已验证暂存目录改名激活 |
| 官方 tag | `v0.2.17` |
| 提交 | `72ddb3300cda4ed31cbd0bccbfc94fb29b8cffca` |
| 锁文件 SHA256 | `0bafda2fd9108b96e725f856899388cd4150a6127307c5a18f3a3c1d5959f6a3`，安装前后不变 |

版本与发布说明来自 [官方 v0.2.17 release](https://github.com/0xsline/OpenChatCut/releases/tag/v0.2.17)。源码使用固定 tag 的浅克隆，稀疏检出仅排除 `assets/readme-pic` 文档截图；全部运行代码与运行资源保留。旧安装完整保留，没有覆盖其中的文件。

## 安装与验证

- 按官方锁文件执行 `npm ci --no-audit --no-fund`，安装 814 个包。耗时约 14 分钟，主要是官方 registry 的大型 ONNX 包和 FFmpeg 二进制下载。
- 浏览器集成不使用 Electron 应用二进制，因此安装时设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。未改项目根依赖或 SDK 锁文件。
- SDK TypeScript 6 类型检查通过，Vite 8 生产构建通过。构建使用独立数据目录与合法 UUID v4 开发 profile；最终构建清除了外部 Provider 环境变量。
- MediaPipe WASM 和两个模型通过官方同步脚本准备，模型尺寸与 SHA 校验通过；shader 源码一致性、工具目录一致性检查通过。
- 官方 `captionPreviewTarget`、`captionSelection`、`external-bridge-attempt-error`、`projectStoreTransport` 四组验证通过。最初 `tsx` IPC 被沙箱 `EPERM` 阻止，允许本机测试管道后重跑通过。
- 本项目以新版 `OPENCHATCUT_ROOT` 运行五个测试文件，共 15 项通过：字幕槽位编辑 4 项、连接重试 6 项、Studio 打开校验 3 项，以及新版素材导入保护、未知接点拒绝各 1 项。
- 新版 ONNX 原生模块可加载，FFmpeg 可执行并报告 `6.0`。未调用生成、转写或其他付费接口。

日志位于本目录 `logs/`。未运行 OpenChatCut 完整测试门禁，也未准备 Electron 桌面安装包或新增 Whisper CLI；这里验收的是 Loop Control 使用的源码浏览器集成。

## 嵌入兼容性

`patchCaptionDrag`、`patchCaptionLayout`、`patchCaptionInspector`、`patchEditorBridgeRetry` 四个严格源码转换均通过。0.2.17 仍存在字幕写 sourceEntry、渲染读 slot，以及连接冲突后自动重新注册的原始行为，因此本轮兼容修复仍需保留。

首次真实 HTTP 冒烟发现 `src/media/useEditorMediaIngest.ts` 返回 500，其余 9 个模块为 200。新版把 `ingestToPool` 签名改为 `(asset: MediaAsset, durationFps?: number)`，并把同名冲突与导入执行提取到了 `src/media/poolImportRun.ts`，使旧版适配器的严格接点失效。主 Agent 已新增双版本导入适配，保留在同名冲突提示和 placeholder 修改前重定向到宿主的约束。素材导入实际 SDK 回归通过；重启本轮一次性冒烟服务后，包含新 `poolImportRun.ts` 在内的全部 11 个模块均为 HTTP 200。首次失败日志保存在 `logs/adapter-http-smoke.log`，最终结果见 `adapter-http-smoke.json`、`logs/adapter-http-smoke-final.log`。

## 配置与数据

- 仅按路径检查旧安装，发现候选 `.mcp.json`、`.env.example`；未发现实际 `.env`、`.env.local`、`.npmrc`、`settings.json`、`keystore.json`、安装根内 `data/media/project-store`。
- 按主 Agent 指示只比较 `.mcp.json` 的字节哈希。已安装文件、官方 0.2.14、官方 0.2.17 完全相同，没有复制旧配置覆盖新版。没有读取或输出配置内容。
- `shared/project-version.ts` 与旧安装相同。未执行真实工程格式迁移。
- 子agent准备阶段未读写真实工程；主Agent最终切换前备份并核对了用户最新工程，切换及最终测试均保留用户新镜头排序、效果和字幕偏移。外置媒体与凭据不作升级迁移。
- 官方 0.2.17 的原生 Doubao TTS 改用新音频 API 与 API Key 配置。平台自身火山 TTS 适配和既有凭据不随此次 SDK 升级改写；本轮没有迁移、显示或测试这些凭据。见 [官方发布说明](https://github.com/0xsline/OpenChatCut/releases/tag/v0.2.17)。

## 最终切换与回退步骤

前置条件：嵌入全部模块验证通过；用户已保存新修改，并退出所有使用旧 SDK 的编辑器；主 Agent 已核对相关 Vite 进程退出。目录切换期间不打开新的剪辑任务，避免运行进程经 HMR 混用新旧源码。

1. 记录用户最新保存工程的文件指纹。保留全部外置工程、媒体和历史文件。
2. 将当前 `OpenChatCut` 重命名为一个尚不存在的旧版备份目录，例如 `OpenChatCut-v0.2.14-backup-20261030`。
3. 将已验证的暂存目录重命名为 `OpenChatCut`。两个目录须为同一父目录下的普通目录；第二次重命名失败时，立即把备份恢复到原路径。
4. 保持部署配置中的固定 SDK 路径不变，重新打开编辑器。核对版本、连接稳定性、字幕拖动、保存重开以及用户的新排序与效果。
5. 如果验收失败，先退出新版编辑器，再保留新版目录并把旧版备份恢复为 `OpenChatCut`。不要用旧工程文件覆盖用户最新保存内容。

以上步骤已由主Agent在用户保存确认后执行；准备阶段的 `stage-ready.json` 保留原始 `activated:false`，实际激活状态以 `activation.json` 和本节记录为准。

## 右侧截图

独有功能移入默认收起的补充工具：

![镜头设置](/Users/dan/Programs/loop-control/docs/verification/openchatcut-upgrade-20261030/screenshots-tools.jpg)

升级后真实字幕拖动：

![升级后字幕拖动](/Users/dan/Programs/loop-control/docs/verification/openchatcut-upgrade-20261030/screenshots-upgraded-drag.jpg)

最终实际界面（补充工具默认收起）：

![最终编辑器](/Users/dan/Programs/loop-control/docs/verification/openchatcut-upgrade-20261030/screenshots-final.jpg)
