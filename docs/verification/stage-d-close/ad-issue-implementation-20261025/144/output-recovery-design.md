# #144 任务输出与显式恢复设计

状态：源码与 focused 检查已完成；040 迁移、真实结果登记和 Owner CLI 的新隔离库验收待执行。本文件不关闭 #144，不宣称文件系统与数据库有共同原子事务。

## 原因与范围

原发布器持有有效任务租约，将候选文件写入冻结路径后登记数据库结果。确定的登记错误已经能在原任务锁内恢复旧文件；但 COMMIT 或连接结果未知时，盲目恢复会覆盖数据库可能已登记的新字节。同一 Episode 的分镜重修等正常流程还会让多个任务使用同一冻结文件路径，从而影响旧产物索引。

本补修只处理 #144。SQL 一致性建议 #146、#147 继续暂停。旧任务输入、历史迁移、预算、尝试编号、5 分钟心跳、30 分钟租约、审批及 Provider 行为保持原约束。源码之外的旧库和生产环境不在本补修执行范围。

## 040 的新任务路径

`040-native-output-publication.sql` 只在插入已授权的 native ready/attempt=0 任务时设置 `native_output_namespace=<taskUUID>`，将主输出冻结为 `episodes/<episodeUUID>/native-tasks/<taskUUID>/<原文件名>`。原文件名与扩展名保留。

019、025、028 的正常命令会在 INSERT 后继续更新新任务的路径。相同触发器只对带本任务标记、尚未领取的任务归一化这些更新。领取后的主输出契约、工程输出路径和任务身份不可改写。迁移不批量 UPDATE 旧任务；没有标记的旧输入不会被归一化。

已追踪的额外输出字段只有 `review_render.project_relative_path` 与 `final_render.project_relative_path`。它们随主输出进入同一 task 目录。冻结来源、审核渲染来源、`input_artifacts`、成员和 `studio_project` 引用保持原值。OpenChatCut 的 project/runtime/QC 产物由新的工程目录派生；card 工程原本含 task UUID，继续沿用。原生视觉图片额外传入当前 task 的 `visuals` 目录；legacy 调用的默认目录不变。

## 发布前的数据库权威

`native_output_authority(taskId,attempt,token,paths)` 是有界的 Worker 函数。它不授予 Worker 表读取或无围栏写入权限。

- 当前 running 尝试仍须通过原 `input_task_allowed` 和 `assert_worker_lease`。
- completed 核对依赖持久的本机 Episode、最新任务尝试、保留在 task_run 中的 token、状态及结果；不因后续能力开关关闭而误判已提交结果。
- 新任务路径只能在本 task 的 namespace 内，card 工程只允许原本含本 task UUID 的路径。旧任务只能使用其冻结主输出、冻结工程派生的有限 sidecar，以及本 task 的 namespace。
- 先锁任务行，再按稳定顺序锁文件路径；两类锁都在 SAVEPOINT 之前取得。SQL 错误恢复 SAVEPOINT 后，原行锁与路径锁持续保留，直到文件恢复完成后才整体回滚。
- 发现其他 task 已索引同一路径，发布直接拒绝；不覆盖旧字节，不改写旧索引。

这同时拒绝一个有效 Worker fence 写入同 Episode 下另一尚未索引的新任务 namespace。不能把「同 Episode」误当成写任意输出的权限。

## Owner 显式恢复

发布器在第一次替换文件前写入 `publication-receipt-private.json`。凭据含原冻结任务包、结果、文件指纹、旧备份指纹和 fence，因此必须保留为 0600 私有材料，不进入提交或公开报告。凭据的内容 SHA 只检测损坏，不能作为签名；可重算的私有文件不能替代数据库冻结契约。凭据采用临时文件、文件同步、rename 与目录同步。候选与旧备份保留独立文件。

恢复只读取这份凭据，复用现有 `validateWorkerResult` 校验结果协议。恢复与普通发布还会逐字段核对数据库返回的冻结主输出和工程输出；完成结果必须包含冻结主产物的精确类型与路径。原 native 命令分派也添加这项数据库侧检查，绕过 CLI 的报告仍不能改写主路径。数据库 jsonb 的对象键顺序不作为差异；已登记结果采用结构相等检查。

| 数据库核对结果 | 恢复动作 |
| --- | --- |
| 同一 completed 尝试，结果和全部登记 artifact SHA/大小匹配 | 按候选指纹补齐文件，不重复登记，不执行执行器 |
| 同一有效 running fence，没有登记输出 | 持任务和路径锁恢复旧文件，再发布已验证候选并登记原结果；登记失败时仍在锁内恢复 |
| 新尝试、token 或冻结输入变化，其他 task 路径冲突 | 拒绝旧恢复，保留凭据 |
| 数据库不可达，COMMIT 或连接结果仍未知 | 保留 unknown，恢复数据库后由 Owner 显式重试；不盲目恢复、不退款预算 |
| 目标出现不属于候选或旧备份的字节，候选/备份损坏 | 拒绝覆盖，保留诊断与凭据 |

成功核对可重复运行。恢复不重跑规划器、FFmpeg、模型或 Provider，也不创建新尝试。恢复完成的私有凭据保留 `reconciled_completed` 状态，用于后续核查。

使用已准备的本机运行产物，由 Owner 显式运行：

```sh
node scripts/local/recover-native-output.mjs --deployment /absolute/private/deployment.json --staging /absolute/private/asset-root/.native-worker-attempts/<identity-hash>
```

CLI 复用本机部署和 Worker 数据库绑定，验证资产目录、规范 staging 路径及私有普通凭据文件。输出只有状态与是否补登记；错误不输出 token、数据库密码或原结果。数据库不可达时需要运营重试，这种状态不能登记为已恢复。

## 验证与保留门禁

focused 已覆盖真实文件读写、跨任务索引拒绝、正常发布、迟到旧执行器、文件描述符隔离、路径拒绝、多文件失败恢复、已提交结果核对、未提交结果补登记、恢复登记失败、数据库不可达和新尝试拒绝。它使用 SQL 端口替身，不能代替真实 PostgreSQL 验收。

新隔离库必须至少验证以下场景：

1. 040 前后历史任务输入与 artifact 记录摘要不变；正常新任务以及 INSERT 后命令更新均得到唯一 namespace，冻结来源不变。
2. 原冻结共享路径已有另一 task 索引时，真实 Worker 发布被拒绝，旧文件与索引不变；有效 fence 写另一 task 尚未索引的 namespace 也被拒绝。
3. 真实 SQL 错误后恢复 SAVEPOINT，第二连接的任务 NOWAIT 返回 55P03，路径 advisory try-lock 返回 false；旧文件在整体 ROLLBACK 之前恢复。
4. COMMIT 实际成功但客户端抛错：新连接和 Owner CLI 根据实际已登记 SHA 核对，连续执行不重复登记或运行执行器。
5. COMMIT 未执行、连接实际断开：同一有效尝试下 Owner CLI 登记已验证结果；确定的登记失败仍恢复旧字节。
6. 新 attempt/token、非法路径、损坏凭据、重算凭据后改写冻结主路径、直接报告非冻结主路径和不可用数据库拒绝，历史失败与私有诊断保留。

之前 1804 秒自然租约演练与原 watcher 误判失败继续保留；该证据证明当时源码的活进程隔离，不能冒称本次新 SQL/恢复入口已经验收。全部历史未验收门禁继续保留，直至本轮真实检查完成并另行记录。
