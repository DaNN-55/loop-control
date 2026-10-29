# 日常本地运行

适用目录：`/Users/dan/Programs/loop-control`。当前入口只使用原生本地应用；旧 Supabase/n8n、阶段隔离配置和相应启停命令已经退役。本说明不提供通用新主机安装或自动数据切换。

## 启动与停止

在项目目录使用 Node.js 24：

```zsh
npm start
npm stop
```

启动核对 `.loop-control/local/deployment.json`、专用 Keychain、当前容器、恢复回执与媒体根，编译当前 Worker/后台，并启动本机服务。缺配置或身份不匹配时明确失败，不读取旧环境文件或回落其他数据库。

当前配置：控制台 `127.0.0.1:5174`，Studio `127.0.0.1:5175`，PostgreSQL `127.0.0.1:54329`。数据库为 `loop_control`，容器为 `loop-control-local-postgres`，数据卷为 `loop-control-local-data`；应用与 Worker 使用独立角色。停止仅处理身份匹配的当前应用并锁定专用 Keychain。

## 当前数据与环境

| 位置 | 用途与清理边界 |
| --- | --- |
| `.loop-control/local/deployment.json` | 当前部署和非秘密引用；不能当旧配置删除 |
| `local/keychain/`、`local/secret-index.json` | 当前秘密及历史名称/UUID/普通值映射；仍参与读取与历史还原 |
| `local/native/` | 固定范围的钥匙串 helper |
| `local/history/content/` | 历史原文内容库；数据库索引、保护映射和秘密引用共同决定可还原内容 |
| `local/media.sparseimage`、`local/volume/` | 当前媒体盘与挂载内容，不能当成两份重复媒体 |
| `local/OpenChatCut/`、`local/python/` | 当前剪辑、渲染及语音对齐环境 |
| `local/state/` | 调度、通知、健康状态、网络策略和调用账本；先区分活动状态与历史诊断 |
| `local/app.json`、`local/app-private.log` | 当前服务身份记录和私有日志 |

表内以 `local/` 开头的路径均相对于项目的 `.loop-control/`。PostgreSQL 数据保存在当前数据卷中，不等于仓库 SQL 文件。不要删除当前卷、媒体盘、Keychain 或历史内容库来释放缓存。

运行目录有固定路径、权限、摘要及恢复绑定。移动必须走对应迁移与验收，不能直接重命名或改符号链接。旧 `.loop-control/openchatcut/standalone/` 中仍可能有独有工程，只有逐工程核对并迁入当前媒体根后才能删除。

## 连接与秘密

```zsh
npm run secrets:list
npm run secrets:copy -- '名称'
```

第一条仅列名称，第二条复制到剪贴板，不在终端打印。名称及数量以当前索引为准；旧名称可能仍承担还原映射，不能因含旧路径就删除。登录使用当前设置的 Owner 密码，旧首次登录材料不能用作恢复方法。

当前手动连接测试与生产生成预算分离。Owner 的显式测试仍核对会话、CSRF、连接归属和版本，只发送固定的最小验证请求；语音测试可能计费。测试成功不自动授权视频/图片生成，也不重置历史请求和费用账本。已退役服务不重新开放测试。

## 构建和迁移

```zsh
npm run check
npm test
npm run build
npm run runtime:prepare
```

前端构建会清理 `dist`，之后必须重新准备运行程序。准备步骤编译 Worker 与本地后台，并按源码/配置和全部产物摘要发布清单；失败或准备期间源码变化时不发布 ready。正常 `npm start` 会执行准备，不从旧编排 CLI 补齐产物。

本地前向迁移：`npm run runtime:migrate`。迁移前核对全部已执行文件 SHA；不得删除、拼接、重命名或重写旧迁移。当前 Owner 已关闭自动备份，迁移尊重部署设置；显式 `--no-backup` 同样不会创建备份。

## 历史与恢复

历史页面从当前 PostgreSQL 和内容库查询来源、旧版本与文件，不访问原备份路径。导入的历史任务不重新领取；历史生产单保留原阶段，只读展示。

已经删除的账号和生产单不得因手动历史投影重新出现。需要恢复或重新投影时，先核对 [第一轮范围](verification/cleanup-20261027/scope.json)、[第二轮清理记录](verification/cleanup-second-20261027/completion.json) 以及对应的来源保留与删除清单。旧原始记录不等于恢复授权。

共享备份格式、摘要、媒体、ACL 和新库恢复算法位于 `scripts/storage/`。恢复库、媒体根和运行上下文必须显式提供；恢复拒绝覆盖已有目标，清除旧密码/会话与连接在线资格，并验证媒体摘要和外键后才发布回执。本次文件清理没有执行业务数据恢复。

## 故障检查

- 启动失败：检查 `deployment.json`、Keychain 解锁条件、容器身份及 `app-private.log`，不要删除 `app.json` 来绕过身份检查。
- Worker 产物过期：执行 `npm run runtime:prepare`，再通过正常启动入口核对；不降低摘要或租约校验。
- 媒体不可读：检查挂载、账号媒体边界及摘要。已登记的历史差异继续严格拒绝读取，不伪造文件。
- 连接失败：按界面脱敏结果检查当前版本和凭据，重新测试前保留生产调用的未知结果与费用预留。

历史验收结果见 [完成索引](completed-work.md)；它们不代表当前 Provider 在线资格或新生产授权。
