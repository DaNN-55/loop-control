# 配乐、音效来源与独立开关

2026-11-08。用户确认音效开关关闭整期所有音效，包含固定时间线音效；配乐单独控制。

## 当前资源链路

- 音效：本地 MP3（上传或本期素材）→准备候选→试听→显式加入；或音效意图→可编辑英文关键词→选定连接的 Freesound 搜索→最多 3 个候选→试听→显式采用。
- 整期配乐：本地 MP3 或 Freesound 英文检索→音频候选→试听→显式采用。保存配置只保存本生产单的说明、检索词和素材选择。
- 原片声音：当前视频窗口音轨提取→候选→显式采用。不从剪辑软件素材库检索。
- 在线使用的是 Freesound MP3 预览，不是 AI 合成或独立完整配乐库；按所需使用时长过滤，不自动循环。
- 实际设置页已有 Freesound 本地 · freesound v2，但当前生产单默认未设置。没有修改连接、密钥或默认选择。

## 变更

“导入音效”页签改为“音效”；来源弹层明确 Freesound 搜索与本地音频分组。音效/整期配乐各有右上角 Toggle，独立控制整期对应声音。关闭隐藏配置、候选与设置入口，但数据保持挂载；原生项目 loopControl.audioEnabled 保存状态，音频节点保存原音量并置 0；开启恢复精确原音量（含原先缺省音量属性）。不移除媒体、时间窗、音轨或候选，不新增迁移。后台拒绝关闭类别的新准备、重试和采用，防止隐藏配置仍写入。关闭后混音增益不可更改，原声不受影响。原生剪辑打开时，开关沿用保存并退出后再更新的冲突保护。

修改范围：PLAN.md、src/workspaceAudio.ts、src/productionWorkspace.ts、src/worker/openchatcutProject.ts、src/local-app/workspaceAudio.ts、WorkspaceAudioPanel.tsx、workspace-audio.css、WorkspaceAudioPanel.test.tsx、ProductionWorkspacePanel.test.tsx；新增 workspaceSoundSwitches.integration.test.ts。

## 验证

56 项组件回归（21 音频、35 工作区）通过，包括隐藏/恢复草稿、独立开关、拖入/上传/检索/采用原路径。1 项隔离集成使用真实 Owner HTTP、本地 MP3、原生工程和重启：导入并采用 1 条配乐、1 条跟随镜头音效、1 条固定时间线音效；调整音量；分别关闭类别；检查对应静音和其他类别保留、关闭类别拒绝准备和采用；原生剪辑实际保存、关闭、服务重启后状态保持；重新开启恢复音量和来源引用。未调用外部供应商。

npm run check、Vite 前端构建（emptyOutDir:false）、Worker/后端构建与发布物完整性通过。更新前日常活动任务 0、剪辑服务未运行；使用 npm stop / npm start 更新本机服务。发布物 11651d9347870b55a02992b36cf634b8d9d0b706b91f44c7880d294112d1d092。实际系统状态显示已应用当前版本、Worker 在线空闲、暂无活动任务。

正式页面只读核对两个开关及音效名称，1490×953 与 1152×790 布局检查无横向溢出。未切换日常开关、改音量、检索、上传、保存配置、采用或撤销；开关写入由隔离集成覆盖。截图 music.png、effects.png。关闭自建验证标签，恢复 viewport。未提交推送。
