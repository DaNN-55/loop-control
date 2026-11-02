# 四步制作流程原型

状态：已退役。2026-11-01 清理时确认原型路由和 npm 命令已移除，正式工作区由 `ProductionWorkspacePanel`、统一素材准备与嵌入式 OpenChatCut 承担。原型组件、专属样式、切换器及失效启动器随本轮清理移除；以下保留 2026-10-29 的方案选择与交互边界，入口和命令仅为历史记录。源码可从 Git 历史恢复，验收记录保留在 `docs/verification/four-step-workflow-prototype-20261029/REPORT.md`。

问题：在“首次生成提前，剪辑中允许局部重生”前提下，整期剪辑与素材、脚本应如何组织？

运行：`npm run prototype:four-step`。复用当前日常本机服务，不另起数据库或 Worker。需要现有 Owner 登录。

入口：`/?episode=bbea3b57-061b-4341-9ba1-3bf65d28899f&prototype=four-step-workflow&variant=A`。

- A 一体编辑台：镜头导航、中央预览与片段属性，时间线在编辑区底部。
- B 脚本驱动：文案为主文档，右侧预览与属性上下排列，整期时间线横跨底部。
- C 沉浸剪辑：预览与时间线占满工作区，素材、属性、镜头按需打开浮层。

四步可切换。脚本修改、提前生成、带占位组装、镜头增删排序、素材复用、口播候选采用、字幕重新对齐、检查交付均为内存交互。底部切换器与键盘方向键更换 `variant`；输入框、下拉和可编辑内容中的方向键不切换方案。展开“演示状态”查看相关状态及操作记录。

**边界**：已有脚本/媒体仅通过现有受保护只读接口读取。编辑器是布局与交互示意，不是真实 OpenChatCut 实例。生成和导出结果为模拟；交付预览播放已有样片参考，不是新时间线渲染结果。文件选择仅生成浏览器 object URL，不上传。所有编辑刷新后重置。原型未接任何真实业务 mutation 回调。

开发门控：`import.meta.env.DEV` + 明确 prototype query，生产构建不包含原型组件、样式、切换器。正式六步流程及后台状态契约未更改。

状态：用户已选择 A。实施规格：[https://github.com/DaNN-55/loop-control/issues/152](https://github.com/DaNN-55/loop-control/issues/152)（ready-for-agent）。正式实施前按 prototype 技能归档完整原型到独立分支，记录结论，再按规格接入真实版本。

验收：`docs/verification/four-step-workflow-prototype-20261029/REPORT.md`。
