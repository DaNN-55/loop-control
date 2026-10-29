# Standards

固定范围：`8ec17edf...3b7da737`。P1：0；P2：2。

- **P2｜新工程阻断永久删除。** `db/local/084-four-step-workspace.sql:4–7,25–29` 新增 `REFERENCES public.review_packages(id)` 和 Episode `ON DELETE RESTRICT`，但最终 `public.delete_episode` 仍是 `068-archived-episode-deletion.sql:84–101` 的固定删除序列，没有清理 workspace 或其子表。建立四步工程、归档，再经 `LocalEpisodeLifecycle → delete_owned_input_episode → delete_episode` 删除时，删除审核包即触发 FK 拒绝并回滚；有音轨时可更早受其他新 FK 阻塞。违反 **ADR-0001「已归档的普通生产单也可永久删除」**及用户规则「保留正常功能」。建议前向迁移，在现有受控删除事务内按依赖顺序清理本 Episode 的全部 workspace 子记录及父记录；保留原 Owner、归档、任务/锁和文件暂存围栏。用真实四步工程覆盖计划→归档→删除以及失败回滚。

- **P2｜静音口播仍被交付元数据声明为实际完整采用。** `src/local-app/workspaceDeliveryCommands.ts:62` 的 hunk `voice=audible&&Number(item.volume??1)>0` 忽略 `timeline.tracks[String(item.track)].muted`。完整 TTS 所在原生轨道设为静音后，`:43–45` 仍会产生 `adoptedText` 和 `textCoverage:'complete_source'`。违反 **ADR-0016「当前主声从实际原生路由读取」「采用正文绑定真实音轨」**。建议窗口遍历同时累积当前及父序列轨道静音状态；新增静音叶音轨和静音父序列的交付元数据验证。

  **判断项（heuristic，不另计问题）：Duplicated Code。** 同类判定已在 `src/workspaceAudio.ts:70` 写成 `Number(i.volume??1)>0&&…?.muted!==true`，交付模块重新实现而发生语义分叉。可共用小型可听性判定，保留交付特有的窗口遍历；不必重构整个投影层。

限制：仅静态只读审查实际源码、SQL、Adapter/Worker/宿主边界及相关规则；未运行 HTTP、DB、渲染或浏览器验证。未把行政收尾当作缺陷；证据目录未逐个媒体重验。
