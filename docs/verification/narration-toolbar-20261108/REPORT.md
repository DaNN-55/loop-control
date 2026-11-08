# 口播工具栏与字幕编辑提示

2026-11-08。沿用 Dan UI 和画面生成工具栏的轻量视觉，仅修改 WorkspaceNarrationToolbar.tsx、WorkspaceSpeechSample.tsx、WorkspaceNarrationCaptions.tsx、workspace-narration-settings.css 和 PLAN.md。

- 保存设置继续保存本期后续生成的模型、音色与语速，不生成音频或改动历史音频；扩充悬停说明。
- 口播工具栏的模型、音色、语速采用无常驻边框和阴影的透明样式；保留 hover 与 focus-visible/focus-within。试听与保存均使用 sm/tertiary 和 32×32px 图标入口。试听组件新增可选 buttonColor，其他调用继续使用原有 secondary 默认。
- 移除口播工具栏及字幕操作区上方分隔线；保留与画面输入区一致的编辑器整体边界。
- 字幕状态标签仍表示跟随/独立/未保存。正文可以直接编辑；提示改为“直接修改正文，保存后单独使用”，通过 aria-describedby 关联正文。跟随、独立保存、失败草稿恢复逻辑均未修改。

验证：41 项 WorkspaceNarrationPanel / WorkspaceSpeechReading 组件回归、npm run check、前端 Vite build（emptyOutDir:false）通过。保留现有 jsdom 媒体警告和大包提示。

实际 5174 页面检查 1490×953、1152×790；均无横向溢出，保存/试听均 32×32px，无常驻阴影；字幕直接编辑后保存按钮启用，恢复原文后禁用。voice.png 展示临时未保存语速调整，使保存图标可见；captions-edit.png 展示未保存字幕草稿。检查后恢复原语速/原字幕文字、清除 viewport override 并关闭自建验证标签页。未保存日常设置或字幕，未生成、试听合成、采用或撤销；前端已更新，无需服务重启或迁移。测量见 layout.json。
