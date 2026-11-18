# Lucide 统一、旧服务清理与工具链核查

> 产物清理记录（2026-11-18）：本报告所链接的部分历史截图、视频、日志或导出附件已按用户要求清理；原验收事实保留，已删除附件改为文字标记。生产单、数据库、业务素材及必要测试输入未删除。


日期：2026-11-12。基线：`6719e676aeb1a5c6eb6e56d385abc9a4a51b373e`。本轮未提交、未推送，未更新日常服务、启用备份或修改并发配置；三份并行 CSS 保持原字节。

## 交付与保留边界

- 11 个图标消费者改用 Lucide，删除唯一失去消费者的 `@untitledui/icons` 包；没有新增包或升级其他包。锁文件仅根声明和该包条目变化。
- 保留 Dan UI 的 Input、Select、Dropdown、Modal、Tooltip 等组件、React Aria 交互及上游许可。图标包和组件源码不是同一件事；移除图标包不构成删除组件的依据。
- 删除 Cloudflare、Google TTS 的专属运行分支、品牌与提示，移除 Supabase 类型元数据和旧 SDK 专属分支、n8n 自动发现、旧状态卡及旧格式专属自动导入。未知服务仍在接收和网络边界拒绝，当前联网服务白名单为 8 项。
- 历史导入仍保留 PostgreSQL dump、JSON 表快照、媒体、源码与 supplemental 通道；旧备份中已退役的专属运行库以后须显式经 supplemental 纳入，不能假定仍会自动发现。
- 当前 `src / scripts / native` 运行代码（排除测试、夹具、原型）不再包含四项名称。历史文档原样保留；README 记录承接关系并纠正过时的默认 Codex 规划描述。

**冲突与建议：** `db/**` 的历史 SQL、基线和 `providerRetirement.integration.test.ts` 仍有旧名称。建议保留；实际影响是迁移校验和可重放、旧蓝图冻结内容和拒绝新用旧服务的验收得以维持。删除或改写会破坏这些边界。本轮跳过，没有改数据库迁移、旧记录或冻结快照，也不声称全仓字符串为零。

## 工具链实际职责

| 工具或服务 | 当前用途与边界 |
| --- | --- |
| Codex CLI | 默认制作入口不用：普通正文按段落建立镜头，v2 直接读取分镜。`workspacePreparation.ts` 是当前依据。CLI 包装器、旧规划任务与重试 API 仍在；配置存在不等于日常调用，本轮未退役兼容路径。 |
| OpenAI API | 已登记的图像生成、模型与连接核查。 |
| 阿里云百炼 | 万相视频生成。 |
| 火山引擎 | Seedance 视频生成。 |
| 豆包语音 | TTS 与显式样音生成。 |
| MiniMax、可灵 | 视频生成与各自已实现的连接、模型或用量读取。 |
| Pexels、Freesound | 视频检索/下载、音频预览及素材选用；检索不等于自动采用。 |
| OpenChatCut | 本地编辑、保存、渲染/导出；独立 SDK，不是根 npm workspace。 |
| FFmpeg、FFprobe | 实际音视频处理和只读探测，详见下文。 |
| Python、WhisperX、Torch | Owner 确认文本与实际音频的本地声学对齐，不是默认重写脚本。 |
| PostgreSQL、pg | 业务、任务、审批、连接与资源领取事务。 |
| Docker、Colima | 当前 Mac 的隔离 PG 部署，属于部署选择，不是 PG 本身的要求。 |
| SQLite | OpenChatCut 当前可编辑工程的本地持久化，SDK 使用 Node `node:sqlite`。 |
| Keychain、osascript、hdiutil、sandbox-exec | 本机秘密、通知/原生选择器、媒体磁盘与离线执行隔离；另有 POSIX 进程组、Shell 和本机路径约束。 |

此表表示源码中已实现的职责，不表示本轮执行了付费 API、真实视频生产或全部外部服务健康检查。

### 两处 OpenChatCut

- `/Users/dan/Programs/openchatcut`：独立仓库，0.2.14，main，`cbe20dd`，检查时干净。
- `/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut`：当前部署实际指向的独立运行副本，0.2.17，detached `72ddb33`，检查时干净。
- `/Users/dan/Programs/OpenChatCut` 与前一全局小写路径在这台大小写不敏感文件系统上是同一 inode，不是第三份。

可以日后统一成一个明确版本的运行安装，但须迁移部署引用、确认独立项目用途并验证渲染/保存。当前两份版本不同，不能按同名直接删；本轮两处均未修改。

### FFmpeg 与 FFprobe

`src/worker/mediaTools.ts` 和 `controlledMediaExecutor.ts` 的实际路径：

1. 从源视频提取旁白/参考音频，必要时先截选区，再编码 MP3；FFprobe 核对实际时长。
2. 把预览或选中的音频裁到目标区间；不会把试听或候选自动视为已采用。
3. 按起止时间裁视频，或裁多个片段后拼接；FFmpeg 编码并保留所需音轨，FFprobe 检查时长、音视频流及容差。
4. 为首帧/图生视频输入提取参考帧、裁剪和转换颜色格式。
5. 下载素材后检查视频尺寸、时长、是否含音轨，判断能否满足镜头合同。
6. OpenChatCut 导出依赖媒体编码工具；成片校验读取尺寸、时长、音轨，FFmpeg 的 blackdetect 可提供黑场检查证据。

FFmpeg 负责处理，FFprobe 负责探测；它们不在每次四秒队列扫描中重复处理所有媒体。媒体 Worker 还会在就绪检查中核对命令可用性。本轮相关默认测试确实执行了小型 FFmpeg 提取/裁剪，不等同于真实成片吞吐测试。

### WhisperX 与 SQLite 的使用入口

字幕链路：生成/上传/提取实际音频 → 确认正文并保存 → 字幕区“声学对齐” → 检查结果 → “采用对齐” → 在实际剪辑工程中继续确认和导出。无音轨或有未保存修改时禁用；输入版本变化会让旧时序过期。当前本机配置为中文 wav2vec2 对齐模型，runner 使用 `load_align_model`、已缓存模型及离线限制；不是调用默认 Whisper large-v3 转写替换正文。本轮只核查实现与配置，未运行实际音频对齐。

SQLite 已接入 OpenChatCut 的保存/重开路径，不需要额外打开“SQLite 功能”。SDK 的 `server/storage/sqlite-store.ts` 明确以 SQLite 为持久化源，WAL + FULL 同步；旧 JSON 为迁移备份。每期工程通常位于 `openchatcut-work/current/runtime/project-store-v1.sqlite3`，运行时可能有 WAL/SHM。日常服务本轮开始前已经停止，不能把接入事实写成当前有活动编辑进程。

### PostgreSQL 与双平台建议（只读方案）

ADR-0008 保留 PG 是为了复用 PL/pgSQL、事务、行锁和任务领取；换成 SQLite 会重写这些行为。ADR-0009 的独立 Colima/容器/卷用于隔离和可复现。可改原生 PG，但须适配部署生命周期、身份检查、工具和恢复流程，本轮未改。

| 当前 Mac 相关项 | Windows 方向 |
| --- | --- |
| Keychain/native helper | Credential Manager 或 DPAPI；每台设备单独绑定秘密引用。 |
| osascript 通知、选择目录；open | Windows 通知、原生目录选择和 Explorer。部分现有打开目录代码已有 win32 分支，仍需完整验收。 |
| hdiutil/APFS 媒体盘及 inode/挂载校验 | NTFS 目录或合适卷，适配路径与文件/卷身份。 |
| Colima | 原生 PostgreSQL 服务，或 Docker Desktop/WSL2。 |
| sandbox-exec、POSIX 进程组/信号、lsof/ps、Shell/绝对工具路径 | Windows 进程监管/Job Objects、网络隔离及跨平台路径解析。 |
| Python/Torch、原生 SDK 依赖 | 分平台安装 CPU/CUDA 适配与模型缓存，验证 OpenChatCut 的 Windows 兼容性。 |

Node、React、FFmpeg、PG、SQLite 的职责可以保留。双平台同时用同一项目，建议一套权威后端/PG和受控素材存储，两端连接；OpenChatCut 可编辑工程保持单写者，保存后同步版本。不要把两套独立 PG 或打开中的 SQLite 当作普通网盘文件双向同步。当前 localhost/Origin/Owner 接入需要后续单独设计，未开放远程访问。

参考：[Windows PostgreSQL](https://www.postgresql.org/download/windows/)、[Microsoft 秘密存储](https://learn.microsoft.com/en-us/windows/win32/SecBP/handling-passwords)、[SQLite 使用边界](https://www3.sqlite.org/whentouse.html)、[Node 子进程](https://nodejs.org/api/child_process.html)。

## 直接依赖（当前锁定版本）

删除图标包后共 23 项：运行 7 项、开发 16 项，其余仍有真实消费者。以下不把独立 OpenChatCut 的整个传递依赖树或 Python 环境混称为根项目直接依赖；前轮完整消费者证据保留在 `../maintenance-five-steps-20261111/step3-dependencies.md`。

| 依赖 | 锁定版本 | 类型与消费者 |
| --- | --- | --- |
| `@videojs/react` | 10.2.0 | 运行：音视频预览及播放交互 |
| `lucide-react` | 1.31.0 | 运行：统一界面图标 |
| `pg` | 8.23.1 | 运行：PG 客户端与事务 |
| `react` | 19.2.8 | 运行：组件与状态 |
| `react-aria-components` | 1.21.1 | 运行：可访问控件、焦点和菜单交互 |
| `react-dom` | 19.2.8 | 运行：DOM 渲染与 portal |
| `tailwind-merge` | 3.7.0 | 运行：共享控件样式冲突合并 |
| `@tailwindcss/cli` | 4.3.3 | 开发：ui:build CLI |
| `@testing-library/react` | 16.3.2 | 开发：组件渲染与查询测试 |
| `@testing-library/user-event` | 14.6.4 | 开发：键盘/指针交互测试 |
| `@types/node` | 24.13.3 | 开发：Node 类型图 |
| `@types/pg` | 8.23.1 | 开发：PG 类型图 |
| `@types/react` | 19.2.18 | 开发：React/JSX 类型图 |
| `@types/react-dom` | 19.2.4 | 开发：DOM renderer 类型图 |
| `@vitejs/plugin-react` | 5.2.0 | 开发：React 构建插件 |
| `jsdom` | 26.1.0 | 开发：组件测试 DOM |
| `postcss` | 8.5.32 | 开发：UI CSS AST 处理 |
| `tailwindcss` | 4.3.3 | 开发：UI 样式编译 |
| `tailwindcss-animate` | 1.0.7 | 开发：控件动画规则 |
| `tailwindcss-react-aria-components` | 2.2.0 | 开发：控件状态变体规则 |
| `typescript` | 5.9.3 | 开发：类型与后端/Worker 编译 |
| `vite` | 7.3.6 | 开发：前端构建与开发服务 |
| `vitest` | 3.2.7 | 开发：测试运行 |

## 调度、产量与统计（未调整）

- 本机 Apple M4、10 核、16 GiB。部署 Worker concurrency=1，数据库 scheduler capacity=2，领取侧缺省容量=2；实际受最小限制，当前应用最多同时执行 1 个任务。
- SQL 参数范围 1–64 是配置校验上限，不是这台机器可稳定运行 64 个任务的证明。provider、adapter、connection 和宿主资源限制共同生效；FFmpeg/OpenChatCut/WhisperX 共享 host:cpu=1，渲染还受 host:render=1 限制。
- Worker 定期扫描 4 秒；启动、业务唤醒和任务结束可更早触发扫描。新建空生产单不会自动越过脚本确认、采用和审核。任务 ready、资源和授权就绪后才领取；四秒不是完成耗时或忙碌时的等待保证。
- 建议将来先测全局 2，保持本机重活 1，给系统/浏览器留约 4–6 GiB 与 30–40% 资源余量；观察内存压力、swap、温度和错误后再测 3→4。本轮未修改任何限制、运行负载测试或调用付费模型。
- 50 条成片/8 小时意味着平均 9.6 分钟完成一条，但一条视频会产生多个任务。需按累计 Worker 占用分钟估算：`C ≈ ceil((35*t低+10*t中+5*t高)/(可用分钟*目标利用率))`。2 个槽位、480 分钟、70% 利用率仅提供约 672 槽位分钟，即平均每条 13.44 分钟的预算；不是吞吐承诺。质量等级、镜头数、供应商额度和人工确认耗时尚未量化。
- 后续月度汇总可优先复用任务/运行/预留/产物证据，统一开始结束、队列等待、外部等待、渲染、重试失败、费用、质量等级与镜头数。现在保留一致的过程数据会让以后统计容易，但不必先做 Dashboard 或重复记录全部 UI 点击。本轮不新增埋点。

## 验收与盲区

- `npm test`：288 文件、2104 项通过；最终生产代码状态已包含在此运行中。随后仅调整隔离集成夹具与文档。
- 图标相关 8 文件、47 项；服务清理相关 14 文件、230 项通过。`npm run check`、前端 build、runtime:prepare 通过；offline guard 4 个自检通过。
- 真实一次性 PG、完整迁移与 loopback Owner HTTP：连接目录创建→验证→改名→失败验证→轮换→Owner/CSRF 隔离→断网读取通过。测试外部端点由 loopback 合成服务响应，未读取日常密钥、未请求真实供应商。
- 两次最初集成失败分别来自旧单模型断言、手动验证夹具继承不存在的执行授权；保留失败日志，修复测试假设后第三次相同步骤通过。生产授权逻辑未放宽。选定用例通过不代表同 runner 中跳过的 24 个故事用例通过。
- 实际 Chrome 打开真实 App 与共享控件，合成空账号数据：新建账号弹窗、密码显示/隐藏、未保存离开确认、关闭与焦点恢复、下拉菜单 Escape、原生选择键盘切换、折叠、禁用项、头像添加与标签移除；1440px 浅色与 390px 深色检查通过，无横向溢出或页面运行错误。没有以合成页面替代真实生产单的付费生成验收。
- 独立只读代码审查未发现阻断问题。长期通用依赖防回流边界和真实旧备份恢复未新增验证；本轮未运行冻结蓝图集成验收或完整实际剪辑导出，不改其历史测试/SQL。

截图： 桌面账号弹窗（历史附件已清理：`account-dialog-desktop.png`）、390px 深色账号弹窗（历史附件已清理：`account-dialog-dark-390.png`）、共享控件（历史附件已清理：`final-controls.png`）。结果与保护摘要见 verification.json（历史附件已清理：`verification.json`）。原文件恢复包与完整日志：`/tmp/loop-lucide-unification-20261112/`。
