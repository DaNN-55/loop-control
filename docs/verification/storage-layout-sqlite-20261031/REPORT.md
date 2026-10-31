# 数据保存盘点与剪辑工程 SQLite 验证

日期：2026-10-31。用户要求查明全部数据的类型与位置，并在不改真实工程的前提下，实际验证剪辑保存、关闭重开和恢复。存储盘点及统一方案见[完整清单](../../research/2026-10-31-storage-layout-and-unification.md)。本轮未迁移数据，未提交、推送或合并。

## 结论与生效边界

隔离工程的实际浏览器验证通过：画面位置 17 在保存、关闭重开后保留；SQLite 自动保存的位置 31 在尚未保存宿主版本就退出后，重新进入工作台仍为 31，并同步为新的宿主版本。故意保留的位置 -987 的旧 JSON 未被采用。

验证同时发现并修复了原实现的恢复覆盖风险：只有“读 SQLite 优先”还不够，重开路径仍可能把旧宿主快照写回 SQLite。此前回归覆盖了显式保存和明确更换输入，没有覆盖“原生已自动保存、宿主未同步”的退出情形，不能用此前通过结论代替这次验证。

初始阶段修复只写入源码并在隔离实例验证。随后 Owner 明确确认「已保存并退出，允许更新日常服务」；本轮已停止旧服务、更新运行包并重启，日常服务已应用修复。更新验证和工程保护见下文。

## 隔离与真实工程保护

使用 [productionWorkspace.fixture](../../../src/local-app/productionWorkspace.fixture.ts) 创建新的随机 `loop_studio_153_*` 数据库；只复制正式 schema 和技术迁移记录，不复制日常业务行。测试 Owner、Episode、视频与文件均由夹具生成，媒体根在 `/private/tmp/loop-153-*/account`，与真实媒体映像和当前 Episode 无关。

独立 UI 位于 `http://127.0.0.1:5197`，运行正式 `src/local-app` 前端、真实 Owner HTTP / PostgreSQL 命令和已安装的 OpenChatCut 0.2.17；编辑器独立端口与测试工程身份在 iframe 中检查。没有用 DOM 或 mock 冒充实际保存，没有调用真实付费生成服务。

用户的真实 Episode `bbea3b57-061b-4341-9ba1-3bf65d28899f` 只读采集了 4 个持久文件的 SHA，前后完全一致。日常 Vite PID 76037 和真实编辑器 PID 27979 保持原启动时间；没有发送指向真实工程的写命令。WAL/SHM 的瞬时内容不在上述 4 个文件的字节对比范围内。见 `real-project-before.json`、`real-project-after.json`、`real-project-protection.json`。

## 实际浏览器步骤及结果

| 步骤 | 实际操作 | 核对结果 |
| --- | --- | --- |
| 初始打开 | 登录隔离账号，经正式四步工作台打开真实 SDK，选中第一镜 | 水平位置 0，真实时间线和预览可见，见 `editor-before.png` |
| 原生编辑与宿主保存 | 在原生属性栏将「水平」精确值改为 17，再点「保存工作版本」 | 宿主 revision 5；原生工程与宿主 JSON SHA 均为 `991e2a2a…`，见 `saved-A.json` |
| 关闭与旧 JSON 反例 | 点「返回生产单」，将本测试工程的旧 JSON 备份改成 `STALE_JSON_MUST_NOT_WIN` / 水平 -987，再重新进入剪辑器 | 实际水平仍为 17，工程 SHA 不变，见 `stale-json-marker.json`、`reopened-A.json`、`reopened-A.png` |
| 原生自动保存、暂不保存宿主 | 将原生水平改为 31，不点宿主保存 | SQLite 工程 SHA 为 `ba5816b6…`；宿主仍是 revision 5 / `991e2a2a…`，确认两者确实不同，见 `native-B-before-host-save.json` |
| 模拟宿主连接丢失 | 关闭本测试的命令实例和 SDK 子进程，再重建命令实例；没有执行宿主保存 | 离线原生读取保留 31，见 `offline-recovery-B.json` |
| 重新进入实际工作台 | 刷新独立浏览器页面，重新创建 SDK 进程和编辑会话 | 原生属性栏实际为 31；宿主 revision 升为 6，SQLite 与宿主 SHA 同为 `ba5816b6…`，见 `reopened-recovered-B.json`、`recovered-B.png` |
| 最终保存返回 | 在恢复后的编辑器点击保存与返回 | 31 保留，见 `final-saved-B.json`；历史记录为「恢复原生剪辑」，nativeEditRevision 为 2 |

以上验证的是重建宿主命令实例、退出并重启 SDK 子进程后的磁盘恢复，没有重启真实日常服务。它不覆盖停电导致的文件系统损坏、整个数据库丢失或真实媒体盘拔出。

## 修复方式

在同一工作区来源下，以 `project.json` 作为上次宿主同步基准，同时比较当前宿主版本与 SQLite 中的原生版本：

- 宿主未变、SQLite 有新编辑：验证真实来源与工程格式后保留 SQLite，恢复为新的不可变宿主版本，更新镜头绑定、原生编辑代次和字幕证据，不伪造正文审批。
- 宿主明确采用新版本、原生没有未同步编辑：沿用原来的更新路径。
- 两边都发生变化：阻止自动覆盖，保留两边，等待明确恢复/采用决定。
- 来自明确不同输入基准的新版本：保留既有重新规划/采用行为。
- 已迁移 SQLite 的数据库文件缺失但回执仍在：明确报错要求恢复数据库备份，不回落到旧 JSON 假装恢复成功。

SQLite 数据库存在时仍优先读取，旧格式仅保留必要兼容。来源路径、SHA、大小、符号/硬链接、实际 SDK 可读性验证继续执行。

## 回归与构建

- 新增恢复回归先失败：期望 `LATEST_SQLITE_RECOVERY`，实际被还原为「生产单审核时间线」。见 `recovery-before.log`。
- SDK 回归：3 个文件、11 项通过，覆盖恢复、显式新版本、双向修改冲突、迁移后数据库缺失、来源复验及缓存安全。见 `sdk-regression.log`。
- 隔离 HTTP / PostgreSQL / SDK：3 个文件、4 项通过，包括普通工作区保存重开、旧工程接入以及字幕正文/样式/时序保存与成片确认。见 `http-regression.log`。
- 普通回归：173 个文件、1163 项通过；类型检查通过。见 `unit.log`、`typecheck.log`。
- 后端和 Worker 编译到隔离输出目录通过；没有覆盖日常 `dist` 或准备记录，见 `build-check.json`。

## 复现入口

SDK 回归：

```sh
OPENCHATCUT_ROOT="$PWD/.loop-control/local/OpenChatCut" npx vitest run src/worker/openchatcutStudio.storage.integration.test.ts src/worker/openchatcutStudio.validation.integration.test.ts src/worker/openchatcutStudio.media-cache.integration.test.ts
```

本目录 `browser-harness.ts`、`runner.config.mjs` 和 `control.py` 保留隔离浏览器夹具及控制脚本。需在仓库根创建权限 0700 的 `.loop-control/verification/storage-20261031/` 后，用 `vite-node --config` 运行夹具；它会创建自己的随机库并生成仅本机 0600 的 `private.json`。不得在日常服务或真实 Episode 上执行反例操作。正常关闭应使用控制脚本的 `end` 命令，让夹具完成清理后自行退出。本轮关闭时 Vite 在异步 SIGTERM 清理完成前退出，因此依据已记录的随机库名和 `/private/tmp` 根严格复核后，手动清理了这两项；清理后查询确认数据库不存在。

临时凭据、Cookie 和密码不进入报告或提交。清理结果见 `cleanup.json`。


## Owner 授权后的日常应用

2026-10-31，Owner 明确确认已保存并退出，允许更新日常服务。使用项目既有 `npm stop` → `npm run runtime:prepare` → `npm start`，没有执行数据库迁移、修改部署参数或创建付费任务。

- 原 Vite PID 76037 已停止，新 PID 为 32329。运行包准备通过源码与输出完整性检查，HTTP 200。
- 在当前已登录的内置浏览器，只读打开系统状态：Worker「在线 · 空闲」。系统仍列出 1 条既有最终渲染阻塞和日常维护提示，本轮未重试或修改这些任务。
- 更新前以 Owner 最新保存状态重新取样：真实工作区 revision 7、原生 SQLite 工程文档指纹、4 个 JSON 文件及数据库版本记录。更新后及页面重新连接后逐项对比完全一致，没有用旧验收基线覆盖 Owner 新保存版本。证据见 `runtime-update-before.json`、`runtime-update-after.json`。
- 更新前保留私有回滚备份 `.loop-control/archives/runtime-update-20261031/compiled-before.tar.gz`，并保存与旧清单 SHA 一致的两份对应源码。回滚需要恢复匹配的源码和运行包，不能把旧清单冒充新源码的有效清单。
- 上轮隔离 SDK 有一个独立遗留进程 PID 30222；通过 55984 端口和已删除的测试临时目录核实身份后关闭。没有误关其他编辑器。
- 本轮修改仍未提交、推送或合并。部署日志与状态截图位于本目录。
