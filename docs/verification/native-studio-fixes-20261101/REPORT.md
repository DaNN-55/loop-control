# 原生字幕定位修复与导出、进程生命周期复核

日期：2026-11-01。承接 [上一轮 E2E](../issue-178-main-e2e-20261101/REPORT.md)。OpenAI 不测试，本轮不调用生成 Provider、不充值、不更新日常数据库或重启日常服务。实际素材和原生 SQLite 工程来自上一轮的隔离副本。

## 结果与边界

| 项目 | 本轮结论 |
| --- | --- |
| 字幕跨 lane 定位 | 已复现并修复；实际 SDK 组件的选中、删除、裁剪、拖动、锁定保护和不支持版本的拒绝检查通过。浏览器编辑已持久化到 SQLite，重新加载后保留。 |
| SDK 导出无反馈 | 未复现原来的「没有任务也没有错误」。独立页面、带相同 sandbox 的嵌入页面实际导出成功；素材缺失时显示失败任务和具体原因，恢复素材后重试成功。没有据此修改导出逻辑，也不能追认历史现象的根因已确定。 |
| 隔离服务退出 | 找到原执行器的异常结束记录，并验证前台命令组被回收会使服务消失；独立进程组启动可避免此种连带退出。历史具体终止信号和触发者未记录，仍不能证明是执行器回收、系统杀进程或应用崩溃中的哪一种。 |

## 字幕根因与修改

原 SDK 的 `manualCueTargets` 仅用 `cueId` 作 Map 键；分页调用又丢失 lane 身份。两个合法镜头都包含 `phrase-1` 时，第一镜头的选中及删除均实际指向第二镜头，出现重复 React key。原始 SDK 最小复现输出为 `["shot-two","shot-two"]`，断言预期为 `["shot-one","shot-two"]`。新增组件回归在修复前也分别捕获错误选中和错误删除。

沿用项目现有的运行时适配方式：Map 改用 `JSON.stringify([laneId, cueId])`，时间线改用保留 lane 身份的 `buildCaptionPages`。生产单嵌入入口与独立 Studio 入口都应用此适配；缺少预期 SDK 接点时明确拒绝，不静默保留错误行为。没有改写字幕 ID、历史工程或安装的 SDK 源码。

实际浏览器中，以键盘裁剪第一镜头字幕结束时间，1204 ms → 1171 ms。SQLite 读回及重新加载均一致；第二镜头的字幕正文、时序和其他元数据不变。SDK 同时补齐了既有数据缺少的 `trackOrder`，此规范化单独记录，不冒充整组字节完全未变化。见 [读回结果](caption-ui-readback.json)、`captions-before-ui.json`、`captions-after-ui.json`。

两个实际运行入口的四份转换后模块均 HTTP 200，并实际含有 lane-qualified 查找，见 [入口读回](entry-transform-readback.json)。SDK checkout 前后均无改动，基线为 `72ddb33` / v0.2.17。

## SDK 导出复核

实际运行 `scripts/openchatcut-embedded.mjs`，使用独立数据与缓存目录。浏览器通过独立页面，以及带 `allow-scripts allow-same-origin allow-downloads` sandbox 的跨 origin iframe 操作实际 SDK。

1. 独立页面导出：任务创建、进度、完成状态和 MP4 下载均出现。
2. 嵌入页面导出：复用上一轮 720p 设置，任务完成并实际下载 MP4。
3. 第一镜头字幕修改后，临时移开隔离副本中的视频；选择本机 ProRes 导出，实际预检产生 `missing_source` / HTTP 404，界面显示失败任务、具体路径及重试按钮。随后立即恢复文件。
4. 改为 H.264 720p，点击「重试」，新任务完成并下载修改后的成片。

最终文件：[after-caption-edit.mp4](after-caption-edit.mp4)，1,240,268 bytes，SHA-256 `11c66e6cec53bb4c8d478051c232beef400b1c7c6bc2614c660309a5b19404e5`。实际解码为 720×1280、30 fps、99 帧、H.264 / AAC，容器时长 3.370667 秒。黑帧检查未发现至少 0.1 秒的黑场；代表帧可见第一镜头字幕。这是 SDK 直接导出复核，没有重新生成上一轮的正式 Owner 交付包。

- [完成截图](sdk-embedded-export-completed.png)、[失败提示](sdk-export-missing-media-error.png)、[重试完成](sdk-retry-completed.png)、[实际代表帧](after-edit-frame.png)。
- [失败反馈读回](export-failure-feedback.json)、[下载文件指纹](download-readback.json)、[修改后文件指纹](after-edit-export.json)、[媒体检查](after-edit-ffprobe.json)。

首轮在限制外部域名且未启用 WebGPU 的自测浏览器中，导出曾停在 98%，同时记录 `www.remotion.pro` 被浏览器限制的请求；已取消任务。随后使用正常 WebGPU 浏览器复核成功。此处同时存在两项环境差异，不能单独归因网络或 GPU，也不能用它解释上一轮「没有任务」的现象。最初浏览器 CLI 对 iframe 的定位反馈也不稳定，后续使用同一自有浏览器的 CDP 指定 SDK frame 并发送真实输入事件，核对了实际 DOM 和文件。

## 服务退出证据与启动方式

旧 PID 60977 由 `exec_command` 前台启动，关联执行会话 75977。执行器在 2026-10-31 22:05:51.112 UTC 将命令记为失败，结束码 `-1`，持续约 723 秒。此前应用最后 HTTP 记录为 22:05:50.707 UTC；未记录应用的正常停止事件或致命堆栈。相关 macOS DiagnosticReports 未找到匹配的 Node 崩溃报告。见 [提取的执行记录](previous-process-execution.json)。这些证据表明命令异常终止，但没有保留 OS 信号或发起者。

对实际 SDK 服务建立两组独立进程验证：服务先返回 HTTP 200，再终止仅属于该实验的父命令组。前台子进程随后不可访问；设置 `detached` 并分离日志、调用 `unref()` 的子进程仍返回 HTTP 200。所有实验进程均在验证后关闭。见 [生命周期结果](lifecycle-results.json)；对应 `lifecycle-parent.mjs` / `lifecycle-check.py` 保留实际复现脚本，路径只指向本轮私有测试目录，不应直接改成日常目录。

本轮实际 Studio 和测试 host 使用独立会话、文件日志和明确 PID 启动，跨多次工具调用继续运行。日常 `scripts/runtime/start.mjs` 原本已经采用 detached / file stdio / unref，本轮增加回归断言锁定这些行为，没有对未知历史原因增加自动重启或更改日常进程管理。后续隔离验收不得依赖 Agent 前台执行会话承载长期服务。

## 验证与保留事项

- 默认回归：177 文件、1157 项通过，见 `default-regression.log`。
- 最终定向回归：6 文件、23 项通过，覆盖字幕实际 SDK 组件、布局、拖动适配、编辑连接重试、素材导入与启动契约，见 `targeted-regression.log`。
- 三个生产脚本 `node --check` 通过。没有运行会覆盖日常编译产物的构建。
- OpenAI 和所有生成 Provider 本轮调用为 0；使用已有隔离素材和工程。
- 本轮没有重新执行全部新建账号到交付流程、32 个此前排除的集成文件、长片或并发生成验收。上一轮 WhisperX 冷启动问题仍未处理。
- 字幕修复只作用于 Loop Control 装配的两个 SDK 入口，不是上游 SDK 的发布或独立桌面应用升级。现行已打开的编辑器需在保存后重新打开才能加载适配。

历史 SDK 无反馈及旧进程终止的精确原因仍未确定，应保留为未闭环的诊断项。本轮已经验证当前成功、失败、重试与进程隔离边界；不能宣称三个历史问题全部根治。
