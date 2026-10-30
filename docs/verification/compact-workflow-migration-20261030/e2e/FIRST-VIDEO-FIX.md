# 四步首次图片视频修复

## 复现与根因

新增 `workspaceFirstVideo.integration.test.ts`，通过真实新建命令、主脚本导入确认、素材准备和首帧上传，复现 `script_approved`、0 条旧分镜批准下首次视频 503。修复前日志为 `first-video-red.log`，响应为泛化 503；原始数据库阶段异常见 `image-generation-budget-probe.json`。

旧路径使用 `public.request_official_shot_video`，要求旧 `storyboard_approved`；当前准备依据只在四步私有视觉路径受支持。

## 实现

将已有候选生成的真实输入检查、授权指纹、首帧/实际主声快照、目标快照、私有 queue 与提交未知围栏提取为 `queueWorkspaceVisualGeneration`。首次图片视频与局部候选共用该边界：

- 首次模式仅针对尚未填入的真实占位，按实际主声窗口调整占位并建立原有首次回填记录；完成后仍需 Owner 明确填入。
- 候选模式不改当前工程，仍需明确采用策略与确认。
- 保留旧 public 函数不变、不改阶段、不伪造批准；当前授权、版本与任务租约、付费提交围栏保持。
- 私有 queue 的确切「Approve a generation budget first」异常转换为可操作的中文 409。

## 验证

- `npm run check` 通过。
- 新单真实 HTTP/PG/受控 Worker 回归 2/2 通过：无主声与实际 2.4 秒主声两种场景；后者请求 Provider 最短 4 秒，回填保持 2.4 秒。未授权 409、重复填入拒绝、仅一个视频任务，阶段保持 `script_approved` 且旧批准数为 0。
- 既有视觉候选真实集成 12/12 通过，涵盖原生编辑保留、实际主声、未知提交、防重复付费、保存 Provider ID 恢复等。
- 既有图片真实集成 7/7 通过。旧首次生成用例补上正式 `authorizeWorkspacePreparation`，未放开业务门槛。
- 缺失素材用例原断言为 itemId，但 git HEAD 与当前 `readProductionWorkspace` 一直 `missingSources.push(path)`；因此改为实际 `uploaded.body.storage_path`，仍验证图片缺失后打开编辑器被拒绝。没有修改 readiness 业务实现。

日志：`first-video-green.log`、`first-video-affected-integration.log`（首轮旧用例前提缺失）、`first-video-images-integration.log`。

## 当前验收服务热替换

经主 Agent 明确授权，对隔离 Node 进程临时启用 127.0.0.1 Inspector，在空闲轮询闭包通过 Vite `ssrLoadModule` 加载最新 API，重绑 `apiHandler`，复用同一 pool、数据库、runtime、媒体根。新 commands 的 close 已挂入原 fixture.close，避免 Studio 资源遗留。未停服、重启、清理或改业务表。

首次尝试因为 V8 优化掉 origin 词法变量而未重绑，旧 handler 保留；改为经校验的同一 localhost origin 常量后完成。Inspector 已关闭。证据：`api-hot-reload.json`。原 UI 单据由主 Agent 继续操作，不由修复脚本代做。
