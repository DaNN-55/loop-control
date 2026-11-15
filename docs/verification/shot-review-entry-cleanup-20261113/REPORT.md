# 旧镜头结构修订与旧审核入口清理

日期：2026-11-13。结论：用户指定的两组共5个函数已删除，相关的2个专属生产触发器及其2个函数一并删除。174已应用日常库；当前功能、共享保护和历史恢复保持，不提交、不推送。

## 删除范围与依据

| 对象 | 删除依据 |
| --- | --- |
| `local_identity.request_shot_revision(uuid,uuid,jsonb,text)` | 没有有效SQL或产品调用者；旧HTTP结构修订命令早已在Owner归属检查后返回410 |
| `public.request_shot_structure_revision(uuid,uuid,jsonb,text)` | 唯一SQL调用者为上一项；负责旧规划任务派单、下游失效和阶段变更 |
| `public.canonical_storyboard_structure_revision_operation(jsonb)` | 仅由上一项使用的旧操作规范化辅助函数 |
| `public.create_storyboard_annotation(uuid,text,text)` | 无有效SQL或产品调用者；旧HTTP批注命令已拒绝；历史批注保留 |
| `public.review_pre_render_member(uuid,text,text,text)` | 无有效SQL或产品调用者；旧HTTP逐项审核命令已不在允许集合中；历史成员和审核决定保留 |
| `public.approvals` 上的 `create_storyboard_revision_task_after_changes_requested` 及同名函数 | 专门根据旧分镜退回事件自动创建 `draft_storyboard`，不负责当前权限或费用校验；函数唯一目录依赖为该触发器 |
| `public.tasks` 上的 `create_storyboard_revision_review_package_after_task` 及 `create_storyboard_revision_review_package()` | 专门将旧 `draft_storyboard_revision` 完成结果转成新审核包并自动批准；没有其他调用者，函数唯一目录依赖为该触发器 |

迁移使用明确签名和默认RESTRICT，先删除触发器，再按调用顺序删除函数；没有CASCADE、忽略缺失、数据改写或新增权限。删除3个陈旧公开RPC类型。冻结基线和归档SQL原文不改。

有效函数体、目录依赖和源码消费者均已核对。`pg_depend` 不完整记录PL/pgSQL函数体调用，因此同时检查有效函数体、HTTP允许集合和Worker封闭RPC端口；未把目录依赖为空当作唯一证据。删除对象的定义摘要、ACL和调用边见 `dependency-audit.json`。

## 必须保留的边界

| 保留对象 | 原因与验证 |
| --- | --- |
| 成员证据冻结、`record_pre_render_member_dependencies` | 当前 `create_shot_preparation_review_package` 仍由准备冻结及审核渲染使用；保留裁剪区间证据和依赖失效登记 |
| 审核包绑定、审核前置校验、依赖失效及读版本触发器 | 共用表上的权限、版本和失效保护，不是旧派单器；全部保留定义、启用状态、约束和ACL精确一致 |
| 脚本修订物化、准备草稿初始化、历史音轨复用及旁白失效保护 | 仍属于共用审核/历史输入处理，不能随删除旧执行入口而丢掉已保留的草稿、音轨和上下游关系 |
| 当前QC问题、成员返工及Studio合成修订 | 与旧预渲染成员审核是不同入口；当前命令和SQL定义/权限不变，合成修订实际集成通过 |
| 共享Worker租约、输出路径/产物校验及历史结果回写 | 旧规划任务不再被领取；合法历史租约的迟到回执仍可留证，不再自动生成或批准旧分镜包。实际验证错误租约42501、错误冻结路径22023、无部分写入，合法回执保存任务/产物/运行结果且当前阶段、包和批准记录不变 |
| 批注、成员、审核决定、任务、审核包、产物、审计和依赖表 | 承载历史及当前证据；未删除、重写或削弱RLS。非空旧记录完整导出恢复、Owner读取隔离和直接approval写入拒绝通过 |

脚本、视觉返工和初次分镜规划触发器属于其他生产链，本轮保留现状，未把范围扩大到整套旧审核状态机；这不表示它们永远不可清理。剩余函数清单已更新为17项，不再把本轮已删除对象列为候选。

## 完整验证

固定私有源码副本，按原 `package-lock.json` 安装隔离依赖；先运行既有 `runtime:prepare` 再执行默认回归，保留共享依赖和其他未提交工作。

| 检查 | 实际结果 |
| --- | --- |
| 默认回归 | 单次完整运行291文件、2108项通过，0失败/跳过 |
| TypeScript、Worker/backend编译 | 通过；任务源码与验证副本摘要一致 |
| 新增定向 | 非空旧批注/审核/任务完整恢复、意外依赖阻断、中途失败回滚、全部业务行/保留定义/触发器/ACL/序列/角色、幂等、旧HTTP和SQL不执行、Owner和CSRF及旧回执重放保护、脚本重新确认，3项通过 |
| 当前结构、字幕、原生保存 | 16项通过；包括最后镜头拒绝、完整正文/音轨保持、原图/历史工程不变、当前字幕校时/安全区及采用后的失效 |
| 当前旁白、交付、恢复 | 22项通过；实际Worker、未知付费提交与显式重试、原声/口播窗口、精确交付及字节篡改拒绝、旧attempt围栏、非空预算历史、journal/receipt/config/ready四处SIGKILL恢复 |
| 前序迁移恢复兼容及当前合成修订 | 各1项通过；原前序迁移的拒绝、回滚和权限验收保留 |
| 历史迟到回执 | 另1项通过；保留共享回写而关闭旧自动审核投影，租约/冻结路径拒绝保持 |
| Schema矩阵 | 空库、083旧前缀、旧完整历史迁移升级、旧连接历史、故障回滚、幂等、目录及保留权限一致通过；120张表、安全对象563个 |

以上合计44个不同集成用例通过。摘要和逐次原始结果见 `verification-summary.json` 及子目录，重复复验不累计为不同案例。原生字幕专属浏览器开关未启用，1项未执行；正则筛选之外的案例只是未选中，不计为通过。没有宣称全部集成或所有浏览器分支均已执行。

复验入口：

```sh
node scripts/e2e/run.mjs src/local-app/retiredShotReviewSql.integration.test.ts src/local-app/productionRevisions.integration.test.ts --exclude '**/storyE2e.integration.test.ts'
node scripts/e2e/clean-schema.mjs
npm run runtime:prepare
npm run check
npm test -- --maxWorkers=2
```

新恢复测试使用真实Owner旧入口先生成非空批注及已批准成员决定，再进行完整SQL导出/恢复和174迁移；对账所有业务表，而非只核对行数。测试显式固定7个目标签名，避免从迁移本身推导“应删除什么”。历史Worker回执测试使用真实SQL端口和有效旧租约，保留错误租约/路径的负向检查，没有伪造权限授予。

旧 `productionRevisions` 专项测试仍预期旧结构修订成功，并自行加载日常运行环境/旧迁移；现改用已隔离的当前HTTP/文件夹具，只验证仍支持的脚本重新确认。Owner、CSRF、版本、运行中、幂等、原文件及历史失效断言保留，旧修订拒绝由专属回归覆盖。

首次新夹具的两处错误保留在 `initial/`：依赖视图误用无 `id` 的返回记录；v2脚本追加了未标注长句而被格式校验拒绝。分别改用真实主键列、在原口播字段中修改文本后通过；没有放松校验。

## 日常应用与恢复

应用前完整私有逻辑导出，恢复到同集群独占候选并逐项对账；候选演练174后，再确认日常业务/目录/权限和服务未漂移，才应用同一事务。日常应用成功，ledger从171增至172条。

- 120张非ledger表、203行精确保持；全部序列、角色、原ledger保持。
- 除明确删除的7个函数和2个触发器外，全部catalog、函数定义、触发器启用状态及ACL精确保持。
- 原冻结旧库及既有恢复材料保持；配置和App记录字节保持，PID51263、HTTP200，未重启或切库。
- 候选确认无客户端后删除。完整恢复导出和前后对账材料保留于 `.loop-control/local/shot-review-cleanup-174-5c8459535132/`；公开回执见 `daily-result.json`。

日常当前无真实业务任务；真实制作、权限、文件和恢复结论来自上述隔离集成，未发起付费供应商生成，未评估真实成片质量。不提交、不推送。

本轮6个E2E容器和schema矩阵容器均已移除；核对无进程引用后，12份E2E源码/SDK副本和独立源码/依赖副本共14份已清理，所有通过/失败日志及私有恢复材料保留。清单见 `cleanup.json`。
