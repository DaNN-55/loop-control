# 批量采用后端验收


> 产物清理记录（2026-11-18）：本目录的历史测试生成附件已按用户要求清理；本文验收结论保留。源测试输入、恢复资料、生产单和数据库未删除。

> 历史阶段记录，非当前待办或功能说明。批量制作已撤回；原验收数据和文件保持原路径。当前状态见 [撤回记录](../batch-retirement-20261116/REPORT.md)。

`adoptWorkspaceBatch` 接收当前 workspace revision／project SHA、kind，以及逐项选择：

- voice／visual：`candidateId`、服务端既有 `adoptionId`。
- captions：`clipId`、已完成 `taskId`、`expectedInputFingerprint`；预览仍用 `prepareWorkspaceCaptionAlignment` 返回 `captionContract`。

所有选中项先验证所属、候选状态、服务端采用记录、文件指纹与当前输入，再在内存合并并一次保存原生工程。任意项不成立，整批拒绝；字幕证据与候选采用决定受同一 Owner 事务保护。同镜头不能在一批中采用多个候选。原生编辑器打开时拒绝批量采用。历史／已完成只读沿用入口保护。

口播 prepare 在不可变采用记录 INSERT 时冻结 `reviewNarrationFingerprint`，避免同正文改变声音／语速后旧核对仍生效。批量采用要求该基准存在且匹配；旧单项 token 仍可沿用原单项协议，不会被本次变更自动重置。

## 实际验证

- 新增 `workspaceBatchAdoption.integration.test.ts`，真实 HTTP／Owner 会话／PostgreSQL／文件／受控本地 Provider：**4 条通过**，明细 `backend-vitest.json`。
- 覆盖口播、画面、字幕一批只增加一个工程 revision；第二项文件损坏／字幕输入过期时不写任何采用决定或新工程；同正文语速变更失效；HTTP 相同 idempotency key 返回原回执，不重复保存；重复镜头、错配 token、错误 workspace／候选、其他 Owner、无 CSRF、已完成只读均被拒绝。
- 现有单项回归：`workspaceCandidates.integration.test.ts` 的旧口播／源文件变更测试，以及 `workspaceCaptions.integration.test.ts` 的真实队列／晚到对齐结果测试，**2 条通过**。
- `npm exec -- tsc -p tsconfig.local-app.json --noEmit` 通过。

最终四条集成与单项回归使用主 Agent 创建的独立 PostgreSQL／SDK 环境，fixture 各自创建随机 `loop_studio_153_*` 库并在 finally 清理。初次 RED／实现调试使用相同 fixture 在默认 runtime 集群内创建的独立随机测试库，未写日常业务库。未调用真实付费 Provider，未修改已交付两单，未提交或推送。完整浏览器及导出由主 Agent 统一验收。

## 带原声视频补充验收

实际浏览器发现仅静态图片未覆盖的路径差异：持久采用 edit 的分离原声使用 episode 注册素材路径，旧批量校验误用了 native IPC 的 `/media/uploads/` 限制。新增真实生成视频集成先复现 409，再修复为「查验本期 audio material 身份／路径／SHA／文件，再以受控回调执行完整 edit 结构校验」。native 默认路径规则保持严格，真实 edit 不改写。

`backend-video-audio.json` 记录新增用例通过：两段受控 Provider 生成的有音轨 MP4 可一次采用；分离音轨文件损坏时整批拒绝且工程不变；恢复后视频与链接音轨落入保存工程并可重开。默认 native 校验仍拒绝持久相对路径。补充后共 5 条集成场景，新增一条定向执行，其余已通过场景未机械重跑。补充后的后端类型检查被并行改动 `src/local-app/completedStudioCopy.ts:1` 缺少 `.js` 扩展名阻断（TS2835）；未修改该范围外文件，已通知主 Agent。
