# 字幕拖动、连接频闪和打开速度

2026-10-30，PC端。浏览器验证均在右侧内置浏览器进行。OpenChatCut升级另行准备，以下为0.2.14加本项目兼容修复的已完成验证。

## 已完成改动

### 字幕实际位置

真实工程采用 `manual-slots`。SDK渲染优先读槽位，预览拖动和原生属性栏却写/读单条来源的旧偏移，所以鼠标事件正常、保存值变化，预览仍不移动。

新增 `scripts/openchatcut-caption-layout.mjs`，通过现有Vite适配层修正有效槽位的位置写入、方向键微调、重置和原生右栏读数。保留其他槽位、来源正文、时间、样式、安全区尺寸及无槽位/单字幕的原生路径。重置偏移归零并保留槽位锚点和安全区。

实际SDK回归先失败：期望渲染偏移0.25/-0.125，实际仍0/0。修复后4项槽位集成通过，包括只有slotId的新工程来源，以及过时来源偏移不应覆盖实际槽位。未修改安装的SDK源码。

### 编辑连接频闪

右侧原单修复前捕获20次注册和20次轮询409冲突。服务端只读采样发现两个不同owner持续接管、epoch递增；当前可见标签和frame各只有一个runtime，因此另一runtime不属于当前可见frame，未进一步读取无关页面。

SDK遇409会清除编辑权，再每秒重新注册，形成互相抢回循环。新增 `scripts/openchatcut-bridge-retry.mjs`：401/409和取消后停止本轮自动抢回；临时网络错误仍重试；已取消的迟到注册不再安装编辑权。保留原有所有权校验，不用隐藏遮罩或去抖掩盖冲突。实际SDK原函数的受控双runtime测试证明：旧版持续抢回，新版被接管的一方停止。

### 打开速度

同一次打开对完全相同JSON文档的SDK读取由3次降为1次。两次来源、身份、SHA及候选校验仍照常执行；文档变化重新读取，跨调用不缓存。

定向日志实际记录 `sdkReads=1, validatorCalls=2, readDurationsMs=[100], elapsedMs=1172`。子agent测得原三次读取106/91/128ms，消除的两次SDK工作量约0.15–0.25秒。这不代表完整“点击到可编辑”的总等待必然缩短同样时间；Vite冷启动、前端加载和连接握手仍影响总耗时。未引入长期保温进程。

## 右侧浏览器操作记录

1. 保留真实日照原单标签21，新建一次性合成媒体原生工程标签22，不登录其他Chrome。
2. 实际鼠标向右45px、向上40px：字幕框也移动45px、-40px，原生右栏水平/垂直读数同步。
3. 点击原生“变换→重置”，偏移归零且按钮禁用；撤销恢复移动位置，再撤销恢复拖动前位置，重做再次生效。
4. 经原生“返回工程列表”保存，关闭并重开测试原生进程，字幕位置保持。截图及 `isolated-pointer-final.json`、`isolated-reopen.json` 留证。
5. 关闭一次性标签并清理合成工程服务、临时媒体。保留真实原单标签。
6. 在右侧真实原单保存返回后，更新5174服务。更新前后三个工作工程的文件SHA均保持，见 `projects-before-update.json` 和 `projects-after-update.json`。
7. 新真实编辑器连接连续观察153259ms，12个原生轮询/取消轮询响应，0个409、0次重新注册，状态保持已连接，见 `real-connection-stable.json`。
8. 在真实日照原单通过浏览器标准鼠标输入拖动字幕，实际45px/-40px；一次原生撤销恢复原位，撤销历史回到空状态，见 `real-pointer.json`。保存工作版本反馈通过。
9. 随后完整指纹比较发现镜头排序、效果和少量字幕偏移的额外变化。没有强制回滚。用户已明确回复“是，我正在测试，请保留修改”，故保留全部现状并停止原单UI写操作。`real-restore-check.json` 的false及 `real-save-difference.json` 保留原始结果，不将它们改写为全工程未变。测试前不可变版本仍保留。

## 检查结果

- 171文件、1159项普通回归全部通过。
- 19项定向/实际SDK集成全部通过，包括同尺寸源文件在第一次检查后被篡改，第二次SHA检查仍拒绝。
- 类型、构建、本机运行包准备和相关文件 `git diff --check` 通过。既有前端bundle体积告警仍在。
- 初次沙箱运行因本机监听端口EPERM失败；允许本机测试监听后重跑通过。新集成的临时目录清理曾有ENOTEMPTY，增加有界清理重试后重跑通过，未放宽业务断言。
- 另跑既有OpenChatCut整组时，11/12通过；1项旧URL断言仍要求 `/#/editor/`，而既有实现返回 `/?lcBridge=1#/editor/`。本轮未通过改断言掩盖此既有失败。
- 未执行Provider生成或真实导出、交付，未提交或推送。

## 截图

修复后的原生右栏同步：

![右侧测试页字幕与属性同步](/Users/dan/Programs/loop-control/docs/verification/editor-connection-caption-fix-20261030/screenshots/04-slot-synced.jpg)

保存重开保留位置：

![重开后字幕位置](/Users/dan/Programs/loop-control/docs/verification/editor-connection-caption-fix-20261030/screenshots/05-slot-reopened.jpg)

真实日照原单拖动测试：

![真实原单字幕拖动](/Users/dan/Programs/loop-control/docs/verification/editor-connection-caption-fix-20261030/screenshots/07-real-dragged.jpg)
