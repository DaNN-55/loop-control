# 工作台视频预览组件调查

核查日期：2026-11-02。范围：React 19 / Vite、约 320 × 200 的本地 MP4 预览；默认显示封面，可左右切换；控件仅在悬停、键盘操作或触摸交互时出现。本文只调查选型，未安装依赖、修改产品代码或进行浏览器实测。

## 建议

新增播放器优先采用 **Video.js 10 的 `@videojs/react`**，保留现有的封面 / 视频切换逻辑。它已于 2026-10-01 发布 GA，官方将 v10 列为新项目推荐的稳定版本；React 安装页明确覆盖 React 19 和 Vite。旧仓库 README 仍可能被搜索结果展示为 beta，应以当前发布公告与路线图为准。[GA 公告](https://videojs.org/blog/videojs-10)、[路线图](https://videojs.org/docs/framework/react/guides/v10-roadmap)、[React 安装](https://videojs.org/docs/guides/installation/react)

现成皮肤可先试 `NeutralVideoSkin`；若完整工具栏在小预览中拥挤，则复用它的组件，只保留播放、进度和必要的音量 / 全屏操作。官方支持直接编辑皮肤源码或用无样式组件自行排版。[NeutralVideoSkin](https://videojs.org/docs/framework/react/reference/components/video-neutral-skin)、[自定义皮肤](https://videojs.org/docs/framework/react/guides/build-your-own-skin)

**「自动隐藏」不等于「暂停后也只在悬停时显示」。** 本次核查的 Video.js、Media Chrome、Plyr 默认行为都不直接满足后者。左右切换箭头属于预览容器；其透明背景、无边框样式应由本项目 CSS 定义，无需为这个要求引入另一套播放器。

## 对比

| 组件 | 当前维护与 React 接入 | 暂停 / 隐藏行为 | 本场景取舍 |
| --- | --- | --- | --- |
| Video.js 10 | 已 GA；官方 React 包、React 19 / Vite 路径。v8 只维护 bug 和安全补丁，2027 年起仅安全补丁。[路线图](https://videojs.org/docs/framework/react/guides/v10-roadmap) | 默认暂停时保持显示；播放时空闲 2 秒后隐藏，移出立即标记不活跃；触摸轻点切换。延迟不可配置。`Controls` 本身无视觉样式，CSS 根据 `data-visible` 显隐。[控件参考](https://videojs.org/docs/framework/react/reference/components/controls)、[隐藏指南](https://videojs.org/docs/framework/react/guides/controls) | 第一候选。复用现成播放、进度、音量和全屏组件，额外定制暂停后的显隐规则。 |
| Media Chrome | 提供 `media-chrome/react` 包内封装；README 宣布团队与 Plyr、Vidstack 联合建设 Video.js，并建议新项目尝试 Video.js。**未找到足以断言其已弃用或仅安全维护的明确声明。** [React 文档](https://www.media-chrome.org/docs/en/react/get-started)、[官方 README](https://github.com/muxinc/media-chrome#readme) | `autohide` 默认 2 秒，但明确排除暂停状态；`autohideovercontrols` 也不会使暂停控件消失。可通过外部 CSS 及组件变量自定义。[MediaController](https://www.media-chrome.org/docs/en/components/media-controller)、[样式指南](https://www.media-chrome.org/docs/en/styling) | 第二候选。原生 `<video>` 加可组合控件，适合精简布局；隐藏规则仍需定制，且新项目方向已转向 Video.js。 |
| Plyr | 官方明确 deprecated、只提供安全更新，建议新项目使用 Video.js 10。README 中 React 接入链接指向第三方 `plyr-react`。[官方仓库](https://github.com/sampotts/plyr) | `hideControls=true` 会在无活动 2 秒后隐藏，但暂停立即恢复控件；有 `toggleControls()` API。仅打开该配置无法达到暂停后也隐藏。[配置与 API](https://github.com/sampotts/plyr#options) | 不建议新增。可以靠 CSS / API 改造，但本场景没有抵消维护取舍的优势。 |
| Vidstack | 官方宣布 1.x 只合并优先安全修复，持续至 2028 年 1 月；团队工作转向 Video.js 10。[官方介绍](https://vidstack.io/docs/player/) | `controlsDelay`、`hideControlsOnMouseLeave` 等配置存在；文档将空闲隐藏描述为播放期间行为。**本次未实测暂停加移出时的完整状态组合，不能断言只靠配置即可稳定满足要求。** [Player API](https://vidstack.io/docs/player/components/core/player/)、[状态源码](https://github.com/vidstack/player/blob/main/packages/vidstack/src/core/api/player-state.ts) | 不建议新接入；已有 Vidstack 项目按迁移成本决定时机。 |

## 显隐实现边界

Video.js 官方 `Controls.Root` 的 `visibility` 只有 `auto` 和 `always`；`auto` 将暂停列为强制显示条件。官方的「Custom show/hide styling」示例只是根据 `data-visible` 处理动画，**没有改变暂停时的判定**。因此，采用默认皮肤后再设置一个自动隐藏选项，不能直接满足本需求。[控件参考](https://videojs.org/docs/framework/react/reference/components/controls)

可行方向是复用现成控件，自己控制它们的外层可见性：鼠标悬停显示，键盘焦点进入显示，触摸时显示并按约定收起。Video.js 组件不附带视觉样式，支持自定义类名和 CSS，因此这是有官方能力依据的实现方案；**尚未在本项目验证，不能当作现成配置已完成的效果**。隐藏时还要同步处理点击穿透，并保留键盘焦点控件的可见性。不要让透明控件继续挡住视频，也不要用 `display: none` 使键盘入口无法到达。[样式和焦点示例](https://videojs.org/docs/framework/react/guides/controls)、[组件与皮肤](https://videojs.org/docs/framework/react/guides/build-your-own-skin)

验收应覆盖初始封面、首次播放、暂停后移出、重新悬停、键盘聚焦、触摸唤出、左右切换后旧视频停止，以及 320 × 200 下控件是否溢出。本报告未执行这些产品验证。
