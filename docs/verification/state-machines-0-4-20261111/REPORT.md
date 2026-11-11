# 状态机优化 0—4 项交付

2026-11-11。按用户批准完成 0—4 项，当前 `main` 分批本地提交，不推送。审查基线 `1bedac10`，最终产品代码提交 `a310349a`。范围见 [SPEC](SPEC.md)，决定见 [ADR-0039](../../adr/0039-workspace-local-recovery-and-polling.md)，双轴审查见 [REVIEW](REVIEW.md)。

## 完成结果

| 项目 | 实际变化与影响 |
| --- | --- |
| 0：前轮收尾 | 提交刷新接收顺序修复、48 族清单与离线交互地图；准备当前运行包并验证完整性，实际日常登录入口冒烟通过。 |
| 1：访问与互斥 | 连接模型弹窗自行拥有连接访问生命周期，忽略旧读取及迟到保存；偏好保存同步防重复，卸载后不发布旧结果；Studio 离开后不执行旧关闭意图。原父入口已有的 key 隔离继续保留。 |
| 2：字幕接续 | 原生保存、权威读回、对齐准备／应用及登记分别记录进度。后续失败从未完成阶段继续，冻结意图并重验脚本、目标与原生文档证明；未知命令回执复用原数据和幂等键。 |
| 3：上传接续 | 素材栏和候选区复用局部上传执行模块，各自保留格式／大小／用途限制。导入成功后保留素材回执，候选登记失败不重复导入；重试仅处理未完成项。成功项收到父素材／候选确认后释放，错误和重试在窄屏保持可见。 |
| 4：轮询生命周期 | 隐藏时暂停，恢复时等待在途读取后刷新，避免重叠；瞬态读取错误独立展示并在成功后清除。口播沿用原命令；音频刷新与用户写入共享互斥，用户写入采用刷新后的权威 revision。 |

没有新增依赖、SQL 迁移或通用状态机框架。UX 收益集中在失败接续、反馈和跨页面结果正确性；DX 与 AX 收益集中在明确的局部 owner、共享执行边界、公开回归入口和源码地图。持久业务权威及供应商提交协议沿用现有实现。

## 自动验证

- 逐项失败回归覆盖迟到模型保存、偏好同周期重复提交、Studio 旧关闭意图、字幕部分成功与未知回执、上传关闭重开和未完成重试、隐藏恢复及音频双向互斥。相关 `*-red.log` 保留首次有效失败证据。
- 实施阶段 21 文件、232 条定向通过：[targeted.log](targeted.log)。审查后补充修复，再由 3 文件、40 条受影响回归通过：[reading-compatibility-green.log](reading-compatibility-green.log)。字幕恢复文件共 8 条，包含真实 localCommand／HTTP 幂等边界。
- 首轮默认全量为 1940 通过、1 失败、1 跳过。唯一失败为旧音频并发测试前提；经独立审查，改以外部权威更新保持原迟到覆盖保护。随后默认全量 258 文件全部通过，1941 条通过、1 条跳过：[full-tests-final.log](full-tests-final.log)。默认命令排除 `*.integration.test.ts`，不能视为真实数据库集成通过。
- 全量之后仅调整上传反馈的布局，将错误和重试放入同一反馈容器；3 文件、44 条相关回归及类型检查通过：[upload-layout-green.log](upload-layout-green.log)、[check-final.log](check-final.log)。没有在这次低风险布局后重复全量。
- 最终前端构建通过：[build.log](build.log)。仍有现有的大于 500 kB chunk 提示。运行包准备顺序构建 Worker／后端并通过源码和产物完整性检查：[runtime-prepare.log](runtime-prepare.log)、[runtime-release.json](runtime-release.json)。测试日志中的 jsdom 媒体 API 与 React act 提示保留，不计作失败。
- 同一候选脚本最终扫描 548 个文件，246 个文件含 1525 个信号：[census-summary.json](census-summary.json)。这是候选扫描，不是完整性证明；仍归为 48 个已人工核查的状态机族。

## 浏览器与运行入口

使用独立 Chrome 会话、真实组件、真实客户端 HTTP 及受控 iframe，夹具只监听 loopback，不代理业务服务。字幕夹具使用实际字幕纯函数读写临时原生 JSON；它不等于真实 OpenChatCut SDK 持久化验收。可复用入口为 [serve.mjs](serve.mjs)、[browser-fixture.tsx](browser-fixture.tsx)、[native-fixture.ts](native-fixture.ts)。先准备构建产物，再运行 `node docs/verification/state-machines-0-4-20261111/serve.mjs`，访问 `http://127.0.0.1:5197/__ui?case=captions`；该入口会创建专属 `.scratch/state-machines-0-4-20261111`。

| 场景 | 结果与证据 |
| --- | --- |
| 字幕登记失败后继续 | 原生修改／保存／登记各一次，原键接续：[browser-caption.json](browser-caption.json)。 |
| 登记已提交但回执未知 | 以提交后 HTTP 503 注入故障，重试同键、登记一次：[browser-caption-unknown.json](browser-caption-unknown.json)。不把自动传输重试当作用户接续证据。 |
| 模型切换与迟到保存 | 新连接可见，旧读和旧保存不能覆盖或关闭新弹窗：[读取](browser-model-read.json)、[保存](browser-model-save.json)。 |
| 偏好重复与重试 | 同周期提交一次，失败保留草稿，再次提交成功；390 px 无横向溢出：[browser-preferences.json](browser-preferences.json)。 |
| 上传失败与重试 | first、retry、retry 三次请求，两个素材成功，重试沿用原键：[browser-upload.json](browser-upload.json)。 |
| 页面隐藏恢复 | 受控 document.hidden 事件，隐藏期间读数不增，恢复后新增一次：[browser-polling.json](browser-polling.json)。 |
| 音频写入先行 | 用户保存未完成时背景刷新不进入：[browser-audio-write.json](browser-audio-write.json)。 |
| 音频刷新先行 | refresh 后 save，用户使用 revision 3，各写一次：[browser-audio-refresh.json](browser-audio-refresh.json)。 |
| 上传反馈布局 | DOM 回放旧 56 px 上限时错误被裁切，修复后可见，390 px 无横向溢出：[之前](upload-feedback-before.json)、[之后](upload-feedback-after.json)、[窄屏](upload-feedback-mobile.json)。 |

实际查看宽窄屏截图：[字幕宽屏](caption-recovery-wide.png)、[字幕窄屏](caption-recovery-mobile.png)、[上传宽屏](upload-recovery-wide.png)、[上传窄屏](upload-recovery-mobile.png)、[偏好窄屏](preferences-mobile.png)。

运行包准备后重新打开 `http://127.0.0.1:5174/`，Loop Control 登录页及邮箱、密码、提交按钮正常。日常服务未重启，新运行包尚未激活。本轮浏览器和 5197 预览已关闭，专属临时原生文件、Vite 缓存已清理，日常 5174 保留。

## 边界与交付

未调用付费供应商，未登录真实业务会话，未在本批运行真实 PostgreSQL 或 OpenChatCut 持久化。字幕与上传接续记录保存在当前浏览器页面内存中，整页重载后按原权威数据重新进入；未完成 File 的页面内保留属于恢复责任。日常 Owner／episode 上传队列支持关闭重开；无 Owner 的独立素材栏维持每次访问的局部会话。

本地产品提交为 `8eaab228`、`8e30037a`、`5b121841`、`a310349a`。远端 main 核对仍为 `1bedac1035a38a6399b931ad8cb4e42781a5216d`。无关 `docs/research/log-api-tools-20261111.md` 的 SHA 与 [protected.json](protected.json) 一致，保留且不暂存。本报告及更新地图另作收尾提交，不推送。

2026-11-11 后续清理：移除已被最终全量替代的首轮原始日志；其失败数量、原因与处理方式保留在上文。本报告的「不推送」为当时交付状态；上述优化后来已获授权，随 `86bc9e66` 推送。清理前版本可从该提交恢复。
