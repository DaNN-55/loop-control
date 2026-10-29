# 四步制作流程 UI 原型

日期：2026-10-29。状态：用户已选择 A，实施规格已发布；当前仍仅原型，未实施正式四步状态迁移。

## 范围与入口

保留原生产单的导航外壳、登录、数据读取，在 `EpisodeProductionView` 内以 dev query 替换展示子树。没有向原型传入真实生成、保存、修订、审批或交付回调。

`http://127.0.0.1:5174/?episode=bbea3b57-061b-4341-9ba1-3bf65d28899f&prototype=four-step-workflow&variant=A`

运行：`npm run prototype:four-step`。A / B / C 或底部方向按钮、键盘方向键切换。详情见 `src/episodes/FourStepWorkflow.prototype.md`。

新增原型源码：
- `src/episodes/FourStepWorkflow.prototype.tsx`
- `src/episodes/four-step-workflow.prototype.css`
- `src/ui/PrototypeSwitcher.tsx`
- `scripts/prototype-four-step.mjs`

接入改动仅 `EpisodeProduction.tsx` 的 dev lazy/render gate、`package.json` 的演示脚本及 `PLAN.md` 记录。原先未提交改动全部保留；未提交、推送或调用真实生产写入。

## 演示内容

四步：脚本确认 → 素材准备与匹配 → 整期剪辑 → 检查与交付。

A 是镜头导航 + 预览与属性 + 编辑区时间线。B 是大幅脚本文档 + 右侧预览/属性上下排列 + 全宽时间线。C 是全宽预览和时间线 + 按需素材/属性/镜头浮层。

所有 API 生成、候选采用、剪辑状态、字幕时序、导出检查和交付结果均为内存模拟。视频、图片及原有口播试听来自现有样片只读文件。成片播放为旧样片参考，不是本次模拟编辑重新渲染的结果。新选本地文件只以 object URL 进入浏览器内存。

## 实际验证

- TypeScript + Vite 隔离生产构建通过，见 `build.log`。输出在临时目录，未覆盖日常运行产物。已有 chunk >500kB 提示继续存在。
- 构建 assets 搜索 `four-step-workflow`、`FourStepWorkflowPrototype`、`fsw-prototype`、`仅内存` 均无命中，原型未进入生产产物。
- 三版 1543×953、800×900 页面 scrollWidth 均等于 innerWidth；布局和字段内部无横向溢出。另实看 1381 宽 A 版。窄屏允许纵向滚动。
- 真实素材缩略图与原片显示；原有音轨可试听。当前浏览器 console errors 为空。
- 实际点击口播重生：先产生 v2 候选，采用前时间线不替换；采用后字幕待对齐，模拟导出检查阻止交付；重新对齐后可观看确认并完成模拟交付。
- 模拟交付后编辑时长，原有检查与观看确认失效，确认交付重新禁用。
- 素材准备中模拟 S05 失败，仍能组装初稿、选中占位并继续编辑其他镜头。
- 修改演示脚本为两段并确认，确实形成两个待生成口播镜头；首次生成完成后可组装初稿。
- C 属性浮层可开关且位于窄屏内；键盘方向键可切换方案，镜头时长输入框内方向键不切换方案。
- 临时创建的登录页标签已关闭；演示在已登录标签中交付。浏览器标签发生过替换，随后在当前已登录标签恢复演示。

没有为 throwaway UI 添加测试；没有验证真实 Provider 调用、实际 OpenChatCut 嵌入、生产工程增量保存、重新渲染、交付包写入或真实文件选择上传。

## 已确认选择

用户已选择 A「一体编辑台」，确认真实 OpenChatCut 接入、首次生成提前与局部重生。实施规格：[https://github.com/DaNN-55/loop-control/issues/152](https://github.com/DaNN-55/loop-control/issues/152)，标签 ready-for-agent。测试边界已由 Owner 明确确认。

正式实施前归档完整原型并记录架构决定；当前不更新 ADR-0014、不迁移生产单状态，原型不代表真实接入已经完成。
