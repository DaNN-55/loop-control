# 脚本改版合并与隔离区清理

2026-11-17，用户明确批准合入 main 并清理本次分支、隔离代码和产物。执行前 main 与 `codex/script-studio` 同为 `ad0b2e5b`，两边没有待提交业务代码；main 已包含全部验证通过的改动。

## 已完成

- 移除 `/Users/dan/Programs/loop-control-script-studio-worktree` 和本地 `codex/script-studio` 分支，Git 仅保留主工作区/main。分支提交仍在 main，并额外保存可验证的源码 bundle。
- 停止身份核对过的原型静态服务 64996；清理该聊天的独立 HTML 原型目录。
- 清理已停止的专属 PostgreSQL 临时 cluster `/private/tmp/loop-script-studio-8O0wLX`。
- 将四个本次 `.scratch/script-studio-*20261117` 证据目录归档校验后移出项目；清除隔离 worktree 内约 37 MB 构建副本。
- 归档并清理本次废弃日常运行包 `3d40c4c3…`、`ca03f5c2…`，保留当前 `c5d4a7e0…` 与上一版 `db0f90c5…`。主工作区依赖、编译输出、其他任务资料和生产素材保持不变。

## 归档与恢复

本机私有归档：[script-studio-20261117T103025Z](/Users/dan/.codex/archives/loop-control/script-studio-20261117T103025Z)。

- `evidence-and-retired-artifacts.tar.gz`：2,938 个证据/环境/产物文件，约 27 MB 压缩包；源文件与包内流逐项 SHA-256 一致，校验后才删除原目录。
- `merged-source.bundle`：已合入源码的增量恢复包，已执行 `git bundle verify`；保留远端基线身份与所有本次提交。
- `manifest.json`、`SHA256SUMS`：原路径、包内路径、内容摘要及隔离构建清单。
- `before-production.json`、`after-production.json`、`cleanup-result.json`：运行身份、生产记录前后核对和清理清单。
- 最终截图可直接查看：[OpenAI](/Users/dan/.codex/archives/loop-control/script-studio-20261117T103025Z/previews/openai-final.jpg)、[DeepSeek](/Users/dan/.codex/archives/loop-control/script-studio-20261117T103025Z/previews/deepseek-final.jpg)，均从已校验归档提取并再次核对摘要。

原验收文档中的 `.scratch` 和隔离目录路径为执行时记录，现已退休。证据包内 `evidence/`、`isolated-postgres/`、`prototype/` 和 `retired-runtime/` 分别保存原内容；需要恢复时先解压到空目录核对，不覆盖日常环境。

## 清理后核验

### 旧引用复核

后续按用户要求清理失效执行引用：计划及验收入口均指向主工作区/main；本节前面的旧分支名、原目录和提交身份仅作为删除清单与恢复历史保留。私有归档、Git 提交和 reflog 不作改写。

Git 工作树清单只有主目录，分支只有 main，`.git/worktrees` 已不存在，`git worktree prune --dry-run --verbose` 没有残留项。未修改业务代码、运行配置或产物。

聊天应用附件另有一条已失效的 `linked_worktree` 关联。应用列表接口仍返回它；归档接口对同一路径返回“未附着到当前任务”，移除接口仅支持 PR，界面自动化又因安全限制不能访问 Codex。因此这条聊天附件尚未自动解除，不能把 Git/文档清理结果等同于附件已移除。需要应用侧支持解除该关联；不为清除引用重新创建旧工作树。

### 运行与数据

- 日常 App 仍为 PID 70302、5174 端口；未重启日常 App 或数据库。
- 当前及上一版运行包均通过完整性检查，准备版本与实际运行版本一致。
- 137 张生产表前后行数和有序内容摘要完全一致，包括脚本、优化回执、分镜、工作区、任务、素材及费用。没有采用方案、启动制作或新增模型调用。
- 清理只改变文档和本次临时文件，沿用上一轮 2395 项单测、24 项真实集成的有效证据；本轮没有重复运行全量测试。Git 分支/worktree 清单和差异检查完成，本地提交，不推送。
