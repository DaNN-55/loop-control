> 终验补记：最终 Spec 已确认本票可在文中限定范围关闭；实际凭据扫描 9 个值、2 个批准引用、153 个文件均无命中，正常服务及自有浏览器已关闭、Keychain 已锁回。正文中的待收尾事项属于先前交接状态，当前状态以最终进度和关票读回为准。新增公开材料另作离线摘要复核。

# #142 同一生产单最终接续验收

同一测试 Owner、同一 Episode `5eb48e39-6c99-4c95-b3ab-ed91dea7d3e7`、同一蓝图 `e9fd2ae1-bc44-4929-991b-4b3325220baf`，已通过正常入口完成真实规划、Pexels 素材、豆包短句、本地对齐、预览、Studio、测试 Owner QC、final 和本机发布包。正常重启后状态为 `production_completed`，生产单投影完全一致，21 个产物的 Owner HTTP 字节与磁盘逐项相符。最终 Spec、凭据扫描、索引和 Issue 读回仍由主 Agent 收尾，本文不自行关票或关闭 A–D 总门禁。

## 同单链与实际调用

| 环节 | 实际结果 |
| --- | --- |
| 正常配置与规划 | 041 在真实规划前修复共享模型/Harness 冻结。两项 CLI 任务分别生成本次视觉清单和分镜，互相引用冻结输入；恰好 2 项，桥接累计 138,642.003ms，低于 180,000ms，无自动重试 |
| Pexels | 复用本轮 #145 同 Owner 已真实验证的当前连接版本，仅正常读取确认并冻结；本票真实搜索、下载各 1 次，均为 200，没有重复验证 |
| 豆包 TTS | 本票验证、生成各 1 次，均为 200；音频 SHA-256 `69da3e47a43535f8e78d28497fd6ca3ced926a2fa9843300014bdaba07bbaa4f`，10029 字节 |
| 正文与时长 | Owner 已真实试听并确认「看见自然。」，接受 1.248 秒短样本；分镜计划仍为 2 秒，`planDelta=-0.752s` 保留，没有改写已批准分镜 |
| 本地 clip 与对齐 | 原 clip 因遗留 Pexels 引用误判为外部执行而两次失败，均保留。最终源码经正常新任务重试完成 clip，并接续同单真实对齐、身份绑定的正文确认及预览 |
| 预览与 Studio | Chrome 中同步预览和审核视频均播放至结束，1080×1920，无播放错误。Studio 通过正常当前 revision 写入并读回，将主 TTS 音量从 1 调至 0.9，实际页面可见 |
| QC、final 与本机包 | 主 Agent 完成实际检查后，以授权测试 Owner 的正常 API 批准；final 完成，本机发布包校验通过，相同 idempotency key 的重复提交返回相同结果 |
| 正常重启 | 同一生产单仍为 `production_completed`，投影完全一致，21 项产物 HTTP/磁盘一致；两个调用账本不变，无新增 CLI/Provider 请求 |

本票独立 Provider 账本合计 4 次：Pexels 搜索/下载 2 次，豆包验证/生成 2 次；保守预留 100000 microunits，即 0.10 元。这不是外部最终账单。#145 的 Pexels 2 次属于另一账本，没有互借。在线策略已自然过期且未延期、重置或退款；后半链只做本地操作。

## 本地检查与 QC 的真实身份

主 Agent 实际检查了 0.2、0.65、1.0 秒的三帧，核对自然场景、1080×1920 画面及字幕「看见自然。」；视频完整解码无错误。音频与 Owner 已听取的真实 TTS 源作比对：初次粗搜索约 0.4864，失败记录保留；随后在 ±100ms 全整数采样偏移范围作 FFT 互相关，最佳偏移 0.0426875 秒，相关系数 0.990402，继续使用 0.95 阈值。

QC 收据的身份为 `checkedBy=agent`、`testOwnerActionAuthorized=true`、`humanViewingClaim=false`。这是 Agent 实际检查后按授权使用测试 Owner API 的批准，不是人类 Owner 看过 QC 视频的事实；Owner 真实试听音频的既有回执不扩写成视频观看回执。

审核及最终视频 SHA-256 均为 `299c3860d3e96eb08f4feb29c08b9ff4abfac3ec13c2a0737a1b3fc6dbcf9651`，914414 字节。本机发布包 manifest 为 1222 字节，SHA-256 `5b4713b725f6ee965674856e3e593b34b9ce2fa5f30b975a6ca4d0069baf649c`。只形成本机包，没有外部上传或发布。

## 最终源码连续性

[最终 43 项源码清单](source-final-native-local-followthrough.json) 的聚合 SHA-256 为 `207c8547fba52862d4e9bf535605f7b41d23c15d343dd4ee701b98abeb1852a8`，HEAD 仍为 `bbd2987`，未提交。不能声称整条成功链从开始便运行于这个完整 SHA。

041 在两项真实 CLI 前应用。其后发现本地裁剪分类、首次 TTS 启用时序、自动任务 namespace 和裁剪预检缺口；这些改动按 C18 分类后验证。Provider transport、旁白 Worker 与前段快照逐字节一致；注册 Adapter、受控媒体 executor 和对齐 Worker 与基线一致，已成功的前段事实由这些未变模块、冻结输入和产物身份继承，没有重发。

受影响的 clip 在最终源码下以新任务 `cb4446b0-19ad-4811-b6bb-e18f8c7d8380` 完成，后续 preview、review `f5ed5d41-059a-4f9a-961a-5d1aa322a37e`、final `e92bd34a-ddbd-492b-96af-fe57057fc4a7` 和本机包均形成同单连续证据。042 只规范未来新任务，既有 TTS/自动对齐任务没有被回填为新 namespace。正常重启和 21 项逐文件校验验证了最终源码对这些既有已接纳结果的继续读取。

## 预检范围与原围栏

纯本地 clip 不再因快照遗留引用而走外部执行，执行范围由已注册 Adapter 决定。在线策略过期后，也不能借本地操作首次开启广域媒体授权：命令先以 `SELECT media_enabled ... FOR UPDATE` 锁住 input row，仅已经启用的范围允许本地预检，且不写 dispatch flags；首次启用仍走原完整 preflight/媒体检查。

真实 Owner HTTP/PG 三项回归验证了未启用且策略过期时 409、实际 native planner 新建任务为 0、指定外部 task 的 claim 为空、零 secret/transport；既有启用范围的本地调用返回 200，完整 input row 不变。前序两份 hard 报告保留，最终 Standards 已确认关闭；它们不能被成功后半链抹去。

在所有产品补修之后，裸 `npm test` 为 113 文件、894/894，默认 5000ms；构建和 TypeScript 检查通过。另有真实 HTTP/PG、namespace、claim 和回滚专项结果，不能混作默认测试数量。正常未登录 401、外账号 404、缺规划配置、缺执行命令、本地坏输出和旧 failed attempt 回调拒绝均有独立证据；真实远端认证失败未追加调用，不计通过。

原错误模型任务、本地 clip 失败任务及其 4 条 failed run 保留，既有行、结果、attempt、executor 未变；重启后两个账本仍相同。两段新增调试 raw 缺失、音频初次比对失败及其他边界见 [证据缺口说明](evidence-gaps-current.md)。不能泛称所有失败 raw 完整保留。

Google TTS、Cloudflare、OpenAI 与不可用 Freesound 的在线测试为 Owner 批准跳过，不计通过。SQL #146/#147 继续暂缓；没有提交、推送或进入 E/F，也没有以本票的本机短样本替代 F 的容量、性能或生产切换验收。
