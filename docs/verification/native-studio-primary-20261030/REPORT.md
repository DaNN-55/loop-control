# 原生剪辑优先与交付同步验收

2026-10-30，PC端。日常服务已更新：`http://127.0.0.1:5174`。

## 完成内容

- 第三步默认原生剪辑器；外围“生成、版本与对齐”默认收起，展开和关闭不卸载工程，也不再强制收起原生属性栏。
- 字幕正文、字体、字号、颜色、位置、手工时序及常规混音使用原生控件。补充工具保留画面生成/版本、口播生成/版本、声音素材登记和声学对齐；移除重复字幕编辑、逐镜头正文确认及常规混音表单。
- 首次打开按冻结字幕输入组装可编辑原生字幕。已有原生保存记录的工程重开不覆盖字幕；删除/隐藏字幕按实际工程处理。
- 原生保存同步实际cue的有效时序，保持字体/位置等原生属性。自动同步不会伪造人工正文审批；仅音轨或镜头变化而cue未调整时，仍标记过期。
- 第四步先导出实际MP4并检查，观看后一次“确认成片与字幕”，在同一工程版本/内容/文件指纹下记录当前正文核对。后续内容修改使旧导出失效；最后交付仍验证确切文件。
- 对齐结果可在当前编辑器采用，只更新时间信息，保留已有原生样式和位置；过期任务不覆盖新正文。

## 浏览器完整操作日志

隔离地址`http://localhost:55369`，一次性账号、数据库及合成媒体；真实应用、HTTP、PostgreSQL、OpenChatCut和Worker。没有使用静态demo或假交付回执。

| 步骤 | 操作与结果 |
| --- | --- |
| 1 | 打开通过正常create命令建立的空生产单，导入新Markdown脚本并确认，进入素材准备 |
| 2 | 导入脚本引用图片，建立素材工作区；上传实际MP4，明确采用完整素材时长 |
| 3 | 直接打开原生剪辑器；字幕自动装配，外围补充工具默认关闭，原生属性可见 |
| 4 | 点击预览字幕，在原生控件修改正文为“原生字幕修改已保存。”，字号由0.027改为0.029，水平位置改为0.01 |
| 5 | 展开补充工具，原生属性栏仍可用；字幕对齐页只显示片段、状态与对齐操作，没有重复正文/字号/位置或逐镜头确认 |
| 6 | 收起补充工具，保存工作版本；状态“工作版本已保存”，字幕时序同步，步骤状态变为“可剪辑” |
| 7 | 返回并重新打开同一工程，原生字幕修改仍存在；再返回第四步 |
| 8 | 直接导出最终视频，无需右栏再次保存或逐镜头核对；5/5技术检查通过，实际MP4为218190字节 |
| 9 | 点击一次“确认成片与字幕”，成片确认成功、交付表单可用 |
| 10 | 填写标题、简介、标签和封面，生成交付包；真实Worker完成校验，界面显示“生产完成 · 交付包已验证”，提供成片、工程、封面、元数据、检查证据和清单 |

见`browser-verification.json`及`worker-operations.jsonl`。声音为合成测试输入；没有发出付费生成请求，不据此宣称真实Provider生成质量通过。

## 测试结果

- 普通全量回归：168文件、1152项全部通过（`logs/verified-full-tests.log`）。
- 受影响集成：5文件、10项全部通过（`logs/verified-integration.log`），包含真实原生工程持久化、字幕渲染像素、对齐队列与过期结果、实际MP4导出、文件指纹确认、真实Worker交付、篡改/丢失输入、失败恢复与重启。
- 新增原生流程集成从首次打开自动组装字幕开始；验证正文/样式/位置持久化、只改样式保留时序但使旧成片失效、越界字幕阻止导出、修复时序后恢复、删除字幕后不重新冒出。
- `npm run build`通过（含TypeScript），保留既有bundle体积告警；本地运行包已重建并通过源码/产物完整性校验。源文件`git diff --check`通过。
- 测试过程中修正旧用例前置条件：进入原生编辑器前匹配有效素材，原生渲染使用SDK实际登记的素材路径。完整性/回滚断言保留；旧“已匹配画面再次填占位”操作改用实际可执行的原生外观编辑来触发数据库失败并验证回滚。
- 初次普通回归在沙箱内因本地端口EPERM失败，改在允许本地监听的环境重跑全部通过。运行包构建与真实Worker集成已改为顺序执行，避免构建清理dist时干扰测试。最终结果均来自最终源码。

## 日常更新与数据保留

Owner明确回复“已保存并返回，可以更新”后，使用正式停止/启动入口更新5174。新进程启动成功，独立浏览器能加载日常登录页；已登录真实订单的写操作未用于验收。

更新前后episodes、tasks、review_packages、approvals、production_material_revisions、artifacts、audio_tracks七类完整行指纹一致。工作空间整行并非逐字节一致：两行更新时间刷新，且产生选择态快照；当前内容指纹仍匹配基线之前的已有版本。未对真实订单提交字幕修改、生成、导出、交付或删除。详见`daily-before.json`、`daily-after.json`、`daily-version-readback.json`、`daily-preservation.json`，不将更新时间/选择态快照变化误报为整行不变。

临时验收服务、数据库和合成媒体已清理（`cleanup.json`只描述隔离清理，不包含另行执行的日常重启；日常更新见`deployment-update.json`）；截图与日志保留。未提交、推送或发布仓库代码。

## 截图

### 新脚本导入

![新脚本导入](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/02-script-imported.jpg)

### 直接在原生控件编辑字幕

![直接在原生控件编辑字幕](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/03-native-caption-edited.jpg)

### 对齐补充工具

![对齐补充工具](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/04-supplemental-alignment-only.jpg)

### 保存与字幕状态同步

![保存与字幕状态同步](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/05-native-saved.jpg)

### 重开保留修改

![重开保留修改](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/06-reopened-native.jpg)

### 导出5项检查通过

![导出5项检查通过](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/07-export-checks.jpg)

### 真实交付完成

![真实交付完成](/Users/dan/Programs/loop-control/docs/verification/native-studio-primary-20261030/screenshots/08-delivery-verified.jpg)
