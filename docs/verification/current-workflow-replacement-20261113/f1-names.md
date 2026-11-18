# F1 职责名称与实际采用信息


> 产物清理记录（2026-11-18）：本目录的历史测试生成附件已按用户要求清理；本文验收结论保留。源测试输入、恢复资料、生产单和数据库未删除。

通用执行器改为 `mediaTaskRunner`／`runMediaTask`，当前 CLI、导入和运行包使用同一入口。原 review-render/v1／shot-preparation 解码独立进入 `worker/history/reviewRenderV1.ts`；原 53 个函数经 AST 对照，仅职责名称、导出位置和一条错误文案变化。原 ID、机器协议、冻结包及文件不改写。

新建素材和节点显示「镜头 01 口播」等名称；已有人工名称继续保留。口播草稿使用可见 label，状态按实际 `usedNarration` 区分，正文不同时可展开成片采用正文；编辑草稿不改变采用、不新建任务。

真实隔离回归 `run-BVBBSH`：1 项浏览器集成通过，0 失败／0 跳过，完整类型和 Worker／backend 构建通过。包括 Owner HTTP、实际原生保存人工名称、受控 Worker 生成后拒绝、采用保持、1365×900／390×844 页面、刷新后草稿保留和无水平溢出。窄屏正文按自然页面滚动读取；DOM 核对采用正文。截图及原结果见 [evidence-f1](evidence-f1/)。外部付费／视频 API 调用为 0，自有容器已清理。

单元分批：执行器 26 项通过；组件／命名／host 模块批次 85 通过、1 失败，定位为原声替换覆盖人工名称，修复后相关 workspaceAudio 全 7 项通过；没有把分批结果冒称同一次整轮。测试夹具缺新模块与重复隐藏文本定位也保留在私有 diagnosis.md。两轴只读审查均 0 开放。

Modern Web Guidance：使用 forms 指南的可见标签及关联要求：“DO always associate `<label>` with its input using `for` and `id`.” 未改变提交／明确采用或原本的保护。

本项完成 F1，F2 与最终 G 继续，不将专项通过当作完整 A–G 完成。未操作日常、不提交、不推送、不修改共享 SDK。
