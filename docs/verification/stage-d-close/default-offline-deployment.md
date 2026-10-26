# 当前主机默认部署与正式 npm 入口离线验收

2026-10-25，Asia/Shanghai。基线 `bca697bbc1e12626771d1283ec87a17bf85f02fe`，固定优化 worktree。

**已补齐当前隔离环境的默认部署选择和不下载的离线准备流程，并完成正式无参及显式 `npm start/stop`、真实模型任务、同步预览和重启验收。** 使用当前 macOS arm64 主机，复用已安装 Node/Python、OpenChatCut 和已核验模型；新建恢复库和独立 APFS 媒体。**这不是全新主机安装、操作系统冷启动或默认生产部署通过。** [验收摘要](evidence/default-offline-deployment/verification-result.json)

用户授权仅本轮最小补齐与离线验收；0 下载、0 在线 Provider 请求，无提交/推送/E/F。SQL 一致性建议暂缓，未修改 SQL 源码或历史迁移。

## 最小实现

1. `readDeployment` 增加可选私有 `default-deployment.json` 指针。无指针时保留原 `config.json`/可选 `native-worker.json` 行为；有指针时复用现有严格部署读取，核对批准目录、数据库/Worker 同库、媒体和恢复回执。指针错误不回落旧库。没有覆盖原默认配置，也没有伪造一个指向旧库的默认 Worker。
2. `local:prepare-offline -- --deployment … --set-default` 校验本地资产 SHA、包版本、FFmpeg/FFprobe/OpenChatCut，并准备已有运行程序。Python 依赖导入是显式准备步骤，120 秒仅为导入进程安全上限，**不加载模型**；随后调用实际 `assertAlignmentReady`，模型 probe 仍为 **30000ms**。不安装包、不下载模型、不启用在线资格。
3. 成功后保存私有准备回执；默认或标记 `offlinePreparationRequired:true` 的部署在监听前复核文件/清单、部署、准备脚本、runner 和 Node 身份。缺回执、准备失败或资产变更明确拒绝。实际任务仍执行原 30 秒模型 preflight，不能由静态回执保证任意冷缓存环境的加载耗时。
4. 默认选择首次写入不覆盖已有指针；有活服务或无效服务记录时拒绝切换。历史死亡进程记录只保留，不因文件仍存在就冒充活服务。流程要求先停止服务，不提供并行部署切换或通用安装器。

只修改部署读取/启动准备、命令注册与必要测试/说明；停止身份检查、业务 SQL、任务租约/结果围栏、模型 runner、阈值和产品界面不改。[本轮源码与范围](evidence/default-offline-deployment/scope-result.json)、[使用说明](../../local-native-deployment.md)

## 实际环境与准备

通过现有 native v2 恢复器，将保留归档恢复到 `loop_t24_restore_default20261025`、`state/t24-default-20261025/volume/restored/media`，再由正式部署生成器创建配置；原凭据/会话不导入，按保留 Owner 初始化合成密码，连接资格清零。新克隆仅为目标 T20 Episode 开启离线执行，其余历史输入保持关闭，自动计划移到明确远期日期。未改原库/媒体/旧默认配置。[恢复](evidence/default-offline-deployment/restore-result.json)

复用 Python 3.11.15/WhisperX 3.8.6 等原 102 包与同一固定中文模型 revision `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd`。模型和 NLTK 数据实体复制到新媒体目录，原 venv 和 OpenChatCut 仅复用；清单纳入模型配置/权重、缓存引用、分句数据、包元数据和离线执行封套。包元数据 SHA 不等于全部 wheel 内容锁定，venv 也没有被证明可直接搬到别的主机。模型来源和首次失败沿用[真实推理报告](whisperx-real-inference.md)。

最终准备命令的初始化、模型检查耗时、Node/脚本身份和 `localMediaDependenciesChecked:true` 见[最终回执](evidence/default-offline-deployment/prepare-04-receipt.json)。准备安全上限和业务模型检查分开记录，没有把先前 120 秒诊断或本轮导入步骤当作 30 秒模型通过。

## 正式入口与结果

| 路径 | 实际验证 |
| --- | --- |
| 默认选择 | 指针测试先 1 失败/2 通过，再 3/3；准备资产测试再补 2 项，focused 5/5。[red](evidence/default-offline-deployment/default-pointer-red.log)、[green](evidence/default-offline-deployment/default-pointer-green.log)、[focused](evidence/default-offline-deployment/focused-01.log) |
| 默认模型阶段 | 真正 `npm start -- --offline-test`，无 `--deployment`、未借环境变量指定目标；正式 Vite 配置装配正常应用工厂和实际 Worker。首次真实模型 task `f1aa7c56-4ee7-4750-adc8-6735bfddbec3`，attempt 1、1 run；内层 completed、0 review issue、输入指纹及 HTTP SHA 通过。[启动](evidence/default-offline-deployment/default-start-01-result.json)、[HTTP/模型](evidence/default-offline-deployment/http-success-result.json) |
| 迟到结果 | 真实旧模型完成后暂停返回，Owner 改新版本再释放；旧结果不覆盖新正文/时序/caption contract，新版本实际模型完成，原产物 SHA 保持。[结果](evidence/default-offline-deployment/stale-real-result.json) |
| 最终代码模型复验 | 默认正式入口下 task `eb9c5ffd-5e3c-42d8-8ad8-74367eba018b` 内层 completed，60–4006ms、0.982125、0 review issue，HTTP SHA 与文件/回写一致。[结果](evidence/default-offline-deployment/final-model-result.json) |
| 完全无参入口 | `npm start`/`npm stop`，无附加部署或离线参数；实际服务树另受验收 OS loopback 策略约束。原服务身份检查保留。[启动](evidence/default-offline-deployment/default-start-04-result.json)、[停止](evidence/default-offline-deployment/default-stop-03-result.json) |
| 真实预览/Chrome | 正式默认入口消费真实模型时序生成本地预览；HTTP SHA `76abef50890c973f87d11b98035887e6b46605677bf54f01268e469ba26e2378`，193250 字节。Chrome 实际播放从 0.009264 到 0.709695 秒，跳到 1.5 秒、readyState 4、无视频错误，字幕可见。[预览](evidence/default-offline-deployment/preview-result.json)、[播放](evidence/default-offline-deployment/browser-playback-result.json)、[截图](evidence/default-offline-deployment/browser-preview-1.5.png) |
| 构建后重启 | 完成前端 build 后，正式 npm 启动重新准备 runtime；原 Owner HTTP 会话、当前真实时序和预览 SHA 保持。[HTTP](evidence/default-offline-deployment/restart-http-result.json) |
| 显式与默认重启 | 同一目标的显式 `npm start/stop -- --deployment …` 通过，随后再无参启动。浏览器不重新登录，重载并等待账号配置出现后确认会话延续。[显式启动](evidence/default-offline-deployment/explicit-start-01-result.json)、[停止](evidence/default-offline-deployment/explicit-stop-01-result.json)、[默认重启](evidence/default-offline-deployment/default-start-06-result.json)、[Chrome](evidence/default-offline-deployment/browser-restart-ready-02.txt) |
| 拒绝路径 | 缺准备回执拒绝；改变清单内实体文件、Worker 错绑数据库、指针指向命名空间外文件都在监听前 exit 1，所有本轮测试文件恢复原字节。[缺准备](evidence/default-offline-deployment/start-unprepared-red.log)、[三项结果](evidence/default-offline-deployment/negative-starts-result.json) |

## 离线封套与回归

模型阶段使用正式 `--offline-test` 的 Node guard；Python 使用独立 OS `deny network*`、audit hook 与 HF offline，实际 loader/align 原值返回。四份真实字符对齐原始 JSON 和全部 Python 事件索引保留，网络尝试为 0。依赖初始化只有模块导入，没有模型加载事件。渲染阶段不再派发模型任务；实际 Vite、Worker、renderer 受进程树 OS loopback 策略约束，允许 renderer 临时本机端口。浏览器另受 OS loopback 和 `127.0.0.1` 域限制。不是整机断网或通用防火墙证明。[审计](evidence/default-offline-deployment/offline-network-result.json)

正式启动器保留 `ps/lsof` 身份检查。macOS 在将整个启动器放入 OS 沙箱时拒绝执行 `ps`，因此最终验收只在 spawn 边界给真实 Vite 服务树加 OS 策略，启动器仍使用 Node guard；没有替换服务器、跳过身份校验或修改启动等待时间。私有封套源码与实际调用记录列入总索引。

最终默认 **5000ms、103 文件、769/769**，原排除项保持，worker 实际加载拒绝外网的测试 guard。类型、构建通过；Node 检查 2 通过/1 既有跳过。原生构建图 1860 模块、无 SDK/旧控制面，约 586.67KB chunk 告警保留，不作容量或性能结论。[全量](evidence/default-offline-deployment/full-default-02.log)、[类型](evidence/default-offline-deployment/typecheck-01.log)、[构建](evidence/default-offline-deployment/build-01.log)、[模块图](evidence/default-offline-deployment/native-runtime-graph-result.json)、[Node](evidence/default-offline-deployment/node-tests-01.log)

## 失败与纠正记录

- 初始环境脚本在成功恢复/初始化 Owner 后误用了不存在的 `tasks.last_error` 字段；没有重跑恢复或改变旧库，只继续启用目标输入。[记录](evidence/default-offline-deployment/setup-01-failure.json)
- 首次离线准备的导入和 30 秒 probe 已成功，但发布默认指针被历史死亡服务记录挡住；原失败回执保留，最小调整为核对 PID 存活，不删除历史记录，活服务仍拒绝。[记录](evidence/default-offline-deployment/prepare-01-failure.json)、[原失败回执](evidence/default-offline-deployment/prepare-01-failed-receipt.json)
- HTTP 复用驱动仍导入已移除的私有 launch helper，在业务调用前失败；修正驱动后使用正式已启动服务验证。[原错误](evidence/default-offline-deployment/http-01.log)
- 非法指针夹具最初指向不存在路径，实际 ENOENT 拒绝但未匹配预期文案；改为存在但不在批准命名空间内的私有文件，保留精确拒绝断言。[说明](evidence/default-offline-deployment/negative-starts-01-failure.json)
- 整个 npm 启动器进入 OS 沙箱时，`ps` exit 71，真实 Vite 已监听但身份核对失败，服务被启动器结束；原失败和过早发起预览的 ECONNREFUSED 保留。只改变验收封套施加位置，产品身份检查不改。[启动失败](evidence/default-offline-deployment/default-start-03.log)、[说明](evidence/default-offline-deployment/start-03-policy-failure.json)、[过早请求](evidence/default-offline-deployment/preview-01.log)
- 首轮完整回归处于执行沙箱禁止本机监听的条件：9 文件失败、21 用例失败、718 通过、30 跳过，并有 16 个错误；`listen EPERM` 及连带 5/10 秒等待超时全部保留。允许测试临时本机监听后，以同一范围、同一默认超时及外网 guard 重跑 769/769；未改业务断言或提高超时。[原日志](evidence/default-offline-deployment/full-default-01.log)
- 首次浏览器重载采样仍在登录初始化，未当作会话延续通过；另以已登录会话跨正式停止/重启、等待可观察界面后通过。证据打包先遗漏夹具中断后未生成的环境摘要，再把本地 `blob:` 计为网络来源；两个失败脚本/说明和原始网络保留，最终将本地 blob 与 data 单列，实际网络来源仅本机。

## 历史保留、收尾和未关闭范围

原 **831 项公开、1178 项私有**证据在报告更新前逐一核对 SHA/大小；仅更新活动 README/review/索引，原文归档为 [README](README-before-default-deployment.md)、[review](review-before-default-deployment.md)，原索引私有保留。旧随访、默认 5 秒稳定性、自然租约及 WhisperX 限定验收对象保持原值，全部历史失败不改判。[旧证据核对](evidence/default-offline-deployment/old-evidence-preservation-result.json)

默认指针、最终准备回执、新恢复库/媒体及模型环境保留，供本地主动启动使用；服务最后经无参 `npm stop` 停止，仅撤销新库测试会话、关闭本轮浏览器/删除合成认证项，旧服务未被 signal。根 PLAN 和 43 个无关文件保持原字节，HEAD 不变、未暂存/提交/推送。[收尾](evidence/default-offline-deployment/cleanup-result.json)、[证据包复核](evidence/default-offline-deployment/package-verification-result.json)、[总索引](evidence-index.json)

**只关闭当前已准备主机、批准隔离默认配置及所列正式入口的验收。** 首次冷 probe 30 秒失败、120 秒诊断非验收、错误正文 completed/0.838 高分反例及低置信度阈值 0.72 全部保留。全新主机/操作系统冷启动、跨平台/离线安装包完整性、空库新建 Owner、通用默认生产部署、在线 Provider/Keychain 完整链路、完整多能力 Worker、真实通知送达、秒级故障切换、存活的过期执行器文件隔离、在线取消/去重、容量/性能和 E/F 均未关闭。SQL 建议继续暂缓。
