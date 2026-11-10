# ADR-0032：统一镜头视频任务与历史协议兼容

状态：已获用户授权，隔离实现待核对，尚未迁移。日期：2026-11-10。延续 ADR-0018 的统一视频来源，替代当前工作台新写入的 A/B Worker 名称。

新版工作台按操作写入 `generate_shot_video / shot_video_generation`、`search_shot_video / shot_video_search`、`preview_shot_video / shot_video_preview`。生成产物类型为 `shot_video`；检索与预览保留各自实际结果类型。冻结视频请求统一放在 `media.video`，当前任务的 shot 不保存 A/B 分类。生成、检索、预览不冒充最终成片任务。

156 前向迁移只扩展类型约束、函数和触发器，不批量更新任务行。新请求在 INSERT 时、现有原生输出命名空间触发器之前确定任务身份；旧排队链完成设置冻结后，外层将本次新任务的 payload 转为统一协议。任务身份和已领取输出的不可变约束原样保留，不增加“允许改写旧身份”的例外。

已存在 task_id 的请求及旧任务保持原 task_type、capability、输入、输出约定和 Provider ID。Worker 同时读取 media.video 与旧 wan_video／b_roll；Adapter 声明保留旧 capability。旧已提交任务升级后只轮询已有任务，不再 POST；未知提交仍禁止新建或更换描述绕过。资源并发、逐次费用预留、Owner／连接／租约和文件哈希边界继续共用原机制。旧任务仅允许原有运行资源分配元数据变化，不借兼容迁移重冻结创作输入。

旧蓝图、旧 storyboard/v1、历史 RPC 和生成类型保留兼容读边界，不作为当前新工作台的业务分类。media.bRoll 是旧 Worker Adapter 内部结构；新持久化请求不再写 b_roll。若后续替换 storyboard/v1，另立版本，不能直接把原协议必填字段改成 optional。

验证覆盖 155→156 带已提交旧任务的真实升级、单次 Provider 提交的恢复、新旧混合并发、不可变输出租约、未知提交防重、Pexels 失败重试及明确采用、四家供应商模型冻结参数与 Worker 输出。受控网络验证不代表真实供应商质量验收，不使用日常数据库或付费调用。
