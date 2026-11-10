后续 Worker 镜头协议与顶部布局已扩展验证；当前核对和完整迁移清单以 [新报告](../shot-protocol-cleanup-20261110/REPORT.md) 为准。本页保留上一轮范围与记录，此前为隔离状态，现已复测并迁移，见[完成报告](../shot-protocol-migration-20261110/REPORT.md)。

# 最新版旧内容清理与镜头语义整理

已在隔离实现，尚未迁移。费用 0。主源码、暂存区与日常运行版本保持。

[打开隔离核对](http://127.0.0.1:5192/__current_cleanup?view=episodes&episode=18605e3d-ae14-433f-ab3f-7692623baec0)。快照：`/Users/dan/Programs/loop-control/.scratch/current-flow-cleanup-20261110/pending`。

## 实际改动

- 退役 19 个无当前调用的文件：旧六节点页面／容器、旧交付面板及完成弹窗、镜头字段与生成入口、轮询、专属样式和测试。
- 拆出仍使用的生产单抽屉、删除恢复和 Snapshot 类型。保留当前四步、旧工程读取与接管、交付历史、授权媒体读取、后端任务与历史迁移。
- 删除从未渲染的旧产物预览 JSX、无调用的 children／history 注入口、旧导航／审核视图，以及仅有测试调用的人工 A-roll 校验 helper。
- 新模板不含“镜头类型”，新解析结果不默认写 b_roll；显式旧脚本字段仍可读取。
- 当前 script-segment／planner 的镜头输入写 shot_type=NULL，镜头快照删除 shotType，新版 API 不再暴露分类；退役无 UI 调用的 confirmWorkspaceShot 命令。
- 当前视频请求记录 capability=video；媒体就绪检查按 video 执行。上传和 Pexels 视频统一登记 visual_reference；视频逻辑名称使用 shot-*。
- legacyVideoCompatibility.ts 集中读取旧蓝图默认值；不再按镜头分类选 Provider。实际执行仍验证并冻结本次服务选择。
- 卡片视频移除 A/B 文案；新导入用途菜单取消 A/B，旧素材记录与磁盘路径保持。
- CONTEXT.md 明确当前镜头含义；更新已失效菜单、音频候选流程和旧模板 no-op 替换测试。

共 40 修改、6 新增、19 删除，增加 247 行、删除 7387 行。[完整差异](cleanup.patch)与[前后 SHA 清单](migration-manifest.json)。预览 fixture、runner、缓存及生成物不在迁移清单。

## 保留的兼容边界

| 位置 | 保留原因与界限 |
| --- | --- |
| storyboard/v1、Worker contracts/schema、旧任务 generate_a_roll/generate_b_roll 和旧 capability | 已冻结任务、审核证据、恢复和 SQL 仍依赖原协议，不修改必填合同；不写回当前镜头分类 |
| workspacePreparation.ts、worker/scriptPlanning.ts 的 v1 兼容默认 b_roll | 仅满足旧冻结工件协议；当前镜头列为空、快照去分类 |
| legacyVideoCompatibility.ts | 旧蓝图只读默认值，不构成当前镜头类别或执行授权 |
| 旧候选 resolveWorkspaceVisualLineage | 仅读旧列或旧 snapshot；当前带 selectionVersion 的视频请求不走此路 |
| 旧素材用途、数据库基线、迁移及生成类型 | 历史读取、重放与原文件路径仍需保留，未批量改写数据或删除迁移 |
| 供应商视频参数 shotType=single/multi | 表示单／多镜头生成结构，与 A/B 分类无关 |

源码搜索仍会找到 A/B 字符串，不能以字符串归零验收。当前业务记录和旧执行协议已明确分开；完全取消 storyboard/v1 字段需要版本化协议迁移，本次未改写旧合同。

## 验证

- 23 文件 199 项回归通过，类型、前端、后端、Worker 构建通过。保留既有大 chunk 提示，无性能改善宣称。
- 3 条真实 Owner HTTP → PostgreSQL → 队列 → Worker → 受控网络链路通过：新模板、显式 A-roll 旧脚本、普通脚本。检查当前列为空、快照无分类、素材用途正确、候选执行完成且未自动采用。
- 旧 lineage 列为 NULL、旧快照仍有分类时，实际数据库读取回退通过。
- 浏览器完成账号／系列新建生产单、使用示例、正文与字幕预览、确认脚本、自动建立分镜和四步切换；1440／640 无横向溢出。旧审核视频 readyState=4、时长 2 秒；错误列表为空。
- 基线已存在的过期测试：系列创建仍找二次确认、三个面板测试仍找旧菜单。按最新版修正后保留原候选／采用断言并通过；未删除失败测试来迎合结果。
- 早期隔离缺少文档样例和 SDK，补齐只读样例与 SDK 链接后通过。新集成输入曾因缺标题／视频短于占位被正确拒绝，修正测试输入后通过，未修改产品校验。

## 如何核对

1. 打开预览中的“统一镜头清理核对”，查看脚本确认、镜头与字幕预览、分镜台及其余四步。布局沿用已批准版本，镜头无需 A/B 设置。
2. 新建生产单，点击“使用示例”，确认正文不含镜头类型；确认脚本后直接建立镜头。
3. 打开“隔离 Studio153 验收”进入检查与交付，确认旧视频仍可预览、下载。
4. 后端语义查看上述集成日志和迁移差异；当前 API preparation.shots 仅返回镜头 ID、来源，不返回 shotType。

预览允许系列设置、本地创建／导入脚本／确认／建立分镜，在线制作拒绝 409；未接日常数据和秘密。系统状态在受限 fixture 显示不可用，不代表日常服务状态。该预览保留供核对。

## 清理与恢复

- 取消的旧 3.4 从未迁移。核对 PID 11796 的命令和 cwd 后停止 5191；两个目录的 1342 个文件及符号链接逐项比对压缩备份后移除。其他预览和共享依赖保留。
- 恢复包：`/Users/dan/Programs/loop-control/.loop-control/maintenance/current-flow-cleanup-20261110/rejected-legacy-terms.tar.gz`。未解引用 node_modules 链接。
- 主 src 909 文件 SHA 与开始时一致，无源码新增／删除；暂存差异一致。主 PID 78102、5174、固定运行包 2b3b75f8fb71599e7790dc0238a4d6911a3d44ca932c295c6120a3347d0a2335 保持。
- 执行偏差：一次基线 build 和一次后续 check 在主 cwd 执行，更新 dist／构建缓存；未改源码或切换固定运行包。其余构建明确使用 pending，未重启日常服务。
- 源码备份：`/Users/dan/Programs/loop-control/.scratch/current-flow-cleanup-20261110/source-before.tar.gz`，已校验源码字节。后续迁移必须再次核对 mainBeforeSha256，避免覆盖其间新修改。
- 未提交、推送、部署、修改日常数据库／媒体或付费生成。全部产品变更仍隔离，等待核对。
