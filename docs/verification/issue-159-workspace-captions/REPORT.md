# T07 字幕工作台验收

已实现跟随口播／独立字幕／关闭、位置、安全区、自定义边距、行数、每行字数、手工 cue、现有声学对齐任务与正文核对；改动保存在真实 OpenChatCut 工程。字幕编辑不要求逐镜头审批。

## 实现与证据

- `workspaceCaptions.ts` 是宿主／服务端／原生 Vite adapter 共用的目标 lane 适配器。每行字数通过真实 manual pages 和换行实现，未向原生写一个不被消费的 JSON 参数后宣称完成。
- `workspaceCaptionsCommands.ts` 通过现有 Owner事务／workspace版本CAS接入，复用原有对齐排队、手工校时、正文核对路径；迁移089只增加证据与受控字幕输入同步。仅目标正文、当前采用音轨和时间窗口影响目标证据；旧回调不自动写入工程。
- 新字幕工具在真实 iframe 旁按需展开，保留字段标签、错误与状态；未增加依赖。安装的第三方 OpenChatCut checkout未修改。

## 已执行

1. Native adapter／宿主／字幕Panel／原工作台Panel／旧原生工程与正文核对回归：最终7个相关测试文件、50项通过；包括native track-ID迁移、共享布局／颜色／lane顺序保持，以及native改画幅后的安全区派生。
2. `tsc -b`、`tsc -p tsconfig.local-app.json`、正式 `npm run build` 通过。Vite保留既有 >500kB chunk 提示，没有新增依赖。
3. `workspaceCaptions.integration.test.ts`：3项真实独立HTTP/DB/文件/原生Studio/Worker RPC/Remotion验收通过。包括保存／刷新／模式关闭、跟随口播变化仅过期目标、局部lane保留；真 `loop_worker` claim/report lease边界、当前对齐采用与正文核对、正文修改后的迟到结果拒绝。
4. 原生 `render-still` 横竖帧对照：竖屏640×1138检测4983个字幕变化像素，边界x245–394/y813–921；横屏640×360检测572个变化像素，边界x296–343/y287–321。均在当前title-safe内。见 `render-pixels.json`、`portrait-caption.jpg`、`landscape-caption.jpg`。已目视确认3字／行、2行。**这是实际Remotion静帧像素证据，不是正式视频export或交付审批。**
5. 独立Chrome会话操作真实工作台：4字改3字后「保存字幕」成功，公开bridge inspect实读仅1条原生规范化字幕轨、1个stable lane，Owner GET读回3字、timing=current、alerts=[]。见 `native-captions-ui.png`。按正式返回动作关闭本票Studio，专用浏览器已关闭。

## 实测发现与修复

- HTTP red首次缺命令返回400；随后实现闭态编辑往返。
- 原生会迁移track ID。首次live测试暴露旧key导致重复轨；按stable lane解析实际track修复，新增失败后转绿测试，并用全新fixture真实保存确认单轨单lane。该策略写入CONTRACT供T08/T10。
- Native JSON会排序对象键。读回先规范化契约，避免键序差异触发错误校验；实际cue与anchor从native读取；安全区preset使用当前native canvas纵横比，改画幅后不会继续沿旧preset。
- 局部修改不能替换共享auto-stack布局或丢弃native颜色，已补失败后转绿回归。
- 测试fixture缺scheduler singleton及enabled输入，均仅在随机测试库显式seed。渲染检查改用已有FFmpeg解码，并读取实际返回尺寸，避免将原生静帧缩放误当像素缺失。

## 边界与取舍

- 对齐验收只在外部模型边界使用固定时间戳响应；HTTP、任务队列、真实Worker角色/lease/RPC、产物文件、数据库trigger与原生文档均真实。未运行或下载本地WhisperX模型，未调用付费Provider；声学识别质量不在此受控测试中声称通过。
- 当前对齐结果在保存并返回后显式采用；活跃iframe中的正文／排版／手工cue通过native增量桥直接保存。T08可沿该桥扩展候选item编辑。
- UI最终整体A版布局、跨票集成及正式视频导出由root／T09／T11继续验收，本票证据不扩大为整套四步流程完成。
- 使用既有Impeccable Operate视觉与中文技术文案规则。检测仅给出沿用项目11px局部元数据字号等advisory；新色已改为现有语义Token。既有DESIGN.md sidecar过旧未在本票刷新。

## 隔离与复现

基线 `3fb5055d`，已merge最新integration `a96e4d075`（merge commit `3f6d612b`）；合并后T02/T04/T07真实原生集成共11项通过，见`merged-native-tests.log`。保留T04图片缺失409、native_edit_revision内容保存counter以及084+086+089迁移去重。唯一修改树 `t07-workspace-captions/loop-control`。所有DDL/DML在随机测试数据库、媒体在自建`/private/tmp/loop-153-*`、服务在随机回环端口。只读schema-only复制日常库；无日常DML/DDL、Keychain、付费调用、既有服务启停或第三方源码修改。

UI fixture的tsx CLI wrapper在首次停止时先关闭Docker streams；已按确切记录逐一清理本票DB/媒体根，无前缀删除。driver已改用`node --import`并在该专用进程内替换Vite提前退出信号handler；最终smoke以确切PID SIGTERM退出码0，媒体根已自动移除，数据库清理已核验。driver与测试复现命令见CONTRACT。
