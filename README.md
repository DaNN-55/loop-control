# Loop Control

**面向 Owner 的多账号短视频生产控制台：把配置、生产、审核、QC 与发布确认留在一条可追溯的流程里。**

<img src="assets/banner.png" alt="Loop Control 的视频生产与审核流程封面" width="100%">

## 这是什么

Loop Control 用于管理多个内容账号的短视频生产。每个账号都有独立的蓝图、素材边界、连接引用和发布记录；每一条 Episode 会冻结当时的配置与创作上下文，方便审核、复核和后续追溯。

它服务于需要人工把关的生产流程：自动能力可以辅助生成素材，但 Owner 负责审核、例外和最终发布确认。

## 生产流程

1. 为账号配置蓝图和可选生产能力，例如静态视觉、A-roll、B-roll、旁白与配乐。
2. 创建 Episode，冻结账号蓝图与可选的系列基线；开始生产前执行统一前置检查。
3. 在审核台检查脚本、视觉、分镜与审核渲染；在“剪辑与 QC 台”按时间点记录问题、定向返工或创建新的审核渲染修订。
4. QC 通过后生成并校验固定发布包，由 Owner 在外部平台完成发布，再记录发布事实。

> 项目不会直接操作 TikTok 等第三方平台；当前发布动作始终需要 Owner 人工确认。

## 本地启动

需要 Node.js 与 npm。

```zsh
npm ci
```

在项目根目录创建 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://<项目引用>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

然后启动控制台：

```zsh
npm run dev
```

默认访问地址通常是 `http://localhost:5173/`；以终端输出为准。

## Worker 与本地产物

Worker 领取 Supabase 中的任务，在本机外置媒体库里生成或校验产物，并将结果回写。首次使用时复制环境模板：

```zsh
cp n8n/worker.env.example n8n/worker.env.local
```

填写 Supabase service role、外置媒体库挂载点和可用空间阈值后，可按需运行：

```zsh
npm run worker:run
```

`n8n/worker.env.local` 仅限本机保存，不能提交；不要把 `SUPABASE_SERVICE_ROLE_KEY` 放入 `.env.local`。

## 检查

```zsh
npm run check
npm test
npm run build
```

完整的本机启动、媒体库、n8n 编排与发布包校验说明见 [运行手册](docs/运行手册.md)。

## 边界

- 账号蓝图、Episode 配置快照与 Worker 运行状态是不同层次，避免把密钥或环境事实写入可编辑配置。
- 本地产物必须位于配置的外置媒体库内，并经过索引和 Owner 权限校验后才可在审核台预览。
- 自动化可以准备和校验发布包；发布确认及外部平台操作保留给 Owner。
