# E2 职责与保护对应


> 产物清理记录（2026-11-18）：本目录的历史测试生成附件已按用户要求清理；本文验收结论保留。源测试输入、恢复资料、生产单和数据库未删除。

本表对应199前向迁移，原有效定义取自专属禁网库197（198只删除无消费者旧壳）。不修改原迁移、原包或历史行。当前执行协议提升为production-workspace/v2；manifest版本仍5，协议仍参与身份SHA。

| 原实现链 | 当前职责 | 必须保持的检查与证据 |
| --- | --- | --- |
| managed/general的pre_lease→legacy领取→lease包装 | claim_scheduled_worker_task持有单笔调度；managed入口及原public入口只选择原范围 | 角色、正容量、全局容量锁→恢复→排序资源锁；历史／失效／available_at／attempt／Provider过滤；各自running计数与turn来源；只领取已检查candidate；attempt/run/package/lease与prompt上下文保持。实际NULLpoll红绿、容量2／本机资源1通过 |
| input_task_allowed两代包装 | 一个有效谓词 | 原Episode启用与能力、结构修订在途保护、当前交付例外、归档／完成及回收站栅栏原样保持 |
| media_connection的audio/video/image前代链 | 按实际来源直接解析 | 原音频／视频冻结credential/executor、图片固定Provider/Adapter、历史媒体current-version约束各自保持；Owner、secret引用、keychain绑定、qualified、live verified、revoked及lease保护不合并成较宽条件；Pexels当前基准重核验保持 |
| submission_before_dispatch_facts包装 | 单一声音／视觉提交回执操作 | 原参数名、刷新lease、received/rejected白名单、原submission谓词及dispatch事实的task/attempt/token/dispatching条件保持；结果未知不获得重复外发资格 |
| input_worker_call三层 | execute_managed_worker_command | 先角色与publication fence，再按真实delivery身份处理；交付锁仍episode→workspace→task，确切导出／deliveryIdentity／manifest及原输入检查保持；通用路径仍能力资格、冻结主路径、output authority冲突和原媒体登记。首次发布、提交及持久恢复消费者同步 |
| 两个审批AFTER触发器 | 单一initialize_historical_shot_inputs | seed→reuse原次序用有名块保持，各块原早退只退出自身，最后仍在失效旧叙述任务前运行；原文件与输入不重建、不扩大审批资格 |
| 混合的视觉／分镜完成触发器 | validate→project，trigger只负责时机 | 原当前工作区跳过规则、原stage、completed run与attempt、required artifact、路径／SHA／大小、storyboard/v1、镜头唯一／字段和冻结main/visual inputBasis逐项保持；验证成功才写原历史审核包／关联／stage／audit。实际伪造拒绝及合法投影通过 |

内部实现与历史验证／投影不授予loop_app／loop_owner／loop_worker／loop_anonymous执行权，Worker只通过受控入口；既有公开函数ACL保留。迁移用例逐项比对非目标catalog／ACL、原行／序列／roles，依赖阻止、失败回滚、升级幂等与完整dump恢复均检查。不会把函数层数减少本身当性能证明。

本轮捕捉并关闭三处整合错误：内联领取的candidate约束丢失（真实NULLpoll红灯）、visual参数名及未合并前代调用（初始化拒绝）、合并后交付行变量t遮蔽通用SQL别名（真实结果回执失败）。修复未放宽检查，所有失败原始结果单列保留。最终整合核心23项通过，媒体分支已验证，200最终18项通过；最终G保留。

200补齐visual queue完整事务：原缓存重放、Owner／单次确认、冻结连接、当前基准／目标锁、未知请求保护、创建任务、参数与预算写入、shot协议依原次序保留。删除三代前代函数及无消费者Pexels前代；原始199及其结果不改写。
