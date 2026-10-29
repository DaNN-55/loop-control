# T09 / #161 验证记录

基准 integration `2fa83c1a`，工作树 `t09-workspace-visuals/loop-control`、分支 `codex/t09-workspace-visuals-152`。新增 091 及视觉候选域，中央文件仅作接线；Provider、任务、预算、授权、Owner 文件归属和 T08 严格 writable 门控继续沿用。

## 已验证结果

- 26 个受影响组件/Host/主声测试通过，含本票 10 个视觉 UI 与声音登记用例。
- 真实 HTTP/PG/Worker 回归 28 通过：T09 12、T08 7、T06 8、独立 embeddedStudio 1。首次组内该独立测试因专用开关跳过，随后显式启用 `LOOP_EMBEDDED_STUDIO_ACCEPTANCE=1` 单独复验通过。
- check、frontend build、runtime:prepare 通过，顺序为源码冻结→build→prepare→真实 Worker CLI；仅有原有 Vite 大 chunk 提示。最终保留 `dist/worker/local-app/localWorkerCli.js`。
- [worker-cli.json](evidence/worker-cli.json)：真正 prepared Worker 子进程，独立数据库/私有 APFS 媒体卷/TCP 隔离转发，受控 Provider 1 POST、任务 completed、生成仅入候选、工程 SHA 不变；没有 Keychain 或付费调用。
- [ui-observations.json](evidence/ui-observations.json)：Chrome `156.0.8078.48`、独立 profile、单 CDP driver。真实 SDK register200 后 toolbar 同名导入在 native asset/item 产生前进入 Owner；Owner importMaterial200→live copy→pool native action→flush→Owner save200；iframe URL 不变。采用仅改第一实例，保留 x17、第二实例、轨道和声音；1280/800 parent/child 均 visible，有真实 hit-test 与双 RAF。

[folder-import-observations.json](evidence/folder-import-observations.json) 记录目录 before-picker、真实图片 drop、键盘启动同一上传入口和刷新恢复；最后补跑 [audio-import-observations.json](evidence/audio-import-observations.json)，使用唯一文件名、原始 MP3 字节与本次 importMaterial200，避免把已有选项误当作本次注册成功。刷新时对 native transient selectedId/selectedIds 单独处理，其余 asset/timeline 深比较及 projectSHA/contentSHA均相同。

## HTTP 行为证据

12 个 T09 真实场景包含：本地 video 单实例、still/pan-zoom 补占位、live pool 保存恢复、编辑阶段受控 Provider、actual source 主声、unknown submit、已知 ID 恢复、短视频策略、gain/BGM 保留、缺失未用候选、新增镜头边界。

[source-main-voice-provider.json](evidence/source-main-voice-provider.json) 保留真实 POST 与任务输入：actual source 用例先留下 muted 旧 TTS（2.4 秒），再采用原片实际 source window（srcIn 0.5 秒、使用 5 秒）。请求输入故意填 12，task snapshot 冻结 source 身份和 5 秒窗口，真实 POST duration=5；prepare 后改 main=none，旧采用409且工程不变。UI 主声时长派生只读，显示 Provider 有效时长；none 才允许明确填写画面时长。

请求 A 后编辑无关 B，首次结果仍完成；已取得 Provider ID 后编辑 B 再恢复，只轮询原任务且 POST 总数1。主声仅 gain -6→-3、添加/调整 BGM -12/duck8 后，视觉候选仍可准备采用并保留新混音。真正 A 输入变化则 Worker 在 reserve 前阻断，paid reservation=0、POST=0。unknown POST 后 retry 与换 prompt 均409，付费族仍只有一任务。

短 video 保留目标窗口409；使用候选长度未确认409，明确接受后只改目标长度，不 repeat、speed 或 ripple。新增 `added-*` 本地图片候选和采用200，AI409；既有 Episode stage 和真实审批不被伪造，T13 接 `resolveWorkspaceVisualLineage`。

## 原生文件和渲染

经 root 预约后串行完成 3 份实际 MP4，已释放 `/export`。`before/still/pan-zoom` 均 ffprobe 为 H264/AAC、**180×320**、120 视频帧、4.053333 秒；记录的是实际输出而非请求尺寸。

原视频 SHA `a8170765d9db83985ffb3efc7aef118e3afa18503034944cf9f657b8f208f1da`，图片 SHA `89d3d2db0710dad01a95754cd362e2e561476f925aeda6332874987826a35116`。静帧两时刻平均差 0.004386574；本地推拉差 10.13140625；未替换第二片段帧差0。三份 native project 保存于 evidence；每次保存/打开验证以当时最终当前工程执行，不将其夸大为三份工程分别在浏览器逐一打开。

亲自查看 [render-contact.png](evidence/render-contact.png)：上排静帧位置相同，下排推拉确有位置/尺度变化。另看 800 screenshot：沿现有断点上下排列，可滚动，无需改旧布局。详见 [render-observations.json](evidence/render-observations.json)。

## RED→GREEN 与调整

按已确认 Owner UI→HTTP/PG/Worker→真实 Studio/文件/渲染 seam 逐片实施：未知视觉命令400→局部替换；图片方式400→native image；live pool400→可逆 URL 与保存恢复。短长度影响缺失→DTO明确空隙/覆盖；未用文件删除后仍 available→stale，采用409但工作区可读。

两个 403 后先检查权限：Owner 直接读 approvals 不符合现有边界；移除该读取，approval 保留在原 SECURITY DEFINER Provider RPC，未扩展 Owner 权限。JSONB 属性顺序造成候选误 stale，改用已有 canonical 语义比较。全工程 edit epoch 误挡无关 B 的真实 RED，移除提交守卫中的全局 epoch，保留目标和实际主声输入守卫。

真实 UI 发现本票 CSS 字面换行使上传 input 越界，修复后 save hit-test 绿。重复同名 picker 超时后没有盲试：实际 SDK 在 upload guard 前先弹 master 覆盖确认；把 LC embed adapter 的 guard 提前到 importAssetToPool 的同名判断之前。已安装 SDK 文件和独立 Studio 未改。folder picker 实际 RED→前置按钮 fallback GREEN；toolbar/drop 共用登记入口，不是 CSS 隐藏。

键盘 driver 两次超时后记录并调整焦点：先关闭工具/原生菜单，真实点击 iframe 素材栏空白，再聚焦原生上传按钮并发 Enter；记录 activeElement、visibility、focus 后实际 chooser/guard 通过。不假称 SDK 有未注册的导入快捷键。

## 边界与清理

Provider 只用受控传输，未验证真实付费供应商生成质量。没有修改日常 DB、Keychain、服务或已安装 Studio，没有 push、关闭 Issue、删除工作树或修改 PLAN。所有测试私有 DB/媒体/volume 由夹具释放；本票 UI 监听60073、独立 Chrome 调试端口均已关闭，Chrome退出且自建 profile 已删除；见 [cleanup.json](evidence/cleanup.json)。工作树、dist、原生工程/MP4、脚本和证据保留供独立复验。新单默认入口、新增镜头生成 lineage 和完整全链验收交 T13，不能以本票局部合成夹具宣称已完成。

重放方式与命令见 [README.md](README.md)，接口和归属约束见 [CONTRACT.md](CONTRACT.md)。媒体 Worker/引用/受控执行器的 3 文件补充回归通过（`/private/tmp/t09-media-unit.log`）。最终 merge 最新 integration 返回 Already up to date（`2fa83c1a`）。

原始运行日志在 `/private/tmp/t09-{focused,runtime-regressions,embedded-regression,build,runtime-prepare,cli,source-evidence,ui-acceptance,import-entries,audio-import}.log`。
