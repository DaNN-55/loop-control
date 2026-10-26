# T06 两轴只读审查

固定基线 `474b0d3aa20d6bacf1f34cd16661da56552a1957`，按 `git diff --cached 474b0d3 --` 审查提交前的显式暂存差异。两位 code-reviewer 分别独立执行 Standards / Spec，不修改文件，不运行测试/数据库/服务。主 Agent 负责真实验证与汇总。

## Standards

初审1项重要发现：Origin存在时才校验，且与同一请求的Host比较，未完整满足ADR-0008精确来源要求。先用HTTP复现missing Origin得到202（red），后修为所有POST必须提供Origin，严格匹配socket实际监听端口和固定loopback主机，不再信任Host。新增missing/foreign/forged Host+Origin用例，正常Owner、重复完成、启动失败一并验证，14项HTTP测试通过；3个受影响隔离POST脚本补上固定Origin。

增量复审结论：原发现关闭，无新硬违规或可行动问题，暂存diff空白检查清洁。Possible Divergent Change：统一模块同时承接扫描、规划、构建和执行；沿用既有CLI职责，本票范围下可接受，不为此扩大抽象。

## Spec

无Critical/Important发现。按任务、Episode、全局定时共用候选扫描和Worker CLI，领取仍唯一经过现有claim RPC；持久tasks、冻结输入、容量、Owner、attempt/token/有效租约契约保持。未发现业务调用遗留绕过容量的旧Worker入口，未新增第二套公开API。B状态同步与T06范围符合授权。

可选记录：初审曾提示新复制red日志尾部空白。版本化复制件仅规范化尾空白，完整/tmp原始输出未变；原B日志完全保留。

结论：Standards 1项已关闭、0剩余；Spec 0项。无阻塞审查发现。完整回归与最终证据由主Agent在主报告记录。

主Agent最终增量核对：真实竞争harness先确认HTTP waiter再启动timer，排除timer自身两个消费者造成假阳性；收紧后真实演练通过。最终应用70文件674项通过使用单worker/15秒运行器预算，默认5秒旧UI超时仍保留；SQL21文件224条通过。无后续业务代码修改。
