# T22：本地 QC、发布包与 Episode 生命周期

2026-10-24，分支 `codex/local-first-stage-a`，起点 `ff8eaf50f8f825335b8c3c9e62381814d5e52cd5`（T21）。

**T22 实现和受控离线本地验收完成，本报告随实现按后续授权纳入当前分支的本地提交。** 本轮默认 5000ms 回归为 **97 文件、747/747 通过**；此前 T21 那次 740/745 及历史默认 5 秒失败仍保留，根因未解决，本轮通过不关闭历史门禁。生产完成仅表示本机交付包验证完成，没有对外发布。未操作生产、推送、合并或开始 T23。

## 票单、依赖和隔离范围

依据本地已发布 T22 / [#128](https://github.com/DaNN-55/loop-control/issues/128) 核对三项验收：QC 问题与返修、最终成片复用/重渲染、发布输入和发布包验证完整贯通；生产完成不代表外部发布；真实文件、清单、历史及仅限可恢复测试数据的删除边界。T21 已提交；T11 的真实复用、损坏重渲染与发布包证据见 [T11 报告](../stage-c-t11/README.md)。没有联网刷新票单或改变规划文件中的旧状态。

沿用优化工作树、专用 `loop-control-stage-d-postgres` / `loop_imported`、`loop_empty`（本机 55472）、独立应用/Worker 角色和已有测试媒体卷。仅新增 T22 合成账号、生产单与可重建本地媒体；应用为 `127.0.0.1:55185`，独立真实 Chrome 仅允许本机访问。没有在线 Provider 请求、模型下载、生产凭据读取或生产操作；外部 Provider 费用为 0。规划器仍是离线合成替身，OpenChatCut 渲染、文件验证、原生 PG/HTTP/Worker CLI 则真实执行。

## 实现

- [交付命令](../../../src/local-app/deliveryCommands.ts) 接通 QC 问题、处理、批准、最终任务及重试。批准校验当前审核包、阻塞问题、真实文件和技术 QC；显式开启该生产单的交付资格，通过原队列创建唯一最终任务，输出按任务 UUID 隔离。
- [原生媒体 Worker](../../../src/local-app/mediaWorker.ts) 复用 T11 的来源查询、输入指纹、实际文件检查和有效 attempt/lease 条件；满足条件才复制受审视频，否则由真实 OpenChatCut 重渲染。最终工程统一使用[既有路径规范化](../../../src/worker/openchatcutPaths.ts)，兼容逻辑 `index.html` 入口与实际 `project.json`；[契约测试](../../../src/worker/contracts.test.ts) 仍拒绝不同冻结文件和修订。
- 发布输入保留原有标题 200、简介 5000、20 个标签/每个 50 字符及 20MB 封面上限。文件只创建或复核同一内容；复用原发布包模块，并额外检查清单准确绑定当前最终视频、QC、封面与元数据。真实验证完成后才原子登记输入、发布包、验证任务和 `production_completed`；重复提交不增加验证记录，不能覆盖固定输入。
- [生命周期](../../../src/local-app/episodeLifecycle.ts) 保留归档、恢复、已归档测试单、路径展示和标题二次确认。删除前锁定任务行并拒绝运行任务、资产锁及并发竞争；目录先暂存，事务失败恢复，提交后才清理。提交结果不确定时先查持久回执；未完成清理可跨服务重启显式重试。只删除当前 Owner 已确认生产单的目录。
- [删除文件工具](../../../src/worker/episodeDeletion.ts) 从原控制面提取复用，清理/恢复也校验暂存父目录，拒绝链接替换。[本地页面](../../../src/local-app/LocalDeliveryPanel.tsx) 沿用确认弹窗和最终材料组件，接通原有完成入口；目录默认隐藏归档项，并提供恢复和待清理入口。
- [028](../../../db/local/028-delivery.sql) 至 [035](../../../db/local/035-retry-history-status.sql) 均为前向本地迁移，两库核对 SHA。审批查询、最终来源、发布登记、删除和清理回执均经受控函数；没有开放审批表 SELECT 或通用回执 UPDATE。已应用迁移未改写。

## 真实验收

| 路径 | 结果与证据 |
| --- | --- |
| QC、返修、重复批准 | API 样本创建阻塞问题，批准返回 409；实际 Studio 改字并生成新 QC，旧包/问题保留，旧问题处理被拒绝。相同及不同 key 的重复批准复用同一最终任务。[结果](evidence/api-03-http-result.json) |
| 真实复用与重试 | 最终任务首次因路径别名契约阻塞，修复后经 Owner 明确重试同一任务，真实复用成功；旧 blocked 与新 completed 尝试均保留，没有重置历史。[失败](evidence/api-01.txt)、[路径红/绿](evidence/final-contract-red-01.txt)、[最终结果](evidence/api-03-http-result.json) |
| 真实损坏重渲染 | 第二样本批准后、实际 CLI 执行前，仅破坏其可复用候选视频；实际 OpenChatCut 最终渲染及 QC 完成，`reused=false`，随后恢复原候选字节并核验 SHA，再真实生成验证发布包。[结果](evidence/api-03-http-result.json) |
| 发布包约束 | 一个格式、SHA 和文件均有效但错误引用受审视频路径的孤立清单被拒绝，生产未完成；移除本轮注入清单后正常验证通过。重复提交只有一个包/验证任务，改固定输入 409 |
| Chrome 完整链路 | 实际编辑并保存字幕、服务重启恢复、生成审核视频、记录/处理 QC 问题、批准、上传封面、填写元数据、生成包；刷新后通过原“查看最终材料”入口打开并播放成片。[最终结果](evidence/browser-65-final-result.json)、[真实帧](evidence/browser-36-final-frame.png)、[材料页面](evidence/browser-35-final-materials.png)。不是替 Owner 对真实业务作批准，使用专用合成 Owner/数据 |
| 归档与确认删除 | 默认列表隐藏、显示归档和恢复均经 Chrome 验证；备份完整样本后显示路径并输入标题二次确认。[确认界面](evidence/browser-52-title-confirmation.png)、[默认隐藏](evidence/browser-42-default-hidden.txt)。删除前保存 public 数据、原生管理标记和 61 个文件，逐一核验备份 SHA |
| 回滚及重启恢复 | 实际数据库故障后恢复记录与目录；完整样本首次外键失败后 61 文件与备份相同。修复后 DB 关联数据归零，受控暂存父目录替换使清理安全拒绝、61 文件保留；实际重启后记录仍可见，恢复测试目录后经页面重试完成。[回滚](evidence/full-delete-rollback-files-01.json)、[暂存](evidence/browser-58-staged-result.json)、[重启后](evidence/browser-60-pending-restarted.png)、[最终](evidence/browser-65-final-result.json) |
| 边界 | [13 项](evidence/boundary-01-boundary-result.json)：未登录、CSRF、Origin、跨 Owner、输入上限、无效封面、固定清单及产物 HTTP 篡改、运行任务/资产锁拒绝。运行/锁负例使用明确标注的合成 DB 状态，不是实际长运行 Worker；临时行/锁移除，受控篡改原字节恢复 |
| 历史与权限 | [审计](evidence/audit-02.json)：T22 前 38 表、25,961 行原记录按逐行多重集全部保留，59 个当前/历史索引文件 SHA/大小匹配。另核验 12 个当前材料及已删除样本 27 个索引产物的私有备份；[8 个 Owner 私有函数和 Worker 来源权限](evidence/audit-boundaries-01.json)符合边界，未开放审批表/回执通用权限。根 PLAN 和原有无关文件哈希不变 |

已删除样本的公开截图/帧/摘要保留；完整快照、文件树、编辑器运行状态和数据库备份保留在私有隔离目录，不纳入仓库。备份 SHA 已验证；本轮没有执行整库恢复演练，也没有开始 T24。

## 回归与本轮修复

- [默认完整命令](evidence/default-5s-01-result.json)无超时覆盖，[97 文件、747 项通过](evidence/default-5s-01.txt)。**不关闭 [T21 那次失败及基线对照](../stage-d-t21/README.md) 或更早默认 5 秒历史问题，根因仍未解决；本轮没有声称修复超时，也没有新增基线对照。**
- [初始 34 项定向](evidence/focused-01.txt)通过；新增真实文件测试拒绝暂存父目录链接替换。最终完整回归覆盖后续路径兼容测试及其他所有现有测试。
- TypeScript、原生编译、[本地前端构建](evidence/frontend-final-01.txt)、runtime 完整性检查通过；[Node 为 2 通过、1 个既有跳过](evidence/node-final-01.txt)。最后仅清理新源码文件末尾空行，再[准备 runtime](evidence/runtime-prepare-09.txt)并复核指纹，没有为格式变化重跑功能回归。
- 真实演练暴露并修复：重复批准参数类型及审批表只读权限；逻辑入口与实际工程路径比较；受阻最终任务的受控重试；删除函数引用已退役统计表、原生管理标记外键和分镜草稿删除顺序；清理回执缺少窄权限。没有扩大表权限、重建退役业务或跳过校验。
- 最后只读复核发现“failed + render_ready”重试会错误记录 `previous_status=blocked`；通过真实 PG、仅回滚的[红](evidence/retry-history-red-01.txt)/[绿](evidence/retry-history-green-01.txt)修正为真实前态。不是一次真实失败渲染或模型推理成功。

## 保留限制与证据口径

1. T21 那次及历史默认 5 秒失败、根因未解决继续保留。真实 WhisperX 成功推理、默认部署、在线生成、其他 Provider 和完整多能力 Worker 尚未验收，不扩大既有 Provider 最小验收范围。
2. 模拟 `live/verified` 资格和 SecretStore 替身不构成真实在线/秘密存储证明。本轮没有新增资格或秘密解析；确定性本机渲染不等同于在线创作和完整多能力验收。
3. [T17 中间日志覆盖说明](../stage-d-t17/README.md)继续保留。T22 编号 stdout、失败和截图独立保存；`fixture.json`、HTTP progress、runtime、events 是明确的滚动/追加状态，不声称每个中间响应均有原始档案。
4. 原始类型错误、API/ACL/路径阻塞、生命周期前几轮失败、完整样本外键失败及浏览器等待超时不作为通过证据。一次只读备份驱动未解包 patches 而失败，发生在文件写入前；该次仅有工具输出，后续正确解包并完成 61 文件备份，不追认成完整原始 stdout。
5. [证据索引](evidence-index.json)区分公开文件和私有原始材料；[最终范围与敏感值检查](evidence/scope-and-secret-final01.json)、[收尾检查](evidence/cleanup-final02.json)通过；没有原始 HAR，Owner/DB 凭据、任务 lease、编辑器凭据、完整快照及备份不复制到报告目录。
6. 本轮应用、Worker、Studio 关闭钩子及专用 Chrome 已收尾，合成认证项删除；专用 PG 和媒体卷保留。未操作生产、推送、合并或开始 T23；默认本地部署配置仍未启用。只读[复核](review.md)不代表独立评审、GitHub 关票或整个 D 阶段验收。

## 本地提交归档

验收完成后获用户授权，将本轮实现、报告、回归日志与索引提交到当前分支。证据中的 `noCommit`、`indexEmpty` 等字段描述验收收尾当时的快照，原始文件保持不变；提交状态以 Git 历史为准。此次归档只调整报告与索引的归档状态，未修改业务实现或重跑已通过的验收；T21 当次及历史默认 5 秒失败、根因未解决和上述所有限制不变。无关规划文件、私有原始材料及含凭据的备份均不纳入本次提交。
