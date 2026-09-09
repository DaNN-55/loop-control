# Loop Control

**面向 Owner 的短视频生产控制台，把配置、生产、审核、QC 和发布确认放在一条可追溯流程里。**

<img src="assets/banner.png" alt="Loop Control 的视频生产与审核流程封面" width="100%">

## 项目作用

Loop Control 管理多账号短视频生产。每条生产单会冻结账号蓝图、素材边界和执行路径，由本机 Worker 处理任务，Owner 在控制台审核结果并记录发布事实。

主要能力：

- 按账号维护蓝图、系列、外部连接和本地媒体能力。
- 按生产单推进脚本、视觉、分镜、制作、审核渲染与 QC。
- 通过 OpenChatCut 编辑和渲染视频工程。
- 通过本机 n8n 定时派发任务、提醒审批并执行健康检查。
- 生成并校验发布包；实际发布仍由 Owner 在外部平台完成。

## 首次准备

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

## 启动

日常只有一个入口：

```zsh
npm start
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
n8n：http://127.0.0.1:5678/loop-control-n8n/
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
npm stop
```

## 验证

```zsh
npm run check
npm test
npm run build
```

## 当前边界

- 控制台、n8n 和 OpenChatCut 都只监听本机地址。
- 本地产物必须位于账号蓝图配置的外置媒体库内，并写入产物索引后才能预览。
- `SUPABASE_SERVICE_ROLE_KEY` 只保存在 `n8n/worker.env.local`，不能进入前端环境或 Git。
- 自动化不会直接发布到 TikTok 等第三方平台。
