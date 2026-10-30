> 2026-10-30 收尾记录：本页是历史隔离验收的启动说明。55357 临时服务已关闭，测试库和媒体保留；`.scratch` 私有源材料及配置已压缩归档至 `.loop-control/archives/local-main-batches-20261030/workspace-before.tar.gz`。当前回归入口为 `src/local-app` 下的集成测试；恢复历史服务前须先从私有归档恢复对应 `.scratch` 文件，不向日常库导入测试数据。

# 隔离全链 E2E 环境

本环境使用普通产品入口、真实 HTTP、独立 PostgreSQL 数据库、真实 OpenChatCut 与实际渲染/交付文件。不会写入日常业务数据库，不停止日常服务。

准备数据只有测试 Owner、账号蓝图、受控连接和受控媒体；既有 fixture 附带历史样本及一张由真实 create 命令创建的空生产单。主验收应在普通页面另建新的生产单，再输入脚本，不能将预建工作空间当作从头验证。

- 地址：`http://localhost:55357/`，使用 localhost 与日常 127.0.0.1 登录 Cookie 隔离。
- 测试凭据：`.scratch/compact-migration-20261030/private-metadata.json`，仅本机 0600 文件；不得放入截图、报告或控制台。
- 输入：同目录 `inputs/script.md`、`video.mp4`、`voice.mp3`、`cover.png`。
- 后台轮询仅处理隔离库 `ready` 的口播、A/B-roll 和交付任务；任务由真正 loop_worker claim，口播/视频使用受控协议样本，交付使用真实 Worker 子进程。
- 操作日志：`worker-operations.jsonl`。受控 Provider 不代表在线供应商余额、可用性或质量通过，在线 Provider 连接测试由主 Agent 单独记录。
- 启动：`LOOP_TEST_CONTEXT_MODULE="$PWD/scripts/runtime/environment.mjs" node_modules/.bin/vite-node --config .scratch/compact-migration-20261030/runner.config.ts .scratch/compact-migration-20261030/serve-e2e.ts`。
- 清理：向启动进程发送 SIGINT。脚本停止 Vite/Worker，关闭 Studio，删除隔离数据库和挂载的临时媒体卷，写入 `cleanup.json`。不清理用户日常服务或数据。

## 初始化调整记录

- vite-node 默认读取日常 Vite 配置，受到 Keychain 环境限制；改用专用 runner config，不读取日常部署凭据。
- sandbox 阻止本机监听；以已授权的隔离 E2E 操作申请工具提升后启动。
- `Unexpected end of JSON input` 连续两次：根因是 formal fixture 内部通过当前 UI origin 调用 create 时，外层 fixture 尚未返回，API middleware 尚未绑定；第二次仅为获取错误堆栈。改用既有 `onBase` 在 create 前绑定真实 handler，不再重复盲试。

## 环境中断记录

2026-10-30 首套环境创建了 UI 测试单 `9227a6ab-5f22-415b-8102-5336fcbafdfe`，已上传/确认脚本并进入素材准备。连接读取采用 fixture 默认 disabled service，UI 可选能力显示 0 项，属于验收环境配置缺口。准备调整时与主 Agent 浏览器操作发生协调冲突，SIGINT 调用了 fixture 既有清理，首套隔离库和临时媒体已删除；该单后续不能作为完成证据。截图和操作日志均保留，未触碰日常数据。

重建后的环境在原 localhost:55357 地址提供受控连接 handler。真实 `/connections` 读取与产品同一 `mediaAdapterStatus` 计算确认 a_roll、narration 两项已配置，证据 `capabilities.json`。这些资格仅证明受控测试协议，不宣称在线供应商通过。后续保持服务/测试数据库运行，未获主 Agent 明确指示不再停服、重启或清理。

## 最终独立读回

主 Agent 完成 UI 交付后执行：

```sh
node .scratch/compact-migration-20261030/readback.mjs <UI创建的生产单UUID>
```

脚本只登录隔离测试 Owner、读取 Episode/Workspace/六类交付文件，同时独立读取磁盘字节，逐项核对 SHA-256/大小、确认文件身份和 manifest，再用 ffprobe/ffmpeg 独立解码。证据写入 `e2e/readback-<UUID>/`；不发送业务制作命令、不修改业务表或实时工程。

## 交互进程退出后的持久恢复

子 Agent 回合结束后，原交互 exec 挂载的 Node 进程消失，但没有走 fixture.close：原数据库 `loop_studio_153_a3be4e25cdc7`、原媒体卷和主单 `529a7070-f80e-4d97-9ac0-80ee2e057ba5` 均仍存在，且没有 cleanup.json。判断为临时交互进程生命周期结束导致服务失联；未将其报告为正常清理。

恢复脚本 `restore-existing.ts` 不调用任何 fixture 创建/清理函数，只重新连接原数据库、原媒体根和同一 localhost:55357，保留原 Owner 凭据及浏览器会话。`launch-persistent.mjs` 使用 detached + unref + 独立日志，进程 PPID=1、独立进程组，避免依赖子 Agent 的临时 exec 会话。PID 与日志位于私有 scratch 目录，恢复事实见 `persistent-restoration.json`。后续 SIGINT/SIGTERM 只停止服务/Studio/连接，明确保留数据库和媒体；没有自动 DROP/删除媒体逻辑。

### 口播重规划回归准备（11:38）
- 第一次回归执行受 sandbox 临时 APFS 卷权限限制，改用已授权隔离真实集成执行环境。
- 第二次使用附加 HTML 注释的脚本被正式模板校验拒绝（400），说明输入格式围栏正常；改用模板原有字段内容修订，不放宽校验。

### 11:41 Inspector 中断及同库恢复
- 临时 Inspector 热替换第一次遇到 V8 未保留 runtime 词法绑定，加载未生效。
- 清理脚本从 Debugger evaluate 调用 dynamic import(node:inspector)，其 VM 上下文没有 dynamic-import callback，触发 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING 未捕获异常，导致隔离 Node 进程退出。不是数据库、业务代码或 Worker 失败。此清理实现是本轮测试脚本错误。
- 主 Agent 明确授权立即恢复同库并停止 Inspector 方式；执行 launch-persistent.mjs，PID1666 detached/unref，PPID1，仍使用原库和原媒体，新进程直接加载最新源码。未清理、未重建数据库、未执行业务替代操作。
- 同URL HTTP读回，工程revision11，当前主声207516cd…仍采用，native编辑保护开启；当前候选采用状态按实际工程推导。Inspector9229无listener。后续不再热换或操作服务生命周期。
