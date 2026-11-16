# OpenChatCut 查看副本再次审查

2026-11-16。针对用户要求核查旧页面残留，以及副本编辑、保存、删除与已完成生产单／原素材的隔离。采用 code-review-and-quality；另有独立只读审查。未发现需要修改业务实现的问题，本轮仅加强集成测试并记录证据。保留并行工作，未提交或推送。

## 结论与来源

1. **旧专用只读页没有运行代码或可达入口残留。** WorkspaceProjectViewer.tsx、其测试和专用样式／时间线已不存在；src/scripts 搜索旧组件／CSS 名称仅命中 CompletedStudioView.test.tsx 的“不存在旧组件”断言。历史文档保留旧验收记录并明确标为历史。LegacyEditing 和完成态只读数据／配置读取是既有历史及原单保护能力，未误删。
2. **编辑和自动保存落在副本。** completedStudioCopies.ts 从 READ ONLY 加载的交付冻结 SHA 建立新 temp 根，服务端独立 UUID 决定 runtime/project ID；真实 SDK 使用该根的独立数据与媒体目录。每个原 src 都改写，所有 originalFilePath 递归移除。源文件复制后按 size/SHA 核验。运行测试另确认媒体 inode 不同、nlink=1；直接改写副本媒体，原文件字节不变。
3. **另存落在 Owner 独立库。** 只从副本 runtime 获取文档与媒体；目标文档 ID、媒体名带 copyId，路径约束和 safeAssetOutputPath 禁止跳出。已存在不同文档拒绝覆盖，文档／索引／媒体核验完成才返回成功。断连后从副本存储恢复已确认自动保存。原业务命令完成态拒绝维持。
4. **删除仅作用于副本。** 正常 discard 关闭服务端运行身份后只删除新建 temp 根。SDK isolated-dev profile 忽略全局 MEDIA_DIR 和普通存储指针，R2 不启用；原生 DELETE /upload 仅删除该 profile 的媒体文件／引用记录，不会跟随引用删除外部源。已实际验证临时副本和另存独立工程的媒体／工程删除；原素材均不变。将原文件绝对路径传给删除接口被 400 拒绝。
5. **身份与并发隔离。** 会话／Origin／CSRF 校验后，服务端检查 Owner、完成态、核验交付；存活副本的 keep/heartbeat/discard 均检查 Owner+episode 绑定。真实测试覆盖跨 Owner 和跨生产单拒绝。同意图 open 复用 Promise，保存／关闭由 busy 互斥。

## 本轮验证结果

- 真实 SDK 集成：**1 项通过**。编辑文档、断连另存、重复打开／另存、临时副本原生媒体／工程删除、独立工程及媒体删除、再次打开冻结版本、inode／硬链接检查及原字节保留。
- 真实 HTTP/PostgreSQL 集成：**2 项通过**。包括完成态原业务写命令 409，缺 CSRF、错误 Origin、额外字段、跨 Owner、未完成及无核验交付拒绝；原数据／冻结文件保持。
- 组件、文档比较、真实 SDK 嵌入桥保存回执测试：**4 文件／10 项通过**。
- 权限反向检查：只在测试编译转换内将 authorize 条件故意改错，跨 Owner keep 因错误放行使测试**按预期失败**。未编辑产品源文件，测试能捕捉该边界失效。
- 类型检查通过。没有更改业务代码和 UI，因此未重复全仓测试、构建与浏览器视觉检查。
- 已完成真实生产单副本宽度 1080 → 720 → 放弃重开 1080；交付工程 SHA 一致。
- 新建本轮前后指纹：**55 组关联表、387 文件完全一致**；changedTables/changedFiles 均为空。验证完无遗留 OpenChatCut 子进程。

## 证据与范围

本地证据：`/Users/dan/.codex/visualizations/2026/11/16/01a1e3e1-f724-71a1-b7d7-6e7132f2b24a/studio-copy/reaudit/`。

包含 production/production-preservation.json、native-copy-result.json、测试日志及只在测试转换内生效的 mutation.config.mjs。所有破坏性删除验证都针对自建可丢弃夹具，未对真实生产单素材执行删除。真实两单用于只读来源验证与指纹比对。原有热更新、强制退出后的 temp 生命周期限制见 STUDIO-COPY.md；不影响本轮核验的原单／原素材隔离结论。
