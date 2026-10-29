# #160 / T08 局部口播候选

本票已实现不可变候选、试听/比较/拒绝、显式采用为口播主声，以及可供 T09 复用的受限音视频增量采用边界。最终分支已合 integration `4c57ca2b`，保留 T06 实际可听主声投影、T10 稳定镜头/字幕 lane、T11/T12 保存与交付合同。

## 实际行为

候选从原 TTS 请求、任务输入和真实音轨投影，正文版本及冻结主脚本差异可查。未采用版本和正文草稿不污染实际已用正文。实际轨道关联不可变采用决定；历史 TTS 回退不可变任务输入，未知人工正文保持未记录。

采用绑定预期工程 SHA、稳定目标、实际 source/hash/range、当前创作输入和路由。live Studio 先复制已核验 bytes 到当前会话媒体目录并持久化 reverseSources，随后 inspect revision/SHA 双检查、目标实例增量变更、原生 ownership CAS 刷盘、Owner 不可变快照 CAS、追加决定。没有全源 relink、整期重建或关开 Studio。回执丢失可重启后确认已存采用，不重复生成。

source/none 下准备不改变路由；显式采用才切成唯一可听 TTS。短口播按实际长度结束，画面窗口保持；超长 keep-target 明确裁尾；完整时长策略提示延伸，不移动其它片段。保留原生 transform、fade、effects、transitions、其它 timeline、BGM/SFX/ducking 和已有环境声实例。实际源/窗口变化使受影响字幕核对过期，迟到对齐不能覆盖。

## 测试与真实产物

| 边界 | 最终结果 |
| --- | --- |
| Owner HTTP + 隔离 PostgreSQL + controlled Provider + 实际 loop_worker | 7/7 GREEN，25.25 秒 |
| 宿主、草稿跨工具保留、生产单、字幕、混音回归 | 14/14 GREEN；最终失权文案 Host 8/8 再验 GREEN |
| check / backend:build / worker:build / build / runtime:prepare | 全部成功；Vite 保留既有大 chunk 提示 |
| native MP4 前后差异 | 330→660 Hz；1.8 秒口播尾部 RMS .0311→0；解码视频 SHA 完全相同 |
| source→TTS 联合 MP4 | 实际 1080×1920 H264/AAC，4.458667 秒；660 Hz 保留、440 Hz 原声消失，110 Hz BGM / 880 Hz SFX 保留 |

7 个集成用例覆盖：历史与拒绝/重启；显式时长和手工编辑保留；Owner/CSRF、篡改字节和旧输入拒绝；仅受影响字幕过期及真实迟到 Worker 对齐；live 新媒体注册和先保存后采用；保存成功但决定回执丢失恢复；source/none 以及 muted 旧 TTS 的实际唯一主声路由。闭态采用只在实际内容改变时增加同一 native_edit_revision，live 保存不双加。

MP4 和数字证据在 [evidence](./evidence/)。`render-observation.json` 配套前后 MP4（180×320）仅证明局部声音差异和画面帧保持；`candidate-main-route.mp4` / `candidate-main-route-audio.json` 证明真实路由与其它声音保留，不作为最终 1080 画质批准。

## 实际浏览器与保存竞态

标准 Chrome 156 的独立合成 Owner/profile 验证了真实界面。此前 headed 前台矩阵已记录父/子 visibility，1280/800 各三轮属性开关可响应（`foreground-first-save-timeout.json` 中保存前数据）；最终 headless=new 同一标准浏览器完成候选 + 原生属性的 1280×720 / 800×720 各三轮、草稿跨字幕切换、原生 x17 编辑保存、source/none 两种起点真实 Worker 生成/音频控件试听/采用、拒绝及刷新恢复。最终矩阵父子均 visible，双 rAF 最大 102.4 ms；见 `final-ui-route-and-matrix.json`、两份 `final-*-adopted-workspace.json`、`final-refreshed-workspace.json` 和截图。harness 在采用完成到控件 finally 落定间曾过早操作 disabled 字段，等待 settled 后继续；这不是采用失败。

保存故障有独立 RED：文档已显示、SDK ownership 尚无，先选中/编辑使 live baseRevision 变化，实际 `/api/external-agent/register` 持续409（stored x0 / pending x17），flush 等 ownership 15秒。已先保留原生未存文档及6份媒体/hash清单，再结束该专用夹具。

最小 GREEN：真实延迟 external-proposal GET hydration，ownership=false 时 iframe inert + 覆盖，保存和选择禁用，前后 inspect 指纹相同；释放原响应后 register200、真实写就绪、选择→原生 x17→flush→Owner save200。父子 visible，双 rAF 约62–65ms，见 `initial-ownership-gate.json`。不修改 SDK，不删 ownership/CAS，不扩大超时。

两个受控 GUI 客户端另验证：最新窗口保存新 native 版本，旧窗口 SDK 真实 register409 后禁写，原生 doc、未提交文字仍保留，两个窗口可响应，当前已提交 SHA 不变。旧窗口在 Owner 写请求之前已被禁写，不把这条结果写成 Owner save409；HTTP 集成另覆盖旧 Owner/输入冲突。见 `two-client-ownership-conflict.json` 与两份实际 native document。

此前 Chrome153、大量调试会话、隐藏/遮挡窗口及不正确的属性按钮点击混有无效样本；旧 trace 没有可信 CPU 采样。不能据此归因 Chromium、React-Aria 或 CSS。所有无效产品布局实验已撤回，保留 T10 原布局，新增样式只有连接门控覆盖层。大 trace 位于临时诊断目录，清单在 `diagnostic-trace-locations.json`，不作为正式性能 GREEN。

## 接续边界

T09 复用接口和来源/输入责任见 [CONTRACT.md](./CONTRACT.md)。新增 workspace-local shot 的首次 TTS 仍受旧087冻结分镜 membership 拒绝，真实 insert200 / saveNarration400 已报告，按 root 分工由 T13 接续，不能把本票 existing-shot GREEN 扩称该能力完成。

本票没有运行付费 Provider、修改日常 DB/Keychain、推送或关闭 Issue。全部写入在随机数据库、媒体目录、端口和专用浏览器内。root 的普通入口 IAB 与全票整合验收尚由 root 独立执行。
