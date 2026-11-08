# 音频单输入与开关辨识验收

日期：2026-11-08

## 结果

- 音效、整期配乐统一单输入结构；底部来源选择 Freesound 或上传，选择上传后显示文件槽和已导入音频选择，选择检索服务后显示检索输入。
- 音效意图与检索词合并输入，保留显式保存意图功能；用途、默认检索服务保存在来源弹层，定位方式、位置、时长仍使用底部摘要按钮。
- 移除准备页重复原片声音页签和音频设置齿轮，保留原自动视频原声、候选、试听、采用、重试、混音及只读记录路径。
- 口播、字幕、音效、配乐开关增加“已开启 / 已关闭”，关闭轨道使用局部深灰样式。
- 镜头表格首列基础及 max-width:1150px 规则均为 70px；保留其他列和窄窗滚动规则，未影响其他表格。

## 修改范围与数据

产品文件：`WorkspaceAudioPanel.tsx`、`workspace-audio.css`、`WorkspaceNarrationPanel.tsx`、新增 `workspace-feature-switch.css`、`production-compact.css`，均位于 `src/local-app/`。

沿用原音频命令与数据结构；新增本地草稿输入模式与统一提示词字段。切换来源保留检索草稿和原选择素材，旧 source 草稿仅回退显示配乐而不写业务数据。整期配乐和默认服务仍按生产单保存。上传只准备素材/候选，采用仍由用户明确操作。

无后端、Worker、数据库迁移和密钥变更；未重启日常服务或剪辑器。浏览器验收未执行真实检索、上传、保存、采用或开关写入；临时输入已清空，测试页关闭。

## 自动原声证据

- `src/local-app/workspaceVideo.ts`、`workspaceCandidateAdoption.ts` 在采用视频时调用原声准备。
- 隔离 HTTP/数据库/Worker 集成实际采用视频，并断言 `videoSound.mode === 'separate'`，通过。
- `src/local-app/workspaceVideoSound.ts` 提取失败回退 embedded、无音频流使用 silent；`src/workspaceVideoSound.ts` 保留口播/静音规则。本次对回退和无声分支为源码核对，未宣称实际运行覆盖。
- 原声音量仍可在剪辑台调整到 0；没有音频流时不产生声音轨道。

## 自动检查

1. `WorkspaceAudioPanel.test.tsx` 22 项、`WorkspaceNarrationPanel.test.tsx` 27 项、`ProductionWorkspacePanel.test.tsx` 35 项，共 84 项通过。
2. `workspaceVisualCandidates.integration.test.ts` 定向 Owner 视频候选采用集成 1 项通过，21 项未运行；使用受控本地 Provider，无付费调用。
3. `npm run check` 通过。
4. Vite 前端构建通过，使用 `emptyOutDir:false` 保留日常运行产物。现有大包提示仍存在。

测试随入口迁移至来源弹层/上传模式，保留实际请求、默认保存、采用和父级不误写断言。新增来源切换草稿保留测试。调试中修正了测试的旧标签、异步断言时机和缺少用途的测试素材，未放宽产品约束。

## 浏览器检查

- 1543×953、1152×790 均实际测得首列 70px，页面无横向溢出；1280×720 也核对过基础布局。
- Freesound 模式只有一个正文输入；上传模式显示文件槽和本地音频选择。
- 配乐显示单一检索输入；来源弹层能选择 Freesound 本地或上传，保留用途、刷新和设为本期默认。
- 窄窗来源弹层在可见区域内，配置按钮保持紧凑排列。
- 使用既有关闭口播状态验证：配置隐藏、可见“已关闭”，轨道实际颜色 `rgb(89, 107, 131)`。首次验收发现组件库 `!important` 背景覆盖，修正局部优先级后重新构建并实测通过。
- AX 与 Playwright 对组件角色映射不同（AX checkbox，DOM button）；改用实际 DOM button 定位后切换成功。

截图：`effects.png`、`upload.png`、`music.png`、`switch-off.png`、`narrow.png`。
