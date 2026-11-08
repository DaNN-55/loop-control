# 素材与生成输入区细节验证

2026-11-08，正式 5174 前端。范围为用户 7 条浏览器标注，以及随后要求的缩略图进一步缩小、关闭按钮统一样式。

## 变更

- 删除素材面板顶部重复的收起按钮，保留底部伸缩入口和高度调整。导入文字 13px、图标 15px，居中对齐。
- 素材采用自适应紧凑方形网格，图片/视频 `contain` 完整呈现。1543px 桌面随分栏宽度为 4–5 列、约 92–105px 缩略图；1152px 窄窗实测为 3 列、约 87px。视频缩略图使用极短起始时间片段以显示静止帧，不自动播放。
- 每张素材右上角增加独立预览按钮，去掉底部“预览所选素材”。单击选取、双击预览、拖放和只读沿用。
- 素材预览使用现有 UI 样式，关闭为无边框、无底色的叉号图标，保留无障碍名称“关闭素材预览”。
- 移除参考图空容器的 108px 最小高度占位，提示词增加浅色底和细边框，保留缩放、焦点及超限错误状态。空图片输入区整体从约 249px 收紧到约 200px。
- 图/视频生成工具栏统一 32px 控件高度、13px 字号，窄窗自然换行，模型和配置功能沿用。

## 验证

- `npx vitest run src/local-app/WorkspaceMaterialShelf.test.tsx src/local-app/ProductionWorkspacePanel.test.tsx src/local-app/WorkspaceVisualPreparation.form.test.tsx src/local-app/WorkspaceImageOptions.test.tsx --reporter=dot`：4 文件、45 项通过。
- `npm run build`：类型检查及构建通过。构建保留现有大包提示；媒体组件测试存在已有 act 警告，无失败。
- `npm run runtime:prepare`：Worker/编排/后端源码与产物完整性检查通过。5174 HTTP 200。
- 正式页 1543×953、1152×790：完整方形缩略图、视频静止帧、素材筛选、独立视频预览、叉号关闭、图片生成数量弹层及视频规格弹层实际操作通过；工具栏控件均 32px，页面无横向溢出。关闭测试弹层、恢复图片/全部素材视图并清除临时 viewport override。
- 新增回归覆盖预览音频素材不改变已选图片、关闭按钮可访问、顶部重复入口已移除；原筛选、只读脚本预览、选取/取消与拖放数据测试保留。

未发起供应商生成、上传、采用或保存操作；未改后端、数据库或已保存素材。未做真实供应商回归，未重启日常服务、提交或推送。

## 证据

- [桌面](desktop.jpg)
- [窄窗](narrow.jpg)
- [视频窄窗](video-narrow.jpg)
- [预览与关闭](preview.jpg)
- [实际尺寸](browser-checks.json)

修改前相关文件位于当前聊天可视化目录的 `material-composer-polish-baseline/`，与原有未提交改动分开保留。
