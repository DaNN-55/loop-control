# 已确认目录清理清单

2026-11-02。按用户确认执行 A1–A5、B1 仅依赖、B2 冗余附件及 B3 恢复包；B4 保留，B5 逐份核对。

按清理前目录块占用及数据库大小统计，处理对象合计约 5.80 GiB。此数字是各项清理记录之和，不是系统净可用空间的前后测量；保留恢复材料及重新生成的缓存占少量空间。

| 项目 | 实际结果 | 清理量 |
| --- | --- | ---: |
| A1 | 删除 3 个确切旧测试目录；必要源码、补丁与说明压缩保留，恢复包 3,118,687 字节 | 2083.56 MiB |
| A2 | 3 个旧镜像均正常卸载，未强制卸载，再删除各自目录；并行 E2E 新镜像保留 | 164.01 MiB |
| A3 | 删除 3 个已确认无连接的合成测试库，未强制终止连接；日常集群只剩 loop_control | 39.99 MiB |
| A4 | 清理项目 Vite、日常服务 Vite、当前 OpenChatCut Vite／Webpack 缓存，随后恢复服务 | 928.57 MiB |
| A5 | 删除 217 个旧空 SDK 临时目录、2 个空工作树父目录、空 .scratch，以及 3 个 .DS_Store 和 2 个旧进程标记 | 0.02 MiB |
| B1 | 仅删除 OpenChatCut-v0.2.14-backup-20261030/node_modules；源码、锁文件和升级资料保留，剩余约 88.65 MiB | 2102.78 MiB |
| B2 | 3 份大型测量 JSON 无损压缩；4 份重复二进制附件合并为硬链接，所有原访问路径、字节及 SHA 保留 | 67.01 MiB |
| B3 | 删除 history-cleanup-20261101 专用恢复目录；原报告已明确标注恢复包和恢复命令失效 | 557.81 MiB |

## 精确旧资源

A1：

- `/private/tmp/loop-152-orchestration`
- `/private/tmp/loop-control-178-20261031`
- `/private/tmp/loop-control-main-e2e-20261101`

A2：

- `/private/tmp/loop-t06-volume-Eiezi0`
- `/private/tmp/loop-t06-volume-AAg5mf`
- `/private/tmp/loop-t06-volume-PQgqhE`

A3：

- `loop_revision_test_f090a2348801f881`
- `loop_studio_153_67d9f590d5c3`
- `loop_studio_153_a3be4e25cdc7`

其他路径及每项数量见 [机器清单](cleanup-manifest.json)。私有基线、源码恢复包、逐项删除前文件清单和 stash 比对证据在 `.loop-control/maintenance/project-cleanup-20261102/`，未公开备份载荷或凭据。

## 附件压缩与去重

压缩后的 JSON 解压字节均与原 SHA-256 相同；原有截图、结论与专项 JSON 保留。两份历史色彩分析脚本支持直接读取 gzip，也兼容重新采集生成的普通 JSON；在拦截文件写入的对照执行中，修改前后输出完全一致。

硬链接去重仅用于已核实 SHA 相同的历史附件。4 个重复路径仍存在，不使用跨目录符号链接，不改写历史交付清单。Git 按内容存储，不记录硬链接关系；未来重新检出这些附件可能重新生成独立副本。

- `docs/verification/visual-fixes-20261028/raw-measurements.json` → `docs/verification/visual-fixes-20261028/raw-measurements.json.gz`，原 25,932,511 字节，压缩后 995,136 字节，381 条测量记录。
- `docs/verification/visual-fixes-20261028/measurements.json` → `docs/verification/visual-fixes-20261028/measurements.json.gz`，原 22,633,054 字节，压缩后 896,150 字节，349 条测量记录。
- `docs/verification/visual-audit-20261028/measurements.json` → `docs/verification/visual-audit-20261028/measurements.json.gz`，原 13,149,480 字节，压缩后 532,625 字节，277 条测量记录。

## Stash 核对

| Stash | 已确认的合入状态 | 处理 |
| --- | --- | --- |
| `stash@{0}` / `3fd211c8` | 8 份原未跟踪附件与当前文件逐字节相同；新增的两段 PLAN 记录不在当前文件或 main 提交历史中，不能判定整份已合入 | 保留 |
| `stash@{1}` / `5755b17e` | 核心字幕／镜头能力已由 main 中的 `dee2678d` 接入并继续演进；64 条新增非空行中，50 条仍在当前文件，9 条可追溯该提交，另 5 条未找到逐字合入证据。功能已演进不等于整份 stash 原样合入 | 保留 |
| `stash@{2}` / `20f71140` | 23 个已跟踪文件版本中，6 个可在 main 历史精确找到；其余包含后来改写或退役的 App／云控制面。原未跟踪文件中 33 个与当前相同，22 个不同或已不存在，不能判定完整合入 | 保留 |

本轮没有应用、删除或重写任何 stash，没有删除分支、改写 Git 历史、暂存、提交或推送。本地与远端分支均只有 main，当前工作树保留。

## 后验与保留

- 188 个当前生产文件 SHA-256 和字节数完全一致。
- 账号、系列、生产单、外部连接、连接版本、production_workspaces 共 6 张业务表指纹一致。
- B4 的全部既有目录与文件逐项核验，无缺失或内容变化；核验基线包含 46 个目录，后续新目录也未纳入清理。
- 当前运行目录、数据库、Keychain、模型、Python、正式 SDK、生产归档和其他恢复备份保留。
- `runtime:prepare` 与源码／产物完整性检查通过；服务已恢复，HTTP 200。
- 历史分析脚本前后结果一致，gzip 摘要及硬链接内容验证通过，必要源码恢复包完整读取通过。
- 本轮未改产品实现，未重新运行完整产品测试。并行 E2E 修改的 3 个测试设施文件已保留，没有覆盖；具体路径见机器清单的 verification.sourceChangedByConcurrentWork。

执行中曾在并行测试重新启动时误暂停日常服务，立即恢复，未在该次暂停删除缓存。随后确认共享测试退出、运行任务为 0 且缓存无打开文件后，完成正式缓存清理并恢复服务。另一个聊天的隔离容器、测试库和新镜像没有纳入本轮范围。
