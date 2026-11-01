# 本轮 UI 本地 main 收尾

日期：2026-11-01。范围：账号通用规则与系列导航、连接表格与画面候选图库、统一参考图、账号预算集中管理，以及相关测试／原型／验收证据。原有main历史与stash保持，不推送、不操作远端。

## 提交

基线：`409bbd14`。源码分为两组本地提交：

```text
3046296e feat: unify media references and centralize account generation budgets
34fbdf50 feat: simplify account rules and series workspace
```

本报告、PLAN及此前本机schema修复记录随第三个文档提交保存。各旧验收报告中的“未提交”是验收当时状态；本轮源码与证据现已整理进本地main。没有额外重构或行为修改，终端日志仅规范化末尾空行。

## 验证

- 提交前 `npm test`：180个文件、1167项测试通过，0失败。
- 应用和local-app两组TypeScript noEmit检查退出码0；`git diff --check`及分组暂存检查通过。
- 上轮已完成预算真实Owner HTTP／DB集成、正式登录页面及桌面／窄窗检查，见[预算与参考图记录](../reference-budget-20261101/REPORT.md)。本轮没有源码行为变更，不重复该集成或调用生成API。
- 当前仅主工作树和本地main，无需再删除工作树或分支。日常服务PID60109仍监听127.0.0.1:5174，未重启、迁移或停止服务。

## 清理

先检查文件归属、历史引用和打开文件，再逐项重算SHA后删除：

| 类别 | 文件数 | 恢复／重建来源 |
| --- | ---: | --- |
| 已归档且字节一致的临时媒体副本 | 136 | `/private/tmp/loop-control-main-e2e-20261101/final-recovery/live-media.tar.gz`，SHA与既有恢复清单一致 |
| 与已提交证据字节一致的临时副本 | 394 | `docs/verification/issue-178-main-e2e-20261101/`中逐项对应文件 |
| 可重建编译输出／tsbuildinfo | 256 | 冻结测试源码及编译命令；主仓库dist未动 |

合计786个文件，逻辑大小74,705,016字节（约71.2MiB）。这是移除文件的逻辑大小，不表示独占磁盘净释放量。完整文件及SHA清单见[cleanup.json](cleanup.json)。只清理上述确切文件并移除其空父目录，不跟随符号链接。

保留两个与归档不一致的媒体状态文件、199个非同字节原始证据；实际Provider样片、唯一二进制验收证据、数据库dump／媒体恢复包、原preservation和stash均保留。日常数据库、媒体、SDK、依赖目录、原用户页面不受影响。已选原型及可复现浏览器夹具仍有验收用途，一并保存。未清理未知历史目录。

[全量测试](tests.log)；应用及后端类型检查日志为空且退出码0，见checks.json。原先本轮的测试窗口及临时服务已关闭；此收尾未再打开窗口。
