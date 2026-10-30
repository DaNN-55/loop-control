# 旧单素材页精简与逐镜头编辑接入

2026-10-30，PC优先。目标生产单：`92b3067d-ced9-4e85-bc44-1968fa83695a`（操作电脑-v3）。Owner明确批准接入逐镜头编辑。

## 已完成

- 移除旧素材右栏重复的镜头选择、脚本段落、整期素材浏览、内部视觉清单。保留左侧切换与当前镜头预览。
- 旧HTML工程通过显式入口接入当前四步工作区，支持逐镜上传、版本比较、替换及原生剪辑；保留旧文件。当前目标已实际提交接入，工作区为 `c9ad11c6-4981-4db5-bfe8-d5a77b5fde43`。
- 目标保留7个镜头、8个画面引用（片头上下分屏）、6段口播及1段原声、7份字幕设置。时长1609帧，30fps，约53.633秒；5个镜头启用字幕，其余保持关闭。
- 使用HTML实际时间、冻结原片区间与字幕句级时间，未用过时计划时长覆盖实际剪辑。视频/字幕端点统一按工程帧率量化，避免相邻区间一帧间隙和字幕超出镜头。
- 按旧导出器的资源命名规则核对HTML来源；命令时验证冻结清单的路径、SHA和大小，并与当前来源登记比较。拒绝缺镜头、额外成员、冲突入点、乱序区间、来源不符与无法表示的多段原声。
- 补齐原生字幕与主声路由身份；已采用口播可回看和试听，新工作区不继承旧批准、生成权限或交付确认。

## 实际操作日志

| 操作 | 环境 | 结果 / 证据 |
| --- | --- | --- |
| 原素材页逐个切换7个镜头 | 日常5174，1864/1440桌面 | 当前视频/口播随选择更新；重复右栏已移除。`shot-switching.json`、截图01/02 |
| 冻结HTML只读转换 | 目标旧单，不提交事务 | 7镜头、13成员、1609帧；`frozen-conversion-inspection.json` |
| 接入旧HTML | 隔离55359、真实HTTP/PG/SDK | 生成可编辑副本，原工程保留，在线制作未授权 |
| 当前镜头上传合成MP4 → 加入版本 → 保留目标窗口 → 采用 | 隔离55359 | 表格与预览显示“逐镜替换验收.mp4”，候选显示“已采用”；截图03 |
| 打开原生剪辑 → 保存工作版本 → 返回生产单 | 隔离55359 | 原生双层画面、口播、字幕可见；提示“工作版本已保存”，返回后仍使用上传版本；截图04 |
| 真实接入前两次失败 | 日常5174 | 事务回滚，未提交半成品。Owner事务诊断定位到当前代码读取的`workspace_visual_image_choices`表缺失 |
| 正式有序迁移 | 日常数据库 | `npm run runtime:migrate`应用097，旧迁移SHA不变。未使用`--no-backup`；迁移器报告Owner已关闭自动备份，未擅自更改备份设置 |
| 强制ROLLBACK复验 → 真实入口接入 | 日常5174 | 回滚复验8画面引用/7字幕设置；实际接入成功，“7/7画面就绪”，见截图05 |
| 接入后逐个点击7个镜头 | 日常5174 | 每次当前视频标签与镜头一致，无旧右栏；`live-shot-switching.json` |
| 打开真实剪辑工作台 | 日常5174 | 遇到“会话已失效，请重新登录”。已请Owner重新登录；真实旧单的最后剪辑页核对待补。不能将隔离成功视为此项已完成 |

测试视频只上传到隔离订单，未替换真实旧单素材；未提交在线付费生成。

## 数据保留

`daily-before.json`与`daily-after.json`使用整行规范JSON聚合指纹比较：episodes 6、tasks 210、review_packages 38、approvals 22、production_material_revisions 87、artifacts 240、audio_tracks 65，全部一致。活动任务为0。新工作区、接入恢复记录及097结构迁移属于本次新增状态。

`daily-adoption-preservation.json`实际逐文件验证13个冻结成员，以及旧HTML、审核MP4、最终MP4的SHA/大小；全部通过。7份字幕设置均在所属镜头窗口内。未改写原任务、原脚本、原媒体或旧成片，也未创建新的审核批准。

## 过程中的验证状态（最新通过结果见文末补验）

- 本轮定向41项通过：HTML导入12、原生元数据9、旧四步界面7、口播界面13。见`logs/targeted.log`。
- 真实集成3项通过：HTML接入/替换/保存/重启、原生原工程接续、最近保存原生版本优先。见`logs/integration.log`。HTTP、数据库与SDK为实际实现，未用mock替代这些边界。
- 构建在17:08通过；运行包准备/完整性通过。随后工作区继续有并行界面及图片功能修改，最新检查以以下未通过状态为准，不能引用较早通过冒充当前全通过。
- 最新全量普通回归：1144通过、2失败（168文件）。两项位于`ProductionWorkspacePanel.test.tsx`：找不到旧“S01 素材类型”下拉框、找不到旧“第1段 起点增加一帧”按钮。对应控件已在并行素材面板改版中变化，尚未把用例迁移到新交互，见`logs/full-tests.log`。未删除断言或扩大超时来掩盖失败。
- 最新构建未通过：新增`workspaceImageGeneration.integration.test.ts`的`writeFile`、`workspaceVisualBrowser.integration.test.ts`的`readFile`导入未使用，见`logs/build-latest.log`。本轮仅为运行包补齐了既有类型引用的`.js`后缀，以及两个mock参数类型；没有覆盖并行功能实现。
- Provider：本轮不调用在线Provider，不把受控通路成功解释为在线余额或生成成功。此前全流程与连接通路记录见第六轮报告。

## 视觉取舍

映射分屏、淡入淡出、滤镜、缩放、字幕基础字号/描边/位置；原HTML的暗角、多层字体阴影和字幕入场动画不能保证逐像素还原。旧成片完整保留，新副本输出需在剪辑工作台核对。见ADR-0017。

## 截图

![真实旧单已接入逐镜编辑](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/05-真实旧单已接入逐镜编辑-1440.jpg)

![隔离订单逐镜上传采用](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/03-旧HTML接入后逐镜上传采用.jpg)

![隔离订单真实原生剪辑](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/04-旧HTML接入原生剪辑.jpg)

本轮未提交、推送或发布代码。先前待登录和并行回归问题已在以下补验中完成。

## 登录后补验完成

2026-10-30，Owner确认重新登录后补齐真实旧单验证。此节覆盖上文过程中的待登录、回归失败及类型错误状态。

- 原生编辑器实际显示“编辑器已连接”，7个镜头导航，时间线`00:00.00 / 00:53.63`。
- 点击“保存工作版本”，实际反馈“工作版本已保存”。
- 播放时间线，界面计时实际前进至`00:12.46 / 00:53.63`；暂停后恢复播放按钮。嵌套iframe的DOM按钮点击两次目标失效，改用当前DOM位置的真实鼠标点击完成验证；没有执行页面脚本来模拟播放。
- 返回生产单后，7个素材行仍在，当前画面、已采用口播可回看，无错误提示。再次打开原生工程仍有7镜、53.63秒时间线，随后正常保存返回。
- `post-login-browser.json`保存上述操作结果；截图06–09对应真实旧单，区别于前面的隔离测试。
- 保存后再次逐文件验证13冻结源、旧HTML、审核片、最终片；全部有效，字幕均在所属镜头窗口内。7类原业务表整行指纹继续一致，活动任务0。
- 并行素材改版的旧控件用例及未使用导入已更新。本轮重新执行普通全量回归：**168文件、1147项全部通过**。见`logs/full-tests-post-login.log`。
- 最新`npm run build`通过（含TypeScript检查）；`npm run runtime:prepare`通过。见`logs/build-post-login.log`、`logs/runtime-post-login.log`。运行包已同步并重启5174日常服务，不再保留旧的过期运行指纹。构建仍提示现有大bundle告警，不影响本轮通过状态。
- 未请求在线生成，没有改写真实旧单素材或旧成片。55359临时验收环境已清理，日常服务保留。

![真实旧单原生剪辑](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/06-真实旧单原生剪辑-登录后.jpg)

![真实时间线播放后暂停](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/07-真实时间线播放暂停.jpg)

![保存返回素材页](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/08-真实剪辑保存返回回读.jpg)

![保存后再次打开](/Users/dan/Programs/loop-control/docs/verification/compact-workflow-round7-20261030/screenshots/09-真实旧工程保存后再次打开.jpg)
