# 真实 WhisperX 离线成功推理验收

2026-10-25，Asia/Shanghai。本地基线 `bca697bbc1e12626771d1283ec87a17bf85f02fe`，固定 worktree `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`。

**指定中文模型在本轮已准备的隔离环境中完成真实离线推理，并通过 Owner HTTP→持久队列→实际 Worker CLI→模型→数据库/文件→HTTP 产物及浏览器同步预览验收。** 本轮仅补环境与证据，没有修改产品源码、SQL、超时、置信度阈值或测试断言。首次冷启动超时、错误正文反例及所有中间失败保留；不关闭新主机冷启动或任意正文错误检测门禁。[验收摘要](evidence/whisperx-real-inference/verification-result.json)

## 范围与准备

用户仅授权必要依赖和指定模型下载；下载完成后封存，推理与验收禁止出网。没有调用在线 Provider、Keychain 或在线 TTS，没有进入 E/F、提交或推送。SQL 一致性建议继续暂缓。

- Python 3.11.15 专用 venv；WhisperX 3.8.6、torch/torchaudio 2.8.0、torchvision 0.23.0、transformers 4.57.6。共 102 个包，完整版本及上游 WhisperX 源码 SHA 见[依赖记录](evidence/whisperx-real-inference/dependency-lock-result.json)与[固定版本清单](evidence/whisperx-real-inference/requirements-pinned.txt)。未改系统 Python、项目依赖或 lockfile。包版本清单不等于跨平台 wheel 内容锁定。
- 模型固定为 `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`，revision `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd`。只下载四个必要配置文件及 `pytorch_model.bin`，权重 1,276,296,151 字节，SHA-256 `de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4`，与官方 LFS SHA 一致。[模型来源与逐文件摘要](evidence/whisperx-real-inference/model-download-result.json)
- WhisperX 中文对齐仍会使用 English Punkt 分句后备路径，准备阶段从官方 NLTK 数据仓库下载并提取所需四个文件，避免推理时自动下载。[分句数据](evidence/whisperx-real-inference/nltk-preparation-result.json)
- 2026-10-25 **04:24:53.975724 UTC** 封存准备，后续没有下载。模型、分句文件及上游代码在收尾逐项复核 SHA。[封存回执](evidence/whisperx-real-inference/preparation-sealed.json)、[最终推理审计](evidence/whisperx-real-inference/inference-audit-result.json)

从已停止的 `loop_t24_restore_dclose02` 克隆到专用 `loop_t24_restore_whisperx20261025`，配独立 APFS 媒体、缓存、合成 Owner 密码和 55189 端口。仅启用目标 Episode 的离线执行资格，保留原批准状态。正常应用工厂 `createNativeApplication` 和其真实 handler、队列、Worker 执行器未替换；HTTP/UI 使用本轮专用 Vite 壳加载该工厂，**不是重新验收正式 npm 部署启动或新主机安装**。私有 `server.mjs`、`deployment-private.json` 和完整 HTTP/DB 快照列在总索引。

样本复用 T20 已有本地 macOS 声音生成的中文短音频；没有调用在线 TTS。正文 `这是本地字幕验收。`，4.046 秒，SHA-256 `26f49a501b9185e6f6a2f1b0e52c561a56717d361c7bf05e8f399593de7c74f3`。旧手工对齐产物仅作为历史，不作为本次模型证据。[样本摘要](evidence/whisperx-real-inference/sample-prepared-result.json)

## 离线边界与真实模型证据

模型阶段，Node 应用/Worker 使用现有本地离线 guard，仅放行本机数据库/验收端口；所有 Python 模型进程独立运行在 macOS `sandbox-exec` 的 `deny network*` 策略下，连 loopback 也禁止。另加 Python audit hook 和 HF/Transformers offline 环境。OS 负向验证对 IPv4/IPv6 loopback 及文档保留地址均在连接前返回 EPERM。[OS 验证](evidence/whisperx-real-inference/os-network-denial-result.json)、[策略](evidence/whisperx-real-inference/no-network.sb)

观察器调用原始 `whisperx.load_align_model` 和 `whisperx.align`，原值返回，没有替换模型输出。实际加载 `Wav2Vec2ForCTC`，319,029,295 参数，CPU、zh、`model_cache_only=True`。六份真实字符对齐原始 JSON、全部进程日志及各自 SHA 可核对；所有模型调用均在封存后，Python 网络尝试为 0。[观察器](evidence/whisperx-real-inference/offline-entry.py)、[审计及原始文件索引](evidence/whisperx-real-inference/inference-audit-result.json)

macOS 不允许已受限父进程再次嵌套 `sandbox_apply`。第一次将应用也套 OS 策略导致模型 preflight blocked，exit 71 和观察超时保留；模型阶段恢复为 Node guard + Python 独立 OS 全断网。[原错误](evidence/whisperx-real-inference/nested-sandbox-01.log)、[纠正说明](evidence/whisperx-real-inference/nested-sandbox-correction-result.json)

全部模型调用结束后，渲染/浏览器阶段改为**整个应用、Worker、renderer 和浏览器进程树 OS 只放行 loopback**。渲染器需临时本地端口，因此子进程的四端口 Node 测试 guard 由 OS loopback 策略替代；没有在此阶段再启动模型任务。首个 IP 匹配策略编译失败保留，最终策略允许 localhost、拒绝非本机地址的验证通过。浏览器另有限定 `127.0.0.1` 域名，使用独立会话；因外层 OS 沙箱，Chrome 内层使用 `--no-sandbox`。未宣称整台主机断网。[阶段说明](evidence/whisperx-real-inference/render-phase.json)、[OS 策略验证](evidence/whisperx-real-inference/loopback-os-policy-result.json)、[策略](evidence/whisperx-real-inference/loopback-only.sb)

## 实际结果

| 验收路径 | 结果与证据 |
| --- | --- |
| probe / 直接推理 | 准备后的新进程在原 30 秒 probe 限制内用时 6.544 秒；实际推理 5.416 秒，`completed/local_whisperx`，0 review issue。没有接受均分补位时序。[probe](evidence/whisperx-real-inference/probe-02-result.json)、[直接推理](evidence/whisperx-real-inference/direct-inference-02-result.json) |
| 正常 Owner 入口 | 实际 task `cd7c8c76-80dd-4a5f-81b4-5b0f59f84b83`，attempt 1、恰好 1 run；内层 acoustic alignment completed，冻结文本/音频/版本匹配，非仅外层 task completed。字幕 60–4006ms，置信度 0.982125，0 review issue；HTTP 取回 964 字节，SHA `aa15a1049df7b27d8075dda81739105f6c59eae17985f81f588f13cc7a0d3576`。[HTTP 结果](evidence/whisperx-real-inference/http-success-result.json) |
| 真实迟到结果围栏 | B 版本真实模型完成后只暂停返回；Owner 保存 C 版本再释放 B。旧任务可 completed，但不能覆盖当前正文、声学时序或 caption contract；C 再经真实模型完成。三个冻结版本不同，原成功产物 SHA 保持；未修改租约/任务时间或替代结果。标点变化只用于输入版本围栏，不作为正文识别能力验证。[结果](evidence/whisperx-real-inference/stale-real-result.json) |
| 缺模型 / 错误模型 | 空缓存与错误模型分别 exit 1，未超时、未联网后备；没有放松 model 校验。[负向结果](evidence/whisperx-real-inference/negative-probes-result.json) |
| 真实低置信度 | 4 秒本地静音输入实际调用同模型，置信度 0.124375，进入 `needs_review/low_confidence`，没有当作 completed。原阈值仍 0.72。[原结果](evidence/whisperx-real-inference/real-silence-alignment.json) |
| 同步预览 | 真实 OpenChatCut renderer 消费 C 版本真实时序；ready 产物 193250 字节，SHA `76abef50890c973f87d11b98035887e6b46605677bf54f01268e469ba26e2378`，H264 1080×1920 + AAC，4.053333 秒。声学 cues 与 caption contract 一致。[预览](evidence/whisperx-real-inference/preview-result.json)、[ffprobe](evidence/whisperx-real-inference/preview-ffprobe.json) |
| Chrome | 实际页面显示对齐完成/预览有效；播放进度从 0 推进到 0.663762 秒，暂停并跳到 1.5 秒，readyState 4、无视频错误，字幕清晰可见。177 个 HTTP 请求全为本机 55189，11 个 data URL 单独计为内联资源；无 HAR。[播放/跳转](evidence/whisperx-real-inference/browser-playback-result.json)、[截图](evidence/whisperx-real-inference/browser-preview-1.5.png)、[网络摘要](evidence/whisperx-real-inference/browser-network-result.json) |
| 回归 | 默认 **5000ms、102 文件、766/766**，原排除项不变，Vitest worker 实际安装离线 guard；类型检查通过。既有 React act 告警保留，没有提高超时、弱化断言、减少范围或重复刷绿。[全量日志](evidence/whisperx-real-inference/full-default-01.log)、[命令/结果](evidence/whisperx-real-inference/full-default-01-result.json)、[类型](evidence/whisperx-real-inference/typecheck-01-result.json) |

## 历史失败与能力边界

1. **首次冷 probe 在 30 秒失败。** 原结果、stderr 和诊断保留。120 秒仅为诊断进程的安全上限，不是验收预算；诊断实际 47.956 秒，模型加载 46.666 秒，栈显示 SciPy/Transformers/TorchVision 首次原生导入。完成显式离线依赖初始化后，原 30 秒限制的新进程通过。没有修改 probe 超时，也没有证明任意新主机/清空系统缓存后的冷启动必过。[首次失败](evidence/whisperx-real-inference/probe-01-result.json)、[诊断](evidence/whisperx-real-inference/probe-diagnostic-result.json)、[栈](evidence/whisperx-real-inference/probe-diagnostic-120s.log)、[限定归因](evidence/whisperx-real-inference/load-diagnosis-result.json)
2. **任意错误正文检测未通过。** 第一次负向用 `紫色的火车正在海底跳舞。` 配原音频，期望 needs_review，实际 completed、置信度 0.8380909，原断言失败及模型输出保留。强制对齐假设 Owner 提供正确正文，CTC 置信度不能当独立 ASR 或内容正确性证明。之后静音负向通过验证低置信度分支，不能替代这个失败；未调高 0.72 阈值或扩展 ASR。[失败能力说明](evidence/whisperx-real-inference/mismatched-text-limitation.json)、[原模型结果](evidence/whisperx-real-inference/real-mismatch-alignment.json)、[原断言日志](evidence/whisperx-real-inference/negative-probes-01.log)
3. 首次 HTTP 409 是克隆中目标 Episode 的分镜接管资格关闭；仅恢复该夹具所需标志。驱动最初从 sections 读取 task，改为实际 patches 协议后重验，不改产品 API。[夹具失败](evidence/whisperx-real-inference/http-01-fixture-failure.json)
4. 首次浏览器 CDP 关闭、首个 loopback 策略编译失败及最终审计把 `data:` 当网络来源的错误均保留。均为本轮工具/策略配置问题，不能计作产品通过；修正后才采集最终结果。[浏览器失败](evidence/whisperx-real-inference/browser-01-failure.json)、[策略失败](evidence/whisperx-real-inference/loopback-policy-01-failure.json)、[摘要错误](evidence/whisperx-real-inference/audit-01-failure.json)

这里只验证上述中文短音频、当前 CPU 环境与所列输入边界。未验收自由语音转写、说话人分离、多语言/长音频、普遍逐字准确性或独立听感质量，未下载 ASR/diarization 其他模型。

## 证据保留与收尾

本轮前 **756 项公开、1001 项私有证据**先逐项核对 SHA/大小。仅更新活动 README/review 和总索引，原 README/review 逐字归档为 [README](README-before-whisperx-real.md)、[review](review-before-whisperx-real.md)，原索引保留私有快照。T20 模型缺失 blocked、T21 740/745、默认 5 秒失败、两次 P2、自然租约历史失败及全部旧门禁记录不改判。上轮已经关闭的默认测试稳定性和当前 30 分钟自然租约范围保持原结论。

只停止本轮服务、Worker 和浏览器，撤销新克隆测试会话、删除本轮浏览器合成认证项；新库、APFS、模型、venv、缓存及原始材料继续私有保留。模型/venv/媒体不进入提交或公开目录，以来源、版本和文件摘要追溯；原始 HTTP、Cookie/CSRF、部署文件、密码、网络头部不公开。[收尾](evidence/whisperx-real-inference/cleanup-result.json)、[源码与范围](evidence/whisperx-real-inference/source-preservation-result.json)、[证据包复核](evidence/whisperx-real-inference/package-verification-result.json)、[总索引](evidence-index.json)

**仅关闭“已准备环境 + 指定模型 + 所列样本”的真实 WhisperX 离线成功推理验收。** 新主机冷启动、任意错误正文检测、秒级故障切换、活着的过期执行器文件隔离、在线取消/去重、Provider/Keychain 完整链路、完整多能力 Worker、默认/新主机完整部署、真实通知送达、容量/性能/切换回退和 E/F 继续未验收。SQL 建议继续暂缓，43 个无关文件和根 PLAN 不变，不提交、不推送。
