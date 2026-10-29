# 主 Agent 早期组合 UI 验证

执行对象是已冻结的 T03 工作者树 `bd0f2ec5`，功能对应 T02/T03/T04/T07 合并后的早期集成；本记录不代替后续候选、配乐、交付及最终默认入口验收。使用全新随机数据库、媒体根、合成 Owner 和 localhost 专用端口。

- 真实上传横版 red/blue 原片，锁长 30 帧，起点由 60 增加一帧为 61，保存后实际原生 `srcInFrame=61,durationInFrames=30,durationLocked=true`。
- 第二镜上传条纹图，选择 2 秒本地推拉；原生为 image，60 帧，scale 从 1 到 1.15、x 从 0 到 3 的关键帧保留。原生素材池与时间线均可见。
- 在真实原生属性中将视频水平位置设为 7，再打开宿主字幕改为每行 3 字。真实刷盘并由 Owner workspace/project HTTP 读回：x=7、范围与推拉不变，字幕仅一条轨、一个 lane；分页 0–857.142857ms 和 857.142857–1000ms，正文未丢字。
- 返回、刷新并重新打开实际 Studio，定位第一镜后原生水平 slider 仍为 7；公开 HTTP 与截图相互核对。

证据：`root-native-readback.json`、`root-native-image.png`、`root-native-restored.png`。没有付费生成、日常 DB 写入、日常服务停启或第三方 checkout 改动。

测试调整：初轮同一 127.0.0.1 上不同端口的 Owner 会话可能与并行测试互扰，改用 localhost 专用域名；未将其当作产品会话过期缺陷。Chrome connector 不可用，使用后台内置浏览器。某些 click 等待报告超时但 AX 已显示导航完成，均先读取最新状态，没有重复点击。
