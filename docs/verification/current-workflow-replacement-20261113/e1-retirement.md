# E1 旧执行合同退役

迁移198精确删除七个已停止使用的拒绝函数、空script_production_scopes扫描器及无消费者record_episode_worker_preflight；默认RESTRICT阻止额外依赖，IF EXISTS支持原SQL幂等。没有删除业务表、原计划、轨、审批、文件或历史迁移。六个旧v2写命令及其当前实现已移除，认证／CSRF仍先运行，未知命令400；原script-production独立路由退出，生产单saved-plan及工作区来源保留Owner只读读取。

测试通过专用historicalSavedPlan.fixture.ts构造前退役记录，只被测试导入，不提供应用写入口。旧计划的实际使用仍经当前Owner HTTP显式接入；跨账号、原来源离线、当前编辑、错误SHA／原生工程优先等原断言保持。

先红确认旧合同仍存在；首次类型未过，之后真实回归中历史夹具误把账号root传为全局root，被原部署绑定保护拒绝；另有依赖view将setof record当单列。均只修夹具／测试，不改变生产边界。原始失败保留。

最终198固定源码：主批6文件 **19通过／0失败／1浏览器未启用**，来源批4文件 **17通过／0失败／0跳过**；完整类型及Worker／backend构建通过。包括真实旧计划接入、原呈现、完整备份与逐项恢复、存储故障、Owner跨账号与原口播保留。非空迁移实测额外依赖阻止、注入失败回滚，原行／序列／角色／非目标catalog与ACL逐项保持；升级后完整pg_dump→新库恢复及原主脚本关系对账通过。筛选／浏览器未执行不计通过。

Standards／Spec只读审查0开放项，见[evidence-e1/review.md](evidence-e1/review.md)。[结果与源码](evidence-e1/)分开保留red、fixture诊断、main和sources，不伪装成一次整轮全绿。自有禁网tmpfs容器均终态清理；不操作日常、不调用真实付费生成／视频API、不提交／推送。

E2继续合并实际SQL职责，并同步提升执行协议；F1／F2和最终G范围保持。本报告不代表全部A–G完成。
