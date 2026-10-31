# 本轮完成项清理

清理范围依据用户已明确授权的“完成内容产生的分支、工作树、过程产物”。本次只处理已合入本地 main 的 #178 整合工作树、分支，以及已完成回放的旧 schema 兼容编译目录。检查与删除发生于2026-11-01 06:04—06:08（Asia/Shanghai）；全量集成回归与正式真实流程当时仍在运行，相关资源保留。

## 已删除

| 对象 | 清理前核对 | 操作 |
| --- | --- | --- |
| `/Users/dan/.codex/worktrees/issue-178/integration` | HEAD `e7a4d8b7d99daaa04a804460804321bc1bbc6c3e`；已是 main `a30c74e386f41eb6967755b683240be365d15a1c` 的祖先；无 tracked/untracked 改动；只有 ignored `dist/` 和指向主仓库依赖的 `node_modules` 符号链接；无媒体/运行态目录 | `git worktree remove`，未使用 force |
| `codex/issue-178-integration` | 已完整合入 main，恢复提交仍可读取且在 main 历史中 | `git branch -d`，未使用强删 |
| `/private/tmp/loop-control-main-e2e-20261101/daily-compatibility-build` | 回放记录指向 `8f134dc2` 的 schema109 兼容编译；仅临时源码、dist、配置、空编译日志和共享依赖符号链接；逐文件SHA清单已保留，删除前再次逐项校验 | 删除该确切目录，未跟随依赖符号链接 |

清理前 `lsof` 检查两个目录的打开文件和进程 cwd；首次并行 git 检查的短暂 cwd 消失后，再单独复核无占用。未停止任何既有服务或测试进程。主仓库 `node_modules` 保持存在。

删除文件共7855个，逻辑大小308.61MiB、文件分配块327.79MiB；新增恢复清单约1.89MiB。该数值表示被移除目录的文件占用，不能等同于独占磁盘净释放量：同期真实制作与全量回归仍在写文件，本轮 `df` 可用空间由45161604KiB变为44736768KiB，无法将全盘变化归因于清理。

## 恢复与保留

恢复信息位于 `/private/tmp/loop-control-main-e2e-20261101/cleanup-preserved/`：

- `pre-cleanup-inventory.json`：两目录的完整文件列表、SHA、大小、符号链接目标、main与整合提交。
- `cleanup-receipt.json`：实际删除对象、分支/工作树回读、提交可达性与保留项存在检查。
- 原样复制的 `daily-dist-reconciliation.json`、`package.json`、`tsconfig.local-app.json`、`compile.log`。原始 reconciliation JSON 也仍在上一级目录。

整合提交 `e7a4d8b7d99daaa04a804460804321bc1bbc6c3e` 在清理后仍由 main 引用，`git cat-file -t` 返回 commit，ancestor 检查通过。需要重新建立该整合工作树时，可直接从此提交创建，不依赖已删除分支。

以下资源本轮没有删除：

- 主仓库源码、main已有未提交修改、原 preservation stash `3fd211c88ea6c13655ff165c5be313dd223c3889` 与两份更早 stash。
- 当前 `source/`、`live-runtime/`、live启动脚本/会话与 Owner测试目录；两容器和数据库。
- `integration-regression/`、其专用SDK与尚在使用的全量回归证据。
- `provider-samples/` 中实际生成/下载的片段、首帧、不可变网络账本及可复核的运行脚本；完整 Provider 日志。
- `preservation/`、`accidental-emit-backup/`、日常媒体、原生SDK与日常服务。
- 未知历史临时目录、其他账号数据、Finder/浏览器/原生窗口。此清理任务没有创建窗口，故没有额外关闭未知窗口。

清理后 `git worktree list --porcelain` 仅剩主工作树；本地分支列表仅剩 `main`。未 push 或删除远端分支。
