# #141 真实规划验收草稿

两项真实 CLI 规划、正常 HTTP 负例、页面与最终源码正常重启读回均已完成。#141 的最终 Spec、公开凭据扫描、证据索引及关票读回仍由主 Agent 收尾；本文不自行宣布 Issue 已关闭。所有原阶段报告继续保留。

## 真实入口与冻结修复

正常入口首先暴露了本地基线缺少 `freeze_shared_planning_harness_before_insert` 的问题：蓝图指定 `gpt-6.1-sol` 和当前共享 Harness，但排队任务冻结成旧模型、旧提示配置且缺少 Harness。调用前围栏拒绝了执行，旧任务两次失败保留，当时真实 CLI 规划调用为 0。

经 Owner 单独授权，041 仅注册已有冻结函数，并加入 migrate、native restore 的前向列表；仅在本轮新隔离库应用。真实 PostgreSQL 验证了重复应用幂等、同名 disabled 触发器的错配拒绝与回滚、041 先于 040 的冻结顺序，以及既有业务行和账本保持不变。旧坏冻结任务没有被改写。

同账号、同蓝图经正常 Owner API 创建的新生产单 `5eb48e39-6c99-4c95-b3ab-ed91dea7d3e7`，HTTP 冻结检查确认了模型、Harness、executor、prompt 和输入身份。真实 CLI 沿用用户另行批准的当前 ChatGPT 登录及模型配置，不是新注册的 ChatGPT 账号；桥接器没有读取或复制认证文件。

## 两项真实规划

| 任务 | 实际结果 | 产物身份 |
| --- | --- | --- |
| 视觉准备 `a63d4d72-59bb-4f6f-93be-690e4eb6dd24` | 真实 CLI 生成 Markdown，引用本次正文和视觉参考，说明参考用途与画面要求，`visualAssetRequests=[]` | 2334 字节；SHA-256 `69f4c2617699388d7728a1add66f90ec6047655c53c2c91040e00b3177a55825` |
| 分镜 `8688c8e8-9e5a-43b2-b23f-ca3740c8c3a3` | 真实 CLI 生成一条 2 秒 `b_roll`，`shot-1`、正文「自然」、`productionMethod=nature`、9:16、`audioCues=[]`；引用同单正文、已接纳视觉清单和参考图 | 1131 字节；SHA-256 `c68c456e4f9eb06a0642c02e025125899d02fbbbb6a393359eb695b68224489a` |

两项结果通过既有 Worker JSON、文件 SHA/大小及分镜一致性合同，未使用固定返回脚本代替规划。桥接账本分别记账 79,044.360ms 和 59,597.643ms，累计 138,642.003ms，低于获批的 180,000ms；恰好执行 2 项规划，不再调用或自动重试。这里的「2 项」不是 CLI 内部模型 HTTP 请求数。

## 已完成的本地负例

实际结果合同拒绝了错误 task ID、错误冻结路径、负文件大小、真实文件错误 SHA，以及报告分镜与文件不一致。使用本轮旧坏冻结任务的真实 failed attempt，通过原生 Worker RPC 回报被 PostgreSQL 以 `42501` 拒绝；当前已接纳文件及 task/run/artifact 指纹不变，CLI 与 Provider 账本不变。

正常 HTTP 负例也已通过：无 Owner 返回 401，真实外账号生产单返回 404，缺失规划模型/Prompt 配置被 `worker-preflight/v2` 阻塞，不存在的执行命令在 Worker scheduler 启动前被拒绝。没有因此创建业务任务或生产单，没有额外 CLI 或 Provider 调用。这些结果不冒充远端认证失败验收；真实远端鉴权失败没有另行调用，不计通过。

## 最终源码下的接续验证

041 在两项真实 CLI 前应用；后续本地裁剪分类、首次 TTS 启用时序、042 输出归属及本地裁剪预检又有补修。因此不能声称整条成功链从头到尾使用同一完整源码 SHA。最终 [43 项源码清单](source-final-native-local-followthrough.json) 的聚合 SHA-256 为 `207c8547fba52862d4e9bf535605f7b41d23c15d343dd4ee701b98abeb1852a8`。Provider transport、旁白 Worker 与前段快照逐字节一致；注册 Adapter、受控媒体 executor 和对齐 Worker 与 `bbd2987` 基线一致。已成功的外部结果按冻结身份继承，没有重发。

受影响的本地后半链已在最终源码下完成：同单新 clip、对齐与正文确认、同步预览、Studio 读写、测试 Owner QC、final 和本机发布包。当前 Chrome 页面、视频播放和最终 UI 已实际检查；正常停止/重启后，生产单投影完全一致，21 个产物的 Owner HTTP 字节与磁盘逐项匹配，CLI/Provider 账本不变。详见 [同单最终报告](report-142-final.md)。

截至本稿，主区联合回归为 113 个文件、894/894，默认 5000ms，无超时覆盖；构建和 TypeScript 检查通过。这些结果不能代替页面、正常 HTTP 或完整同单链验收。原有 legacy 跳过项、React 测试提示和 bundle 提示继续保留。

主 Agent 关票前仍需完成最终 Spec 结论、实际凭据扫描、公开/私有索引核验及 GitHub 状态读回。原始 CLI 包、会话、Cookie、CSRF、密码、token 和媒体本体只作私有证据；公开报告仅记录安全摘要。两段新增调试 raw 的缺失见 [证据缺口说明](evidence-gaps-current.md)，不能泛称所有失败原文完整保留。

SQL #146/#147 继续暂缓，其他四类 Provider 的 Owner 批准跳过不计通过。未提交、推送或进入 E/F；本稿不关闭 A–D 总门禁。
