# T09：事件提醒、独立运维结果

2026-10-23，基线 `52e4d3b`，仅 `codex/local-first-stage-a` 优化工作树和 verified 隔离目标。按 Owner 最新授权直接实现和测试；未通过原 Codex 对话发送提示词，没有操作被工具拒绝的 Codex 应用。

## 实现与契约

- 审核、状态、阻塞事件通过同一个消费入口。原有三个 notify CLI 名称共用 PostgreSQL 投递账本；n8n 继续负责触发，不新增公开 HTTP 通知 API。内部表启用 RLS，无 anon/authenticated 表权限，三个 RPC 仅 service_role 可执行，触发器函数位于不可公开访问的 `loop_internal`。
- 首次初始化只将当时可见历史标为 historical；有旧 `notifications-cursor.json` 时只跳过旧位置之前的事件。后续事件由审计插入触发器在同一事务写入 pending，不以 created_at 大小判断新旧。因此早开始、晚提交事务和同时间戳超过旧单页上限的事件不会漏掉。原子 SKIP LOCKED 领取提交后才投递，完成必须匹配随机 token；并发、重启不重复领取。
- 桌面通知接口无法提供与数据库同一事务的显示确认。成功只表示接口接受，不表示 Owner 已读。投递异常记 uncertain；进程中断留下 reserved，均不自动重发，以免重复。后续检查仍消费新事件，但对尚未确认的 reserved/uncertain 返回失败并在界面提示核对控制台队列。这是明确的至多一次投递取舍，不宣称严格 exactly-once 或零丢失。无效事件内容记 skipped，不谎称已发送。
- 日检显式 `Asia/Shanghai`，每天 09:00。n8n 不保留成功执行正文，保留失败；独立证据分别保存 schedule、notification、health、完整 backup、REST snapshot 的最近结果/成功/失败。每类最多三份结果文件，空闲成功不反复写入。跨类别和成功/失败文件不互相覆盖；读取按时间选最新，同毫秒保守显示失败。n8n 在线不再伪造健康检查时间；当前通知结果优先于旧 n8n 失败日志。
- 现有系统状态详情固定展示五类结果，未执行显示待确认。完整 v2 备份和 best_effort REST 部分快照分开；后者仍明确不可作为完整可恢复备份。B 的备份脚本支持 verified 并写独立备份结果。归档加入 `loop_internal`，权限清单包含该 schema 的对象与默认 ACL，public 指纹保持旧 v2 格式兼容。
- D 接管时复用：事务内事件入账、幂等初始化、原子 claim、token finish、未知不自动重发和独立结果查询；只替换触发来源，不放宽上述行为。当前仍保留 Supabase Auth/RPC 兼容层，没有开始 D。

## 真实隔离验收

目标 `loop-control-stage-b-verified`，API55461/DB55462；未启动常驻消费者或修改原任务，演练前后 tasks 全行摘要一致。前向迁移 `20261023152247` 只应用一次，现有迁移历史保留。

[真实运行摘要](real-result.json)与[HTTP 摘要](http-summary.json)：

- 两个消费者并发处理 1005 条同时间戳事件，连同其他样本共1009条受控接口接受记录，ID全部唯一。一次事务持有早至2001年的事件，另一事件先完成后再提交旧事务，晚提交事件仍被消费。
- 子进程真实 SIGKILL：受控通知接口已记录接受而来不及完成事务，数据库保持 reserved；重启不重发。另一次接口接受后故意抛错，保留 uncertain；重启不重发。本轮1007 accepted / 1 reserved / 1 uncertain，故障注入历史保留。真实 CLI 对未知结果退出1，独立结果为失败，没有将它当作成功。
- 健康 CLI 真正检查本机目录、Codex CLI版本和verified API；REST snapshot实际生成且 restorableBackup=false。完整备份先做明确无效目标的失败注入，再实际生成v2归档，最近成功和失败分别保留。
- 现有 `/_system-status` handler在独立loopback HTTP harness中使用真实verified Owner会话，200返回独立结果；无会话401。PATH刻意不提供Codex/Provider探测程序，避免在线调用，依赖状态不冒称健康。组件测试验证实际详情文案、独立失败与无记录状态。没有新增浏览器UI实测或桌面显示/Owner已读证明。

[空库恢复摘要](restore-result.json)：在同一verified容器新建空业务数据库，不清空任何旧库。管理schema仅复制真实schema结构，无Auth密码、会话、Vault行；恢复身份引用不是恢复登录。v2归档恢复后37表/5083行、264项对象/Owner/ACL/defaultACL指纹一致，242项备份媒体指纹已检查；内部触发器有效，历史accepted/reserved/uncertain不重放，authenticated没有claim权限。新增晚时间戳事件仍可领取，测试事务回滚。测试数据库保留，未验证恢复后的Owner密码登录。

## 回归与历史限制

最终默认5000ms应用回归74文件/690项通过；完整SQL23文件/258条通过；Node2项通过/1项既有本机n8n原生验证跳过；类型及Worker/编排准备构建通过。advisors退出0，仅三条既有RLS性能WARN，无新增安全错误。详见日志与checks.json。系统更新窗口内两份针对性测试14项中2项超时（13.37s/7.49s），原日志保留；更新后原默认预算重跑14项全过，总1.33s；不据此断言更新是唯一根因。既有 B/T06 默认5000ms审核台用例曾在同机对照中失败，时序根因未解决；T07/T08及本轮通过均不抹掉该历史，也不能证明根因已经修复。产品五秒领取时延与Vitest默认超时是不同指标。

保留失败：早期文件游标方案被真实语义/复审发现有并发、锁恢复、时间格式及晚提交漏洞，已改为数据库账本；没有把早期局部通过当最终验收。一次针对性命令匹配到忽略目录内T06历史快照，四个旧结构断言失败；后续沿用既有完整命令排除生成快照，不排除当前业务测试。Owner文件名测试夹具错误修正后重跑HTTP通过；空库管理schema恢复初用postgres角色无权设置supabase_admin，改用既有隔离管理员后恢复通过。advisors首次本地TLS连接失败，保留日志；本地服务本来不提供SSL，使用仅loopback目标的正确连接参数重查，没有修改服务器安全配置。最后发现部分快照失败文案误写为调度失败，先red再修复。

原始失败、成功、受控运输记录和恢复脚手架在忽略的verified state目录，索引列出路径、字节和SHA-256；公开报告不包含登录凭据、完整Auth会话或Provider秘密。备份和测试产物均保留在隔离环境。未推送、合并、部署、关闭Issue或切换生产；用户原有PLAN和无关规划材料不纳入本票提交。
