# #162 / T10 工作台镜头编辑验收

本地实现镜头导航、真实原生结构编辑、稳定 shot 字幕身份和紧凑原生控件。OpenChatCut 仍是唯一编辑权威；原始材料、approved storyboard 和历史工程未被结构操作删除或覆盖。所有运行验证使用随机数据库、临时媒体根和独立浏览器会话，没有修改日常数据库、调用 Keychain 或发送付费 Provider 请求。

## 结果与证据

| 范围 | 结果与实际证据 |
| --- | --- |
| 镜头导航 | 实际点击定位 native item；长简介、图标增删、折叠后切换、Alt+↑ 和拖放排序已在正式 Owner 路由操作。`portrait-1543.png`、`landscape-800-collapsed.png` 保留真实时间线。 |
| 结构持久化 | Owner HTTP 覆盖重排、失效 revision、重启恢复、保留 storyboard 字节；活跃结构保存后 open 复用同一 Studio URL。 |
| 范围与画面 | 实际范围、锁长、±1 帧、多个引用、并行布局、填充、焦点、淡化经 Owner 保存后由真实 Studio 读取；新增图片/原片保持注册来源，视频几何使用实际 640×360 而非占位 1080×1920。 |
| 稳定身份 | 同一 shot 的两个 visual range 只投影一条字幕和一份主声；旧重复 visual follow lanes 迁移后不重复正文/cue。源码/契约见 `CONTRACT.md`。 |
| 主声与实际渲染 | 受控外部 Provider seam 返回真实 2.4 秒音频，经真实 Worker 注册/采用；删首 range 后同 task/track/item、完整 2400 ms cue、一条主声、一次提交。`structure-caption-voice.mp4` 为实际原生导出，`cross-ticket.json` 记录字节 SHA；统一声道布局后源/导出均值分别 -24.5/-24.6 dB，未出现叠加整段口播。 |
| 失败与恢复 | 只有两个画面引用时选择四宫格返回明确错误；当前原生实例未增加，简介草稿仍在。整页刷新、重开后草稿和已保存三字字幕恢复：`failed-draft.json`、`restored-draft.json`、`ui-caption-readback.json`。 |
| 横竖与响应 | 真实原生画幅切换及 1543/1280/1024/800 宽截图已检查，页面无横向溢出。1280×720、800×720 各三轮 Host 字幕/native 属性开关，Owner 手动再次展开属性仍可见画面；scoped AX 164–579 ms，后续双 rAF 7–203 ms。详见 `ui-tool-matrix.json` 和 `caption-and-native-*.png`。 |
| T11 边界 | 使用真实 used-content graph、字幕证据、原生 MP4 导出和精确文件确认回归；已修复迁移重排稳定 lane 导致选择保存错误增加内容 revision 的问题。 |

## TDD 与验证

测试 seam 沿既定真实 Owner HTTP、native Studio/project-store、实际 Remotion/export，以及 Host 与外部 iframe 消息边界。没有用内存时间线或 source-string 断言替代运行验证。

`red-owner-http.log` 先证明结构命令尚不存在；`red-native-session.log` 先证明结构保存后错误换了 Studio URL；`red-legacy-caption.log` 先证明重复旧 lane 使删首 range 被错误阻塞；`red-manual-fence.log` 与 `red-source-size.log` 先证明人工 revision 和源尺寸问题。每项修复后重跑同一 seam。

最终命令：

```sh
./node_modules/.bin/vitest run src/local-app/EmbeddedStudioHost.test.tsx \
  src/local-app/WorkspaceCaptionsPanel.test.tsx src/workspaceCaptions.test.ts \
  src/workspaceVideo.test.ts src/shotComposition.test.ts src/worker/openchatcutProject.test.ts
npm run build
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
./node_modules/.bin/vitest run --no-file-parallelism \
  src/local-app/workspaceShots.integration.test.ts \
  src/local-app/workspaceCaptions.integration.test.ts \
  src/local-app/workspaceExport.integration.test.ts
```

已合入最终 integration `ad167810`，保留 T12 的 094、Studio/交付互斥与 runtimePrepare 顺序。最终 TypeScript check、42 项受影响测试和完整 build 通过（保留现有 bundle 大小提示）。

真实回归的原始日志分开保留：`pre-t12-integration.log` 为 11/11；合入 T12 后 `post-t12-render-failure.log` 为 10/11，唯一失败是原生 MP4 引擎返回 retryable HTTP 500，提示 localhost:3000/index.html 无响应。root 分配串行渲染窗口后，同一用例原断言重试通过，见 `final-render-retry.log`（1/1，6 项无关跳过）。`final-integration.log` 汇总这组证据，结果包含一次明确重试。

只读端口观察记录在 `port-3000-observation.json`：重试期间 OpenChatCut Vite 子进程同时使用内部 3000 端口，重试结束后未见监听；未捕获失败时的跨进程竞争，不把冲突假设写成已证实根因。重试后已释放渲染窗口，没有停止其他验收进程。T10 自有媒体读取使用已版本化 helper，受控输入字节与原素材相同，见 `controlled-media-equivalence.json`。

## 边界与后续

本票没有把新增镜头写进 approved storyboard。新增 shot 的旧生成 RPC membership 问题交 T08/T13；actual source/none 与字幕的 resolver 接线交 T06；特定候选工具卡顿交 T08。具体字段、责任和不伪造批准约束见 `CONTRACT.md`。这些交接不等同已完成最终四步工作流验收。

本票验证受控 Worker/Provider seam 与真实本机渲染，没有验证真实付费 Provider 或部署到日常运行环境。未 push、关闭 Issue 或删除工作树。专用 UI Studio 正常保存退出，随后仅停止本票夹具/浏览器；随机数据库和临时媒体由 fixture 清理。
