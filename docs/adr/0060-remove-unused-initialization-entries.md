# ADR-0060：移除无消费者的旧初始化与委托入口

状态：Accepted。日期：2026-11-13。

用户授权检查 5 个旧初始化／委托入口，仅在当前功能、保存运行包和历史恢复均无依赖后清理，不删除历史数据，不放宽保护，不提交、不推送。

日常 179 有效定义中，5 个目标均仅 postgres 有执行权限，无有效 SQL 调用者或传入目录依赖；当前运行源码只有 5 个陈旧类型条目，全部 23 个保存运行包无名称引用。当前首次账号创建使用本地目录 intent 和保留的创建路径；规则保存／激活使用 `update_current_blueprint`、`create_blueprint_version`、`activate_blueprint_version`；脚本由当前导入／修订与本地准备链处理。

新增 180 仅删除 `public.bootstrap_platform(text,text,text,jsonb)`、`public.commission_script(uuid,text,text)`、`public.set_episode_script_source(uuid,text)`、`public.apply_blueprint_to_episode(uuid,uuid,text,text)`、`public.deactivate_blueprint_version(uuid,uuid)`，移除对应 5 个类型条目。使用默认 RESTRICT，无 CASCADE、数据更新、权限授予或触发器拆除；保留全部账号、规则版本、当前指针、原 Episode 绑定、委托任务／运行包、脚本、Prompt 及冻结证据。

验收覆盖非空历史账号／规则版本／旧委托任务和冻结运行包的完整 SQL 导出恢复，真实依赖阻断、注入错误回滚、幂等及所有原行／目录／权限保持；通过真实 Owner HTTP 验证当前创建、规则保存／激活、引用版本保留、跨 Owner／CSRF／旧版本并发保护和脚本路径，旧 Codex 任务仍不可被现行 Worker 领取。原 Prompt 冻结、当前 Worker、费用、未知提交与恢复保护保持。

完整日常备份、候选恢复演练与无漂移核对后应用 180，保持统计采集关闭，不重启或部署，不修改原保存包、冻结旧库、历史 SQL 或其他并行改动。实际结果见 `docs/verification/initialization-entry-cleanup-20261113/REPORT.md`。
