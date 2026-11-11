# 第 11—13 项双轴审查

固定基线 `f7cc5190`，首审至 `fd109dc8`，复核至 `4e115024`。两名 fresh-context 只读 Agent，不修改、不运行测试。标准为 AGENTS.md、CONTEXT.md、ADR-0038/0039 与既有局部队列约定；按 code-review smell baseline 判断，项目约定优先。规格 SPEC.md，主 Agent 负责实际验收。

## Standards

无硬标准违例。人工口播元数据按 Owner／Episode／workspace／shot 归属，运行锁与订阅支持关闭重开，旧访问只更新原恢复事实；账号目录按账号键隔离读／打开／复制，复用真实 client；第 13 项使用原有真实隔离 fixture、实际 Owner 页面、计划与文件 SHA／重启检查，无新增持久协议或业务 SQL。

一项非阻断维护提示：可变 rows／running 需要配对 changed() 通知。当前变更路径均有通知，模块只服务一个局部流程，沿用页面会话方式；保留明确通知契约，不为本批扩展状态框架。

## Spec

初审 1 项 P2：人工口播起始 reader.read 会先发布工程；切镜头／模式时旧行仍挂载，原 scope 不会结束，后置 ownsManual 只能阻止命令，无法阻止读取发布。违反规格 11 的“旧访问结束后不…发布工程”。

已关闭：读取 scope 包含 manualKey（Owner／Episode／workspace／shot）、expanded 与 mode，复用原读取生命周期和取消守卫。公开组件挂起真实 GET、切镜头、晚回包，修复前发布 1 次，修复后不 onChanged／不 command。`4e115024` 只读复核确认关闭，无新增偏差或范围蔓延。第 12、13 项无规格发现。

Standards 0 硬违例；Spec 1 项已关闭、0 项未关闭。最终比较 `git diff f7cc5190...4e115024`。
