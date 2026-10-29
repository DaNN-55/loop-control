# #156 图片工作台验收

隔离环境：随机独立 PostgreSQL database、`/private/tmp/loop-153-*` 媒体、随机本机端口。只读复用日常 runtime 代码和 OpenChatCut 安装；不读取 Keychain、不调用付费 Provider、不写日常业务行。

TDD：静帧命令缺失（400）→最小实现→HTTP/restart重读通过；推拉缺 keyframes→真实原生关键帧→Studio open/save和MP4渲染通过；缺失素材时validator泄漏ENOENT（503）→对应409阻塞通过；图片UI模块缺失→Owner显式提交行为通过。

调整记录：受控Provider夹具外部连接延迟外键要求事务；策略触发器的相同Owner资格失败连续两次后停止重复，检查`local_identity.owner_id()`源码定位到session_user必须为loop_app，调整fixture会话角色，不放宽生产校验。


## 实现与实际结果

- 同一素材入口可上传图片，显式选择静帧、本地推拉或首次 AI 视频。使用方式、初始时长与构图经真实 HTTP 写入 PostgreSQL 并在重新创建命令服务后恢复。
- 静帧与推拉直接使用原生 `image` asset/item，保留原图、稳定 item 与 source revision/hash；没有代理视频或外部任务。
- 横竖工程均经过真实 Studio 打开/保存，再由既有 `scripts/openchatcut-render.mjs` 调原生 `/export` 产生 2 秒、30 fps、60 帧 MP4。实际目视检查四帧拼图：前两帧保持静止，后两帧发生缩放和位移。
- 竖版 360×640：静帧 RGB 像素平均差 `0.00213`，推拉 `27.74559`；横版 640×360：静帧 `0.00332`，推拉 `28.46415`。证据在 `evidence/*-frames.png` 与 `*-observation.json`，完整 MP4 留于 `/private/tmp/loop-156-evidence/native-images-{portrait,landscape}.mp4`。
- 首次 AI 视频走现有 Seedance 配置、连接、预算、claim/lease、原生媒体执行与不可变材料登记。每镜预算预留 90 分，受控 Provider 每镜仅提交一次；两镜任务按反序收取均进入原生工程，再次打开仍为两个 video item。此为受控响应证明，无付费在线 Provider 证据。
- 人工编辑场景在原生 project-store 写入编辑内容，并通过真实 `saveWorkspaceStudio` 收回；`native_edit_revision` 从 0 变为 1。随后真实 Worker 完成的两个结果保留不可变材料，填入返回 409，原人工位置 `x=17` 和当前工程 SHA 保持不变。此测试验证持久层与保存边界；浏览器操作体验由主 Agent 验收。
- 原图缺失/指纹变化返回对应阻塞；已用缺图列入 `missingSources`，不能打开为有效素材。非法 Owner/CSRF、非法 ID/时长、无配置连接也经过真实 HTTP 拒绝，不新增替代任务。

## 最终检查

`LOOP_WORKSPACE_ACCEPTANCE=1` 配合已给定的 `LOOP_TEST_CONTEXT_MODULE` 与 `LOOP_TEST_OPENCHATCUT_ROOT`：

- `workspaceImages.integration.test.ts`：7 个真实 HTTP/PostgreSQL/Worker/Studio/原生渲染场景通过。
- `productionWorkspace.integration.test.ts`：1 个 T02 持久工作台、部分素材、保存恢复、错误回滚、重规划场景通过。与图片场景同次运行共 8 项通过，日志 `evidence/runtime.log`。
- 受影响的原生工程、媒体执行、嵌入保存、工作台与图片操作 UI 回归：5 个文件、45 项通过，日志 `evidence/regression.log`。
- `npm run backend:build`、`npm run build`（含 `tsc -b`）通过。Vite 保留已有 500 kB chunk 提示，未为本票引入依赖或拆包重构。
- 合并前核对 integration tip 为 `3fb5055d`；本分支已包含该基准，执行 merge 结果见提交交接。没有 push、关闭 Issue、删除工作树、日常服务启停、日常 DB 写入或 Keychain 读取。

## 浏览器验收与跨票交接

主 Agent 使用既有隔离浏览器 fixture 登录 Owner，打开一个已启用四步的 Episode；在“素材准备与匹配”通过该镜头“上传图片”选择文件，再选“静帧/本地推拉”、时长及展开的构图后点“匹配图片”。刷新确认选择保留；进入真实编辑器确认 image item、预览和原生关键帧可编辑，保存返回后重开。横竖及窄屏应检查控件换行和图片未压缩变形。静帧/推拉不需要配置外部连接。

AI 验收使用受控部署端口，选择已注册图片与既有连接；明确点击“生成首次视频”，完成后点“填入首次结果”。没有连接时保持阻塞。不要用 UI 任意更改 deployment-only controlled 模块或访问真实付费连接。

依照主 Agent 分工，T05 在其票内负责把 `readWorkspaceNarrationTarget` 接入首次图片生成并完成交叉验收。当前 T04 的 AI 时长来自 Owner 明确输入；不能把本报告解读为已证明实际口播驱动画面。接入时：tts/manual 必须读取当前成功音轨并冻结 audioTrackId/artifact/hash/inputFingerprint；none 才使用明确画面时长。目标使用时长按真实口播向上取到原生帧；Provider 时长单独映射到既有允许整数范围，超上限应明确阻塞，低于最小时可生成最小时但原生只采用实际目标窗口，并显示差异。不可删词、变速、循环或回退旧估算。请求阶段确定占位时长；收取结果只换来源，且重验音轨与图片身份。

T07 保留原生 image/transform/keyframes，本票未改桥。后续手改后候选采用由 T08/T09 接入。最终交付 readiness 保持 false，T11 完成真实已用媒体/导出校验。
