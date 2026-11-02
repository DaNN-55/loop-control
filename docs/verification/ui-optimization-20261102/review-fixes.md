# 最终审查修复

实现者：final_review_fixes。所有修改均位于共享工作树；未执行 Git 写入、启动／重启服务、数据库写入、真实 Provider／Keychain 调用。

## 修复

1. 普通搜索在实际 250 ms 搜索边界保存 q/category/page/open；清空关键词走同一边界。仅 searchQ/searchOpen 改变时 replace 当前历史项，避免每个生效关键词新增浏览器历史。Owner 边界、打开结果的离开保护和分类／分页的前进后退保留。
2. 两个口播入口复用轻量 `useWorkspaceCandidateReview`：prepare 返回的实际 impact 先展示，必须第二次明确确认；确认前重读当前工程 SHA，发生变化时拒绝旧计划。原生应用完成后使用保存后的 revision 确认；切换镜头／输入／时长策略使用新的 ownership token，旧计划不会重新出现。人工口播候选同样先核对影响。缩短音频使用「播放此口播」文案。
3. 原生「口播版本」使用实际 generationTask 状态、未知提交提示和原 publication reconciliation。未知结果禁止新生成；刷新核对只读取；publication 使用现有 native-output/reconcile 恢复本次发布。明确提交前再次读取，如这时出现未知／活动任务，停止 save/confirm/generate POST。语音当前投影没有 providerTaskId/canResume，未虚构供应商续跑协议，也未改原 NarrationRow 的不可达 resume 回调。
4. speech settings 在 sessionStorage 读取边界校验非空对象、voice/languageCode/speakingRate 及嵌套 speech selection 的结构；不合格回退保存基准。legacy 设置合并后同样校验，错误类型不再覆盖默认字段。
5. 两标签公开表单复现后修复：reset 只删除本标签精确拥有的 raw；beforeunload 对本标签内容未变化的重复 persist 不再覆盖另一标签较新草稿。
6. 非阻断参数标签重复：`videoGenerationSettings.ts` 统一类型完整的 `wanSettingLabels`，VisualRecord 同文件两个块复用 VideoSettingsFacts，Preparation 不兼容提示复用标签。
7. 9 条类型诊断：删除未用 act；明确 Map<string,string>；OpenChatCutProject 单时间线 tuple；真实文档读取使用 OpenChatCutProject 类型、直接匹配 transform 对象；无效查询夹具显式 Record<string,string>[]。未用 any blanket。

## 拥有／释放的路径

- src/local-app/WorkspaceSearchPanel.tsx
- src/local-app/catalogNavigation.tsx
- src/local-app/LocalCatalogApp.search.test.tsx
- src/local-app/WorkspaceCandidateImpact.tsx
- src/local-app/useWorkspaceCandidateReview.ts（新增，Git 未跟踪，需 root 显式暂存）
- src/local-app/WorkspaceCandidatesPanel.tsx
- src/local-app/WorkspaceCandidatesPanel.test.tsx
- src/local-app/WorkspaceNarrationPanel.tsx
- src/local-app/WorkspaceNarrationPanel.test.tsx
- src/local-app/workspaceSettingsDraft.ts
- src/local-app/WorkspaceDraft.tsx
- src/local-app/LocalCatalogApp.drafts.test.tsx
- src/local-app/WorkspaceVisualRecord.tsx
- src/local-app/WorkspaceVisualPreparation.tsx
- src/videoGenerationSettings.ts
- src/local-app/LocalCatalogApp.password-dialog.test.tsx
- src/local-app/secretAdministration.integration.test.ts
- src/local-app/WorkspaceCompletedShots.test.tsx
- src/local-app/workspaceReadonlyRecords.integration.test.ts
- src/local-app/workspaceSearch.integration.test.ts

未修改 productionSelection.integration.test.ts、PLAN、registry、根负责的旧断言文件／文档。

## 红绿与验证

以下均通过公开组件 UI／浏览器存储边界，fetch/command 替身只位于 HTTP 边界；未将组件内部逻辑 mock 掉。命令基础：`npx vitest run <files> --maxWorkers=1 --fileParallelism=false --testTimeout=15000`。

- Settings malformed + legacy：red 5 failed / 10 passed → green 15/15；日志 /private/tmp/final-settings-{red,green}.log。
- 普通搜索刷新：red 1 failed / 2 passed → green 3/3；清空搜索 red 1 failed / 3 passed → green 4/4。保留原 Back/Forward、guard、outside 参数检查。日志 /private/tmp/final-search-{red,green}.log、final-search-clear-{red,green}.log。
- 两标签 reset：公开 LocalCatalogApp 表单 red 1 failed / 3 passed → green 4/4；beforeunload red 1 failed / 4 passed → green 5/5。日志 /private/tmp/final-draft-{red,green}.log、final-unload-{red,green}.log。
- 口播两入口影响核对（含 manual）：red 2 failed / 13 passed → green 15/15；原生口播影响／未知提交／publication red 3 failed / 1 passed → green 4/4。日志 /private/tmp/final-impact-{red,green}.log、final-native-{red,green}.log。
- 旧时长策略计划：red 1 failed / 4 passed → green 20/20（合并两个候选表单）；日志 /private/tmp/final-plan-{red,green}.log。
- 明确提交前新出现未知任务：red 1 failed / 6 passed → 下述最终 42/42 green；日志 /private/tmp/final-unknown-race-red.log。
- 最后定向组合：WorkspaceCandidatesPanel、WorkspaceNarrationPanel、WorkspaceVisualTaskStatus、LocalCatalogApp.search、LocalCatalogApp.drafts、WorkspaceCompletedShots，6 files / 42 tests 全部通过。日志 /private/tmp/final-focused-green.log。
- 类型修复中执行 `npx tsc -b --pretty false`：原 9 条清除，中间 2 条剩余再修后退出 0；/private/tmp/final-worker-types.log（最后内容为空）。之后候选和标签有小改动，最终完整 check 由 root 重新执行。

## 限制

本实现者未运行全量 suite/build、真实浏览器截图或 HTTP/PG/Worker 集成；这些由 root／ticket32 的最终统一验收负责。现有 focused suite 含 React act 提示，断言全部通过。标准审查非阻断标签调整为原行为保持的局部提取，不额外编写镜像测试。未将 archive 缺编译 dist 的六条 runtime 测试诊断改成产品修复。
