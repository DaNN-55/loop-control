前两轮停止后诊断：首轮新夹具对旧表用了不存在的 episode_id，v3 误带旧字段；第二轮误将旧音轨有效指针等同于保留来源，以及 v2 ASCII 设置边界插空行超出当前排版比较。核查 workspaceNarration.ts 的 current 指纹门槛、workspaceCandidates.ts 的 stale 状态，以及 workspaceScriptResume.ts 的 scriptBody 后，分别改为经工作区关联、当前 v3 字段、精确来源保留与旧确认不借用、末尾空白修订；产品源码无改动。
混合任务首轮在最后冻结快照比较失败：真实 Worker 领取按已有协议向 runtime_constraints 追加 resource_limits；其余业务内容与前置采用断言均已通过。改为业务字段及原全部约束精确一致，显式核对追加资源约束数组，不忽略整个 runtime_constraints。
启动器说明：第一次工具命令曾引用不存在的 tsx loader 路径，尚未启动runner/build/数据库/测试即退出；Node 24 原生TypeScript已可直接执行runner，随后均直接node运行。该启动器错误不计入任何测试通过或失败数量。
