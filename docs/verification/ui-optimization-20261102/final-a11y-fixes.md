# 最终 axe 与搜索键盘修复

仅修复正式验收确认的两项 ARIA 语义缺陷及同一搜索键盘路径发现的 Escape 重开问题。未修改 installed SDK、日常服务、数据、32 harness 或 Git。

释放给 root 的路径：

- src/local-app/WorkspaceSearchPanel.tsx：移除原生 textbox 不支持的 aria-expanded，保留名称、打开时 aria-controls 和富结果 region；Escape 先恢复 input 焦点再关闭搜索，避免 onFocus 将结果重新展开。预览内 Escape 仍只关闭预览。
- src/local-app/LocalCatalogApp.search.test.tsx：公开 UI 增加结果 region 关联、ArrowDown 焦点、结果按钮 Escape 关闭及预览 Escape 返回结果的回归；原刷新／历史／guard 断言全部保留。
- scripts/openchatcut-accessibility.mjs：仅精确 MediaPoolCard.tsx 的 pinned 0.2.17 used-dot 接点补 role="img"，保留真实 SDK title/aria-label。表示静态状态图标，不创建 live status。保持 anchor drift 明确报错。
- scripts/openchatcut-accessibility.test.mjs（新增未跟踪）：通过实际导出的 SDK transform 边界，编译并 render used/unused badge，读取真实可访问 img 名称；不支持的接点明确报错。

红绿证据：

1. 搜索 aria-expanded：/private/tmp/final-axe-search-red.log，1 failed / 4 passed；移除后 /private/tmp/final-axe-search-green.log 5/5。
2. SDK badge：/private/tmp/final-axe-sdk-red.log，2 failed / 2；修补后在最终组合 2/2 green。初次尝试 Vite/esbuild 在 jsdom 下遇到 TextEncoder realm invariant，调整为项目已安装 TypeScript transpile，没有添加依赖。
3. 从结果按钮 Escape：/private/tmp/final-axe-escape-red.log，1 failed / 7 passed；正确恢复焦点／关闭顺序后 /private/tmp/final-axe-green.log，2 files / 8 tests 全部通过（串行、maxWorkers=1、testTimeout=15000）。
4. 只读读取本机 pinned SDK .loop-control/local/OpenChatCut/src/media/MediaPoolCard.tsx 并调用 patchNativeAccessibility：精确接点变换成功；未写 SDK。

本轮未运行全量 check/build 或真实浏览器 axe；root／32 在固定最终 HEAD 上继续统一验证。未触及 landmark-one-main / page-has-heading-one best-practice 项。
