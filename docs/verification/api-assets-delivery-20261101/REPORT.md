# 真实 API 素材采用至交付验收

2026-11-01，生产单 `79eb3098-8733-472a-9bde-873edd4cd26c`（视频 API 逐项真实生成 · 1101）。已完成，刷新后仍为 `production_completed`；没有新增 Provider 生成请求，交付任务费用 0，活动任务 0。

## 实际验证

- 本轮开始时四项素材已采用；核验现有采用记录，未重复采用。镜头依次为 Seedance 替代图 4 秒、MiniMax 真实视频 4 秒、百炼真实视频 2 秒、Kling 替代图 3 秒。原采用来源、四项文件 SHA 和导出来源完全一致。
- 原生剪辑中将首镜头缩放设为 105%，保存、返回并重开，真实工程读回一致；最终 v8，native_edit_revision=5。保留既有静音和四组独立手工字幕，没有新增口播、音乐或对齐任务。
- 真实导出一次成功：1080×1920、30 fps、390 帧／13 秒，容器 13.056 秒，6,148,396 字节。5/5 技术检查通过，完整 FFmpeg 解码、四镜头实际抽帧及浏览器从头播放至 `ended=true` 通过。
- 显式确认最终文件和四组手工字幕，使用现有 Seedance 替代图作封面，填写标题／简介／标签后运行真实本地交付 Worker，任务 `1f2e3654-037f-43bd-800d-810f165d2e2e` 完成。未对外发布。
- 六项交付文件（视频、工程、封面、元数据、检查证据、清单）的磁盘字节及 SHA 全部通过；五项非视频文件浏览器 HTTP 200 正文 SHA 通过。视频有 HTTP 206 和完整播放证据；IAB 直接视频文档暂停响应导致 CDP 不可用，未将视频浏览器正文 SHA 计为通过。
- 原账号及预算、另外两张生产单及工程、全部基线工程文件字节均未变。完整断言见 [final-assertions.json](final-assertions.json)。

## 文件与日志

- [成片](files/final.mp4)、[可编辑工程](files/project.json)、[交付清单](files/manifest.json)、[六项文件身份](delivery-files.json)。视频 SHA：`b064c33a19e8e2302378eebc1b2a1c4a93f42892f2d0c6ee42b2ea941efa7453`；项目 SHA：`5403d47d6535bf0ba4689449beb3e453a47a6d6705820e09969ce1fbcb984f45`。
- [生产文件清单](production-files.json)：42 个文件，19,517,613 字节，原生产目录完整保留。
- 24 条页面操作／状态记录、1793 条脱敏网络元数据、应用运行日志、浏览器控制台、私有 DB 原始快照均保留。原始 DB 和运行日志在 `.loop-control/maintenance/api-assets-delivery-20261101/`，公开证据已移除敏感字段。
- [播放完成证据](export-playback.json)、[HTTP 正文验证](http-downloads.json)、[完成截图](delivery-completed.png)、[抽帧1](final-shot01.png)、[抽帧2](final-shot02.png)、[抽帧3](final-shot03.png)、[抽帧4](final-shot04.png)。
- 测试页 9／10 随中断结束；继续验证使用独立页 11／12，现已关闭。浏览器仅保留原用户页 1，未导航或关闭它；临时 620px 布局验证尺寸已恢复。

## 发现与限制

流程未发现阻断问题。两处现有细节未改动：原生素材名称仍含“待匹配画面”，但实际已采用正确来源；首两镜头字幕换行欠佳（第二镜头句号单独换行），没有裁切或缺字。这是素材连通性测试片，保留现有字幕和静音配置。

前半段原生编辑截图曾与背景页状态不一致，相关截图仅作辅助记录；采用 DB 文件读回、导出文件、实际抽帧、播放证据和本次刷新完成截图为验收依据。详见 [browser-tool-boundaries.log](browser-tool-boundaries.log)。

本次续跑没有业务逻辑修复；后续按用户批注完成路径菜单与账号资料标题布局调整，见 [布局报告](../directory-account-layout-20261101/REPORT.md)。未提交 Git、未重启日常服务。
