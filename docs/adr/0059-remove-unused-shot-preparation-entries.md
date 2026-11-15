# ADR-0059：移除无消费者的旧镜头准备入口

状态：Accepted。日期：2026-11-13。

用户授权检查 7 个旧镜头准备入口，仅在当前功能、保存运行包和历史恢复均无依赖后清理，不删除历史草稿、音轨和冻结证据，不放宽保护，不提交、不推送。

日常 178 有效定义中，7 个入口均仅 postgres 有执行权限，无有效 SQL 调用者或传入目录依赖；当前运行源码只有 6 个陈旧类型条目，全部 23 个保存包无名称引用。当前工作区准备、草稿／音轨读取、历史工程接入、显式生成、确认、冻结、复用和恢复使用保留链。

新增 179 仅删除 `public.confirm_shot_preparation(uuid,uuid,text,text,boolean)`、`public.freeze_shot_preparation_batch(uuid,uuid)`、`public.replace_manual_shot_media(uuid,uuid,text,uuid,text)`、`public.save_shot_clip_draft(uuid,uuid,text,uuid,numeric,numeric)`、`public.set_shot_tts_confirmation(uuid,uuid,text,boolean)`、`public.skip_shot_preparation(uuid,uuid,text,text)`、`public.restore_completed_shot_tts_track(uuid,uuid)`，移除相应 6 个类型条目。使用默认 RESTRICT，无 CASCADE、数据更新、权限授予或触发器拆除；历史 SQL、运行包和原记录保持。

验收必须包含由有效旧合同构造的非空草稿、音轨和冻结证据，完整 SQL 导出恢复后迁移；核对所有业务行、序列、角色、其余目录／触发器／ACL 和 ledger，覆盖真实依赖阻断、注入错误回滚及幂等。实际历史音轨／工程接入、当前生成／确认／字幕／交付／恢复和保存包模块另行集成验证，保留冻结输入拒绝与 Owner 隔离。

日常完整备份、候选恢复演练及无漂移核对后应用 179，保持统计采集关闭，不重启或部署。原冻结旧库、历史原文、恢复材料和其他并行改动保留。实际决定及验证证据见 `docs/verification/shot-preparation-entry-cleanup-20261113/REPORT.md`。
