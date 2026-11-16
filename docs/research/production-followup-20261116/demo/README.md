# 三种布局 Demo

[打开交互 Demo](http://127.0.0.1:8766/?layout=B&step=preparation)。这是独立静态页面，不连接正式生产 API，不修改生产单、模板、日常配置或产品代码。

- **A 双栏检查**：镜头列表＋集中详情，适合沿用现有习惯，改动较小。
- **B 三栏工作台（建议）**：镜头、预览、属性并列；画面／字幕口播／声音切换时保留画面上下文。
- **C 总览与抽屉**：全片表格，一次打开一个镜头；适合交付后核对，页面不会叠六套配置。

顶部可以切换 A/B/C，并进入分镜台、剪辑工作台和检查与交付。候选可打开查看图片或旧视频；提示词窗口按“制作输入／实际提交／原脚本”切换。剪辑页只显示选中镜头。交付文案用三个独立文本区，复制图标在悬停、键盘聚焦时出现；触屏始终可见。

示例媒体、六段口播、字幕时序和冻结提示词取自乔迁测试单；图像候选有的作为首帧／封面使用，“未采用”指未作为当前镜头画面。Demo 视频下载仅为本地样例；完整交付 ZIP 和源素材仍保留在原生产单目录。

运行目录：本文件夹。若本地预览服务已停止，可从项目根目录执行：

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs/research/production-followup-20261116/demo
```

## 验证

- Chromium 实际点击 A/B/C × 三个步骤，均可显示；候选弹窗、视频、提示词版本、字幕镜头切换已核验。
- 已验证复制按钮悬停 opacity 0→1、复制成功提示；弹窗键盘焦点留在窗口内，Escape 可关闭。
- 320／768／1024／1410 宽度无整页横向溢出；窄屏总览表允许自身横向滚动。
- `node --check` 通过；浏览器 page errors 为空。
- WCAG A/AA axe 扫描交付页为 0 violations、2 组 incomplete：非文字装饰图标的对比度及视频字幕需人工判断。最终视频已有烧录字幕；未宣称完成全站无障碍验收。
- 未运行正式项目全套测试／构建，因为没有修改正式实现。测试观察记录保留在父目录，原始浏览器记录在 `.scratch/production-followup-20261116/`。

## Modern Web Guidance

- **`css-layout`**：我用可收缩的 Grid 轨道与 `min-inline-size: 0` 保持长文案在面板内，不用裁掉内容掩盖溢出（“Set `min-inline-size: 0`”）。
- **`content-first-noise-reduction`**：我把技术检查和导出历史收进原生 `details`，候选参数按点击查看，避免占满默认页面（“Put long or rarely needed content … in a `details` element”）。
- **`dialog`**：我用原生 `showModal()` 保留焦点约束、Escape 与关闭恢复，没有重复手写焦点陷阱或 ARIA modal（“DON'T add `role="dialog"`, `aria-modal`”）。
