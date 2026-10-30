# 真实生产单浏览器复测

2026-10-30。目标为真实“操作电脑-v3”，生产单 `92b3067d-ced9-4e85-bc44-1968fa83695a`。本轮实际操作结果：高度通过，字幕拖动失败。没有修改业务代码，不把此前隔离测试的通过结果当作真实单验收。

## 浏览器与操作边界

- 使用 agent-browser 启动独立可见 Chrome，由用户自行登录 `127.0.0.1:5174`。跨源原生剪辑器的坐标通过该 Chrome 的标准 CDP 读取。
- 原生编辑器为 `127.0.0.1:52805`，真实七镜头、53.63秒工程。通过鼠标输入操作预览字幕，没有用输入框或脚本写字段代替拖动。
- 不读取密码或登录凭证；不执行生成、导出或交付，不停止项目服务。

## 高度：通过

1920×906视口、普通剪辑模式中，实际滚动外层生产单容器，测量 `.production-workspace-body.getBoundingClientRect().height`。

| 顺序 | scrollTop | 工作区高度 |
| --- | ---: | ---: |
| 1 | 0 | 800px |
| 2 | 100 | 800px |
| 3 | 200 | 800px |
| 4 | 245 | 800px |
| 5 | 95 | 800px |
| 6 | 0 | 800px |

实测固定高度没有随上下滚动变化。原始数据：`height-measurements.json`。本轮没有切换其他三个节点重测；这里的结论限于当前真实剪辑页。

## 字幕拖动：失败

1. 在预览选中第一条字幕“第一批把电脑交给豆包的人，已经出现了。”。
2. 按下鼠标，连续九段移动，累计向右45px、向上40px，再松开。指针事件实际命中 `cc-capedit-hit`，不是落在视频或右侧属性栏。
3. 实际字幕框前后均为 `x=780.640625, y=230.265625`，`transform`仍为 `translateY(-50%) translate(0px, 0px) rotate(0deg) scale(1)`。预览没有跟随最终位置。
4. 编辑器内存中的第一条 `sourceEntry` 出现 `offsetXRatio=0.2459016393442623`、`offsetYRatio=-0.12307692307692308`；对应 `caption-slot-shot-001-hook` 的两个偏移仍为0。见 `single-window-drag.json`、`single-window-moved-values.json`。

这张真实单采用 `layoutPolicy.mode=manual-slots`。当前 SDK 的 `lanes.ts/placementOf` 优先读取槽位；`captionPreviewTarget.ts/captionPreviewLayoutPatch` 对手动字幕却只更新 sourceEntry。读写对象不一致，可以解释本次“写入了偏移，预览仍不移动”。后续修复应使编辑入口与实际渲染位置一致，并测试不会影响其他字幕槽位。

多窗口初测时还观察到 `writable` 反复切换和连接遮罩。用户关闭原剪辑页后，刷新测试窗口恢复连接；随后单窗口仍复现上述拖动失败，故不能把失败仅归因于多窗口。原始连接事件保存在 `connection-events.json`。

## 恢复与收尾

- 测试前只排除 `selectedId/selectedIds` 后计算全工程内容SHA256，基线为 `29915cd8f6459821773b4560b56e741ac305850c7667891fd0d0776800ce38c2`。
- 多窗口失去写连接时，先确认落盘仍为基线，再刷新测试窗口丢弃未落盘的临时测试状态；内存重新加载后也与基线一致。
- 最终单窗口测试使用原生撤销恢复全部本轮历史。恢复期间自动审批曾拦截继续撤销；随后只读核对确认剩余差异仅第一条字幕在 timeline/track 中同步存储的两个偏移，替换为测试前已记录值后，完整指纹精确匹配基线。此证据保存在 `restore-difference-proof.json`。附带证据的单次撤销随后获准执行。
- 最终编辑器内存、落盘文件的内容指纹均恢复基线，分别见 `live-restore-check.json`、`persisted-restore-check.json`。没有留下测试字幕位移。
- 已关闭本轮自己启动的测试 Chrome；没有关闭其他项目服务。

## 截图

拖动前：

![单窗口拖动前](/Users/dan/Programs/loop-control/docs/verification/workspace-height-caption-drag-20261030/real-browser/screenshots/05-single-window-before.png)

真实鼠标拖动后，字幕仍位于原处：

![单窗口拖动后](/Users/dan/Programs/loop-control/docs/verification/workspace-height-caption-drag-20261030/real-browser/screenshots/06-single-window-after-drag.png)
