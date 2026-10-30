# 脚本操作右置与素材页删除镜头

2026-10-30，PC端。

## 变更

- 脚本页的修改、确认、取消统一放入右栏文件槽下方；修订原因、字段错误也随操作集中到右栏。正文区只保留编辑/预览和字数，顶部不再放修改按钮。
- 素材页镜头列表标题栏增加“删除镜头”，作用于当前左侧选中的镜头。
- 点击后明确显示镜头编号、正文及删除影响，二次确认后调用既有`editWorkspaceStructure`。捕获打开确认时的工作区/版本，拒绝过期状态；失败保留镜头、弹窗及错误提示。
- 删除整镜头的画面、声音和字幕引用，后续镜头依次前移；原素材文件和历史工程保留。成功后选择相邻镜头；只读不提供删除，最后一个镜头禁用，后端继续保护最后一个有效镜头。

## 验证与操作日志

| 操作 | 结果 |
| --- | --- |
| 实际日常脚本页查看 | 正文和标题区按钮数均为0；上传和确认位于右栏，见截图01 |
| 隔离单：修改已确认脚本 | 修改按钮在右栏；编辑后修订原因、确认修订、取消编辑均在右栏，见截图02 |
| 修订原因留空后确认 | 右侧字段红框并获焦，保留正文；取消编辑仍经过放弃确认 |
| 隔离单：选择第二镜，点击删除，再取消 | 弹窗显示第二镜编号与正文；取消后仍为2镜，未调用删除 |
| 再次点击并确认删除 | 合成第二镜移除，剩余第一镜被选中；刷新仍为1镜，最后一镜删除禁用，见截图03/04 |
| 真实HTTP/数据库持久化检查 | 另一隔离订单中删除已匹配镜头，后镜移至0帧，原媒体与原分镜文件逐字节一致；旧工程仍含原2镜且可读取；服务重开后仍1镜，删除最后一镜返回409 |

未对真实生产单执行删除或脚本确认，未提交生成请求。完整删除验收只在本轮新建的合成订单执行。日常页面通过热更新生效，未重启用户正在使用的日常剪辑服务。

- 定向界面回归：27项通过（脚本8、工作区19）。
- 针对本次入口的真实HTTP/数据库集成：1项通过；同文件其他9项因定向筛选未执行，未计为通过。
- 普通全量回归：168文件、1150项全部通过。
- `npm run build`通过，含TypeScript检查；仍有既有bundle大小告警。
- `git diff --check`通过。
- 55362临时验收服务、一次性数据库和合成媒体已清理，见`cleanup.json`。

原始结果：`logs/targeted.log`、`logs/delete-integration.log`、`logs/full-tests.log`、`logs/build.log`及`browser-verification.json`。本轮未提交、推送或发布代码。

## 截图

![真实脚本页确认按钮右置](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round8-20261030/screenshots/01-脚本确认按钮在右栏.jpg)

![修订原因、确认和取消在右栏](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round8-20261030/screenshots/02-修订原因与操作集中右栏.jpg)

![删除镜头二次确认](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round8-20261030/screenshots/03-删除所选镜头二次确认.jpg)

![删除后刷新仍保留结果](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round8-20261030/screenshots/04-删除后刷新保留一镜头.jpg)
