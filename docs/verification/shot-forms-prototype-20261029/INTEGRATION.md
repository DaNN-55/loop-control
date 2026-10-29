# A 版选择与接入

用户于 2026-10-29 选择 A：连续表单。保留真实功能，精简解释性文字。

采纳：三栏与图标增删、镜头列表展开/折叠及折叠后切换；构图整合为图示与连续参数；字幕定位图加宽且右侧字段限宽；声音编辑、试听和重新生成相邻，跟随口播时不重复展示正文。

正式实现修改既有 ShotWorkbench、ShotPreparationCard 和 ProductionShotRail，不复制模拟状态或绕过真实写入/阶段围栏。原型的入出点数字框只有在能保持原有验证与标记操作时才接入；已有标记轨道、锁长、逐帧和对齐功能必须保留。

原型文件：src/episodes/ShotForms.prototype.tsx、shot-forms.prototype.css、ShotForms.prototype.md、src/ui/PrototypeSwitcher.tsx、scripts/prototype-shot-forms.mjs。宿主原型集成：EpisodeProduction.tsx 的 dev lazy import、initialNode 查询判断和 ShotWorkbench 的 prototype=shot-form-layout 渲染分支；包脚本 prototype:shot-forms。归档后移除这些入口。

完整 A/B/C 原型归档到 codex/prototype-shot-forms-20261029。原型读取真实分镜、缩略图、素材和音轨；所有写操作仅为本地状态。日常应用和设计规范依赖当前工作区。

归档提交：`859563700f1db29618b320d54d5ee0e5c4242cff`。正式接入完成，见 [验收记录](../shot-forms-formal-20261029/REPORT.md)。
