# Local source changes

Upstream: `untitleduico/react@1d410cb8facde8d50869e7bbb5f3d048e2267466`, MIT。保留原始哈希；本地改动不冒充上游。

- 模板 0.5.0：NativeSelect 显式关联 label/id、保留 aria 描述、disabled option；Label 装饰星号 aria-hidden、帮助按钮移到 label 外；Input 中文密码切换、pressed/键盘/焦点及预留空间；Tooltip 帮助触发焦点；theme 中文字体与浅色 success green-700。
- imports：采用文件的依赖改为相对路径，无全局 alias。
- NativeSelect：兼容已有 option/optgroup children，以及官方 options API。
- Button、Tab：暴露 React 19 DOM ref 类型，用于菜单与实际触发元素的焦点恢复；不改变 AriaButton/Tab 行为。
- Toggle：允许既有富文本 ReactNode label，仍由官方 switch 处理键盘和状态。
- Tooltip：保留调用方 portal class，同时补 `.dan-ui` 主题边界。
- Disclosure：Dan UI 原生 details/summary 组合，使用统一 chevron，并非上游或 PRO 源码。
- composition.css：来自模板 dan-ui.css，组合选择器加 `.product-ui` 作用域；product.css 为项目页面布局。
- entry.css / build-dan-ui.mjs：只编译采用的组件，important utilities 包含于 `.dan-ui` CSS scope；dark 同时支持 scope 根节点与后代。html 主题同步由应用壳负责。
- test-setup.ts：仅 jsdom 缺少 CSS.escape 时补浏览器 API，不改变产品运行时。

应用边界适配：HelpTip 采用可聚焦、有名称与键盘事件的 span，避免旧 label 内多出第二个 labelable control；拖放留在原生 draggable 包裹层；按钮复杂内容包裹后由项目组合负责布局。抽屉关闭按钮通过 absolute utility 覆盖官方默认 relative 定位。

2026-10-28 PC审查修复：TabPanel用data-inert选择器隐藏强制挂载的非活动面板；InputBase把isDisabled传至原生输入和密码按钮，保留TextField上下文；主题浅色warning使用yellow-700、深色brand-primary使用brand-950。源码哈希仍保留上游原值，本地差异由此记录。

2026-10-28 内嵌图标选择框：NativeSelect 保留真实 select 作为唯一表单/可访问控件，保留 options、optgroup、原生 change、required/name/disabled；拦截 PC 打开动作，用已采用 React Aria Popover/ListBox 渲染圆角选项及分组。新增可选 icon（默认中性调节图标），控件内左右图标均固定 16px。键盘提交、Escape、Tab 与关闭后焦点恢复集中适配；无新增依赖，不依赖 OS option 圆角。
