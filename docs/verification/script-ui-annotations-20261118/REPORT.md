# 脚本界面批注收尾（2026-11-18）

按用户授权完成批注1–7、9；第8上传脚本位置只建议，本轮位置、显示和文案均保持原样。仅改局部样式和弹层className，不改prompt、后端、模型上下文或附件／会话业务逻辑。

## 变化与根因

- 使用示例弹层200px、附件240px、推理232px；保留通用viewport上限。附件关闭入口绝对定位在上传槽右上，不再占额外标题行；dialog的可访问名称保留。
- 模型弹层标题与型号12px，页脚11px。交流方式未选hover／已选／已选hover／按压分别使用12%／20%／24%／28%主题强调色，选中hover继续加深。
- 新开对话+改为2px深色虚线边框，hover／focus增强。右四控件桌面实际间隙8／8／8px，390px窄屏6／6／6px。
- 删除叉号原被全局 `@scope (.dan-ui) .relative {position:relative!important}` 覆盖而落在图下，icon全局规则又将其撑到36px。新增附件专用class，仅局部覆盖该定位并设置尺寸变量：桌面24×24，右上角offset=0／0；hover／focus-within显示、离开隐藏；hover:none／coarse常显，coarse48×48。

## 实际验证

- 独立Chrome运行真实WorkspaceScriptPanel／聊天／附件组件与全部生产CSS；API和图片均为本机受控fixture，不接触正式单或付费服务。
- computed检查：示例200px、附件240px、推理232px；附件header position:absolute，关闭入口桌面24px／触屏48px，model字体12／页脚11px。
- 已选hover确认为24%（srgb .810824／.849412／.970824），深于已选20%（.842353／.87451／.975686）；未选hover12%（.905412／.924706／.985412）。状态切换后等待CSS transition结束再读取。
- 鼠标离开／移入／离开：删除opacity=0／1／0；键盘Tab可聚焦并显示2px outline，Space真实移除。390px触屏模拟确认pointer:coarse及hover:none均true，删除48×48、opacity1，真实点击后待发附件数归零；页面scrollWidth=innerWidth=390，没有横溢。
- 桌面1280px和390px实际打开弹层、检查截图／键盘关闭；触屏小弹层关闭入口不挤占上传内容。隔离页console无error／warn。
- 71项既有脚本相关测试通过；npm run check、npm run build、git diff --check通过。构建保留既有>500k chunk提示，WorkspaceScriptStudio测试保留既有act提示；没有为纯样式新增镜像单测。
- 主agent只读审查后，修正已选hover选择器优先级并复核实际四控件rect。未运行无新增风险依据的全量业务回归。Safari和实体触屏未实测。

本轮前端fixture、缓存、日志在收尾后清理，仅保留本报告与实现。无正式数据写入、收费请求或push。

## Modern Web Guidance

- **natural-interactions**：我让悬停删除同时在focus-within显示，并在无hover设备常显，遵循“must also appear on keyboard focus”，避免只有鼠标能删除。
- **accessibility**：我保留删除按钮原生键盘语义与焦点圈，桌面24px、粗指针48px，遵循“target of at least 24x24 CSS pixels”，没有用display:none隐藏仍需聚焦的入口。
