<div align="center">

2026-10-26 D 本地收尾：已完成与 main 整合、953 项回归、日常启动、3 个历史账号 / 11 单接入，以及完整备份和新库恢复。8 条已批准的源端差异仍按严格校验拒绝读取。详见 [D 收尾验收](docs/verification/d-closeout-20261026/README.md)。未推送、合并远端或切换旧生产。

# Loop Control

**面向单一 Owner 的多账号短视频生产控制台，把配置、素材、生产、审核、QC 和最终交付包放在一条可追溯流程里。**

<img src="assets/banner.png" alt="Loop Control 短视频生产控制台封面" width="100%">

</div>

## 项目概览

Loop Control 用于管理多个内容账号和系列的短视频生产。每个 Episode 在创建时冻结账号蓝图与系列规则，本机 Worker 按选定执行路径处理任务，Owner 在控制台提供素材、审核结果并处理阻塞项。最终视频、封面、元数据和校验清单固定为发布包后，Episode 进入“生产完成”。

平台记录的是可验证的生产过程，不代替第三方平台的发布后台，也不把“生产完成”表述为已经对外发布。

## 核心能力

- **版本化生产配置：** 按账号维护蓝图、系列规则、生产能力、Adapter 和外部连接；既有 Episode 保留创建时的配置快照。
- **受控素材与本地产物：** Owner 上传主脚本和人工素材，产物只在蓝图指定的媒体库边界内读取、冻结和预览。
- **可追溯生产与审核：** 从脚本输入、视觉准备、分镜和逐镜头制作推进到审核渲染与 QC，保留任务、审核包和状态迁移证据。
- **本机生产协作：** 本机应用负责持久派发与提醒，本机 Worker 执行媒体任务（旧版 n8n 路径显式保留），OpenChatCut 提供可编辑工程和渲染能力。
- **可校验交付：** QC 通过后生成视频、封面、发布元数据和发布包清单，并在完整性校验通过后结束本期生产。

## 典型流程

1. 创建账号，配置版本化蓝图、系列规则和所需生产能力。
2. 创建 Episode，上传并确认主脚本及本期人工素材。
3. 运行生产前检查；通过后由本机应用派发任务，本机 Worker 执行对应步骤。
4. Owner 依次审核视觉、分镜和镜头输入，并按需在 OpenChatCut 中调整可编辑工程。
5. 生成审核视频，完成 QC，补齐封面和发布元数据。
6. 系统固定并校验发布包，将 Episode 标记为“生产完成”；外部发布由 Owner 在目标平台完成。

## 当前分支：日常原生本地运行

默认 `npm start` / `npm stop` 使用当前 worktree 的 `.loop-control/local/deployment.json`。界面沿用原导航、账号、生产单表格、审核和运营视图；本地 API、PostgreSQL、Keychain 及应用内持久调度承接业务，不要求 Supabase Auth/REST/Vault 或 n8n。

本机已准备日常资源后，在 Node 24 下执行：

```sh
npm start
# 控制台：http://127.0.0.1:5174/
npm stop
```

日常 PostgreSQL 是独立 Colima `loop-control` 中的 `loop_control` 库，媒体、Studio、模型和专用 Keychain 均位于 `.loop-control/local/`。缺少配置或身份/恢复回执不匹配时明确失败，不回落旧验收指针或远端。迁移、目录、首次登录及旧数据保留方式见[日常运行说明](docs/local-daily-runtime.md)。

`npm run build` 不需要数据库或旧环境文件；默认构建继续拒绝 Supabase SDK、旧 App 和旧控制面进入依赖图。历史 `--deployment` / `local:start` 与显式 `legacy:*` 入口保留用于复现，旧测试数据和证据不删除。跨主机安装及原生产数据切换不由本次日常入口自动完成。

六适配器的正式探针、共享持久预算和页面→专用Keychain私密录入已完成离线准备；录入策略保持关闭；截至 Google 诊断累计 10/17 次，Pexels与豆包固定样本通过，Freesound401、Google403、Cloudflare材料组合及OpenAI缺Key仍未闭环。见[离线准备与待确认清单](docs/verification/stage-d-close/provider-offline-preparation.md)。

本分支完成的是 A–D 的受控本地路径及断网数据操作，尚不是通用新主机/默认生产部署或 E/F 发布验收。当前测试资源配置的 5000ms 稳定性专项、30 分钟自然租约回收、指定模型真实离线推理及当前已准备主机正式入口已有补验；历史失败仍保留，秒级故障切换、新主机、其他 Provider 和完整多能力业务等范围未关闭。原阶段范围见 [T25 验收记录](docs/verification/stage-d-t25/README.md)，本次本地归档见 [六组归档说明](docs/verification/stage-d-close/local-commit-archive.md)。

以下为旧版兼容栈说明：仅在明确需要旧部署时使用 `npm run legacy:start` / `npm run legacy:stop`，旧 Worker/编排和发布 CLI 使用 `legacy:` 命令；不作为新版启动前提。

## 旧版兼容环境准备

项目固定使用 Node.js 24。安装仓库依赖：

```zsh
npm ci
```

创建 `.env.local`，这里只能放前端公开配置：

```dotenv
VITE_SUPABASE_URL=https://<项目引用>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

复制 Worker 配置：

```zsh
cp n8n/worker.env.example n8n/worker.env.local
```

填写本机服务和渲染配置：

```dotenv
SUPABASE_URL=https://<项目引用>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<仅限本机的 service role key>
OPENCHATCUT_ROOT=/absolute/path/to/OpenChatCut
OPENCHATCUT_NODE=/opt/homebrew/opt/node@24/bin/node
MEDIA_LIBRARY_MOUNT_PATH=/Volumes/<外置媒体盘>
MEDIA_LIBRARY_MIN_FREE_BYTES=21474836480
# 调整后需重新运行 n8n/import-workflows.sh；默认值分别为 15 和 30 分钟。
LOOP_DISPATCH_INTERVAL_MINUTES=15
LOOP_NOTIFICATION_INTERVAL_MINUTES=30
```

OpenChatCut 使用独立源码目录，当前适配版本为 `0.2.14`：

```zsh
brew install node@24
git clone https://github.com/0xsline/OpenChatCut.git ../OpenChatCut
cd ../OpenChatCut
PATH="$(brew --prefix node@24)/bin:$PATH" npm ci
cd -
```

n8n 固定为 `2.34.5`，与 Loop Control、OpenChatCut 共用 Homebrew Node 24。运行依赖安装在仓库忽略的 `n8n/node24/node_modules`，业务数据仍保存在 `n8n/runtime`：

```zsh
PATH="$(brew --prefix node@24)/bin:$PATH" \
  "$(brew --prefix node@24)/bin/npm" ci --prefix n8n/node24 --omit=dev
n8n/import-workflows.sh
```

导入脚本会更新并发布四条工作流：任务派发、审核提醒、状态变更提醒和每日健康检查。

## 旧版兼容启动

旧版兼容栈入口：

```zsh
npm run legacy:start
```

该命令会依次完成：

1. 使用 Homebrew Node 24 启动 Loop Control，并确认 OpenChatCut 使用同一 Node。
2. 检查前端公开 Supabase 配置、Worker 密钥隔离，并用该公开配置完成只读 API 探针。
3. 检查 OpenChatCut 安装及当前本机 n8n 实例中四条工作流的启用状态。
4. 启动 n8n 和 Vite 控制台；只有带有本项目服务记录且身份与健康响应都匹配的实例才会复用。
5. 等待两个服务可访问，打印实际地址并自动打开控制台。

Supabase 探针只验证 API 可达和公开配置；进入控制台后的数据读取由 Owner 会话与 RLS 验证。未经登录的 REST 401 不能用来判断 publishable key 无效。

正常结果：

```text
Loop Control 已启动
运行时：Loop Control、OpenChatCut、n8n 统一使用 Homebrew Node 24。
控制台：http://127.0.0.1:5173/
n8n：http://127.0.0.1:5678/
  任务派发工作流已启用
  审核提醒工作流已启用
  状态变更提醒工作流已启用
  每日健康检查工作流已启用
Supabase：API 可达，前端公开配置有效；数据权限在登录后由会话/RLS 验证
OpenChatCut：可用
媒体库：已挂载（<实际路径>）
```

媒体库未挂载时，控制台和 n8n 仍会启动，最后一行显示 `媒体库：不可用`。此时可以登录控制台查看远端数据和配置；系统状态会把媒体库标为离线，涉及本地产物的 Worker、预览和发布包操作会被阻止，挂载恢复后即可继续。

浏览器打开后，使用 Owner 邮箱通过密码或登录链接进入控制台。OpenChatCut 不会常驻启动；只有在生产单中点击“在 OpenChatCut 中打开”或 Worker 执行渲染时才启动临时本机实例。

停止本项目服务：

```zsh
npm run legacy:stop
```

停止时会先核验本项目服务记录，再补充发现命令路径和工作目录都属于本仓库的 n8n、Vite 遗留进程；即使旧服务记录被后续启动覆盖，也会一并关闭。不会仅凭端口号停止其他项目的进程。

## 旧版本机运行结构

- **浏览器控制台：** 展示账号、Episode、审核、任务和系统状态；远端数据访问使用 Owner 会话并受 Supabase RLS 约束。
- **本机控制面：** 由 Vite 的开发和预览运行时装载，在验证 Owner 身份后连接浏览器与本机文件、Worker、OpenChatCut 和运行证据。它不是独立部署的公开服务。
- **n8n：** 运行任务派发、审核提醒、状态变更提醒和每日健康检查四条本机工作流。
- **Worker：** 根据冻结的任务输入和 Adapter 配置执行媒体处理、渲染、索引与发布包准备。
- **OpenChatCut：** 仅在 Owner 打开编辑工程或 Worker 执行渲染时按需启动。

## 验证

```zsh
npm run check
npm test
npm run build
```

OpenChatCut 的真实渲染集成测试需要本机已安装并配置对应源码目录：

```zsh
npm run test:openchatcut-integration
```

## 技术栈

- React 19、TypeScript 5 和 Vite 7
- 原生 PostgreSQL、Owner 会话与本地权限边界；Supabase Auth/RLS 仅为旧版兼容路径
- Node.js 24 本机 Worker
- 应用内持久调度/提醒/备份；n8n 2.34.5 仅为旧版兼容路径
- OpenChatCut 0.2.14 与 FFmpeg
- Vitest

## 当前边界

- 控制台、本机控制面、OpenChatCut 和旧版兼容 n8n 都只监听本机地址，不是面向公网部署的一体化 SaaS。
- 本地产物必须位于账号蓝图配置的外置媒体库内，并写入产物索引后才能预览。
- 旧版兼容配置的 `SUPABASE_SERVICE_ROLE_KEY` 只保存在 `n8n/worker.env.local`，不能进入前端环境或 Git。
- 当前主流程要求 Owner 提供并确认主脚本；平台不自动生成主脚本。
- “生产完成”只表示发布包已生成并通过校验，不表示内容已经发布到 TikTok 等第三方平台。

首轮有限在线验收的历史结果：Pexels v1 路径资格通过，Freesound 401 后按当时规则停止；该轮未验收完整在线任务。见[有限在线验收记录](docs/verification/stage-d-close/provider-online-acceptance.md)。

后续单家止损续验的阶段结果见[续验记录](docs/verification/stage-d-close/provider-continuation.md)；旧2次停止账本未重置，当前恢复闭网录入。


Google TTS 单次诊断（2026-10-25）：正式音色目录请求403，原因码 `BILLING_DISABLED`；未合成、未改云端计费或Key，Google仍未验收。继承旧账本后累计10/17次、费用预留0.03/2元（非实际账单），诊断已停止封存，当前为原闭网录入服务。全部旧失败与未验收门禁保留；诊断当次未提交，后续六组已本地归档，未推送或进入 E/F，SQL 建议仍暂缓。[诊断报告](docs/verification/stage-d-close/google-tts-diagnostic.md)。


原生账号页面补验的验收时点记录（2026-10-25）：素材目录选择/打开与已保存蓝图的本机前置检查已接入，选择器断开/退出清理通过；107文件815/815，未调大默认超时。原Provider阶段已获Owner签收，技术失败/跳过不改判，本轮新增请求0、累计10次；其余门禁保留，无提交/推送/E/F。[报告](docs/verification/stage-d-close/native-account-ui.md)。

账号目录操作与当前已保存蓝图检查现已按 Owner 认可的 92 文件范围完成一个独立本地提交；上述“无提交”及验收报告中的基线、未提交说明保留为当时记录。原始证据不改写，其他未验收范围不因此关闭。本次只复核源码/证据并同步归档状态，不重跑服务或 Provider，不修改 Issue、不推送、不合并。
