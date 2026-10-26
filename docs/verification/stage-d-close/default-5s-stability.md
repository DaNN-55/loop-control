# 默认 5000ms 测试稳定性收口

2026-10-25，Asia/Shanghai。优化 worktree、`codex/local-first-stage-a`，基线 `bca697bbc1e12626771d1283ec87a17bf85f02fe`。仅处理第 1 项测试稳定性，不提交、不新增在线请求、不进入 E/F，SQL 建议继续暂缓。

**当前源码及测试资源配置下，该稳定性门禁可关闭。** 复现的是默认测试池并发造成的墙钟耗时越界；修复限制测试进程资源，不改变产品调度器、默认 5000ms、测试范围或业务断言。此结论不保证任意宿主负载下永不超时，不是产品任务领取五秒性能或整个 A–D 验收。

## 复现与归因

目标为 `ReviewWorkspace.test.tsx` 的「分镜批准后按整期 BGM、TTS、逐镜头声音的顺序显示并保存独立音效选择」。本轮自然完整基线 4 次均 766/766，目标 3978–4353ms；单跑 1629ms。没有将自然基线写成失败。[自然基线](evidence/default-5s-stability/baseline-full-02.txt)

本机 Node 24.20.0、Vitest 3.2.7、10 个可用逻辑 CPU。Vitest 默认测试池取 `availableParallelism()-1`，本机为 9 个进程。目标包含 33 个用户动作及较重的 React/jsdom 运算。CPU 采样的活动 worker 为 2465.8ms，含导入/准备；其中 React 712.2ms、role 查询 336.1ms、user-event 513.5ms、idle 548.7ms，各类别重叠，不能相加。它支持计算竞争的解释，没有把闲置 worker 等待时间当目标阻塞。[采样分析](evidence/default-5s-stability/cpu-profile-analysis.json)

先做默认并发→私有 50% 配置→恢复默认并发→正式 50% 配置对照，所有原始日志保留。随后在实际 worker 封套下再复核同一固定场景：两套完整默认回归同时运行，仅测试池上限不同，源码、测试、夹具和 5000ms 预算相同。

| worker 封套下的同压力对照 | 目标耗时 | 全量结果 |
| --- | --- | --- |
| 原默认上限 9，样本 1 | 5010ms，超时 | 765/766；[原日志](evidence/default-5s-stability/pressure-sealed-before-full-01.txt) |
| 原默认上限 9，样本 2 | 5207ms，超时 | 765/766；[原日志](evidence/default-5s-stability/pressure-sealed-before-full-02.txt) |
| 最终上限 50%（本机 5），样本 1 | 4130ms | 766/766；[原日志](evidence/default-5s-stability/pressure-sealed-final-full-01.txt) |
| 最终上限 50%（本机 5），样本 2 | 3857ms | 766/766；[原日志](evidence/default-5s-stability/pressure-sealed-final-full-02.txt) |

该压力场景是明确标注的诊断条件，不冒称四轮自然基线已经失败；修复前后的对照只改变测试资源上限。没有把宿主负载断言为所有历史失败的唯一原因。

## 最小修复

1. `vite.config.ts` 仅在 `mode==='test'` 增加 `maxWorkers:'50%'`，保留文件并行及用例内的真实并发场景。生产 serve/build 和显式 legacy 分支未改；没有 `testTimeout`、`hookTimeout` 或 CLI 超时覆盖。Vitest 非浏览器默认仍为 5000ms。[配置核验](evidence/default-5s-stability/test-config-audit-result.json)
2. 首组验证的第三轮出现另一个已有测试不稳定：本地目录测试点击系列后仍显示蓝图，找不到「系列定位」；目标审核用例当轮仍通过。失败 DOM 和组件初始重置 effect 表明原测试对异步初始化有隐式假设。仅将首项测试的 `render` 包入 `await act`，完成初始化再切页，全部原业务断言保留；未改产品组件。单次诊断 trace 只记录正常的 reset→click 顺序，没有冒称已捕获失败轮 effect 时序。[失败](evidence/default-5s-stability/stable-full-03.txt)、[正常 trace](evidence/default-5s-stability/init-order-before-01.txt)、[断言与字节核验](evidence/default-5s-stability/assertion-audit-result.json)

原审核测试全文字节不变；本地目录测试除初始化等待及说明外字节不变。诊断期间的产品组件日志已恢复原字节，无调试插桩留在源码。

## 预定最终验证

方案在修复前固定：目标 20 次、整份审核文件 5 次、完整默认回归 3 次。遇失败或验证条件改变，保留整组结果，重新执行最终组；没有选择性丢弃失败样本。

| 最终 worker 封套下的验证 | 结果 |
| --- | --- |
| 目标用例 20 次 | 20/20；1571–1738ms；[首轮](evidence/default-5s-stability/stable-sealed-target-01.txt)、[末轮](evidence/default-5s-stability/stable-sealed-target-20.txt) |
| 完整审核文件 5 次 | 每次 65/65；目标 1292–1351ms；[末轮](evidence/default-5s-stability/stable-sealed-review-05.txt) |
| 完整默认回归 3 次 | 每次 102 文件、766/766；目标 2074/1941/2138ms；[第一轮](evidence/default-5s-stability/stable-sealed-full-01.txt)、[第二轮](evidence/default-5s-stability/stable-sealed-full-02.txt)、[第三轮](evidence/default-5s-stability/stable-sealed-full-03.txt) |
| 本地目录组件 | 11/11；原成功保存、失败恢复及注销围栏测试均在；[日志](evidence/default-5s-stability/sealed-local-review-01.txt) |
| 类型与范围 | `npm run check` 通过；业务组件、SQL、依赖及生产配置不改；[类型](evidence/default-5s-stability/typecheck-01.txt)、[范围](evidence/default-5s-stability/scope-result.json) |

完整回归沿用已有 integration、n8n 和私有历史快照排除项，没有新增业务用例排除。目标过滤的 64 项 skipped 仅属于定向诊断；完整审核文件及完整回归均实际运行原有范围。原 React act 警告、受控导出 503 等输出保留，未在本轮顺手修复。

## 环境与证据纠正

- 首轮沙箱完整测试因 loopback `listen EPERM` 失败，21 failed/715 passed/30 skipped，属于环境阻断，不作为产品基线；[原日志](evidence/default-5s-stability/baseline-full-01.txt)。后续完整测试仅获临时本机监听许可，未启动生产或在线 Provider。
- 首组固定验证为 20/20、5/5、完整 2 过/1 失败，不能称整组通过；`stable-full-03` 及此前压力中的同类目录断言失败均保留。补齐初始化等待后的 v2 结果也完整保留。
- 发现 Vitest 会过滤父进程 `execArgv` 的 `--import`；此前仅该参数不能证明 worker 封套覆盖。最终私有 runner 通过 `NODE_OPTIONS` 传递封套，逐 PID/运行标签记录实际安装。最终 28 次固定验证加 4 次压力对照共 32 次均有 worker 证据，每次完整回归记录至少 102 个 worker 安装；[封套审计](evidence/default-5s-stability/worker-guard-audit-result.json)。早期运行不冒称 worker 封套全覆盖；最终 sealed 组才是验收依据。
- CPU 分析首版循环覆盖了分析输出，旧输出保留私有；纠正为聚合并选择实际活动 worker。原 profile、诊断配置、trace 与源文件快照保留私有，不以错误摘要代替最终分析。

全部统计及每轮命令见[分组结果](evidence/default-5s-stability/cohort-summary.json)。日志按唯一文件名保存，含所有失败与中间通过。

## 历史与其他门禁

原 442 项公开、577 项私有证据保留；只更新活动 README/review 的当前结论，更新前的[README](README-before-default-5s.md)、[review](review-before-default-5s.md)及私有旧索引另存快照。其他旧条目和所有历史原始日志保持原字节，原始失败仍然失败。[保留核验](evidence/default-5s-stability/evidence-retention-result.json)

当前索引的五秒稳定性关闭标志仅指本轮当前源码和测试资源策略；旧索引、旧 followup 和 B/T06、T19、T21 等报告中的历史判定不改写。不追认旧运行通过，也不追溯认定每次历史失败都由同一个原因造成。

**30 分钟 Worker 租约与立即故障切换、真实 WhisperX、真实在线 Provider/Keychain 完整链路、完整多能力 Worker、默认/新主机部署、真实通知送达及其他未验收项继续开放。** 模拟资格、历史 SecretStore 替身、T17 中间日志覆盖说明、旧 n8n 校验跳过、SQL 建议暂缓、Pexels 两次预算已用尽均不改变；E/F 不进入。

只涉及测试资源配置和测试初始化同步，没有生产运行行为变更，因此本轮未启动产品 UI、数据库或 Worker 服务，也不把测试结果写成实际产品性能提升。[本轮摘要](evidence/default-5s-stability/verification-result.json)、[总索引](evidence-index.json)。此为主 Agent 收尾记录，不是独立评审；未提交或推送。
