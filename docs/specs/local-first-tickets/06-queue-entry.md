# T06：即时与定时派发共用一条持久执行路径

**Stage:** C

**Status:** locally delivered — Owner 已认可 B 并授权 T06；实现、真实 verified 演练、完整应用/SQL回归及两轴审查已完成。本地提交以本票所在提交为记录，GitHub Issue [#112](https://github.com/DaNN-55/loop-control/issues/112) 保持 open/ready-for-agent；不推送/合并，不开始 T07 或 D。证据见 `docs/verification/stage-c-t06/README.md`（应用15秒运行器预算与默认5秒超时分别报告）。

## What to build

同一测试任务无论由按钮还是定时器触发，都通过统一队列领取、执行并回写到Episode详情。

## Acceptance criteria

- [x] 先扩展统一提交/执行入口，再迁移现有按任务、按Episode及定时调用；过渡期不保留绕过容量的入口。
- [x] 重复触发同一任务仅有一次有效执行，调用及时返回可查询状态。
- [x] 保留现有Worker结果与预检契约；用HTTP入口演示从提交到结果，不为内部模块新增重复公开API。

## Blocked by

- T05：Worker中断后的租约回收和安全重试

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。
