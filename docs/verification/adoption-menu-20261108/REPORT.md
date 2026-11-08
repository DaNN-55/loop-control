# 采用菜单说明

2026-11-08。恢复图片采用菜单原来的左对齐、名称＋说明样式，复用现有菜单样式；保持按钮无障碍名称和确认行为。

- 采用到当前镜头：用作镜头画面，保持时长不变。
- 保留为备用图片：仅保留备用，当前视频不变。
- 已采用／已选用继续禁用，并说明当前状态。

45 项相关测试通过；类型与构建通过，runtime:prepare 恢复并验证运行产物。正式 5174 实测菜单 213px 宽、左对齐，补充说明单行显示，未执行采用、生成、保存或数据修改。截图 `menu.jpg`。仅前端变更，无后端重启。

缩略图区仅提供方案建议，未修改布局。GPT Image 2.6 仅核对：官方 Sunburst、Flare 文档及当前连接的只读模型目录中均存在；本次未注册或启用 2.6，没有付费调用。

官方文档：
- https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst
- https://developers.openai.com/api/docs/models/gpt-image-2.6-flare

本次修改前源码在当前聊天可视化目录 `adoption-menu-explanation-baseline/`，未提交或推送。
