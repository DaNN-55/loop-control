# 正式界面隔离浏览器验证

结果：通过。阶段：verify responsive layout and keyboard access。

- 已验证：新安装先初始化私有媒体根，配置已切换到明确选择的位置
- 已验证：只填名称创建账号，自动稳定标识、上海时区和真实账号目录
- 已验证：创建账号后直接继续新建真实生产单
- 已验证：四类选填规则普通保存；旧生产单保持冻结版本
- 已验证：设置仅五个主分组，深色偏好保存并刷新保留
- 已验证：文件存储默认只显示当前路径与操作，迁移表单收起
- 已验证：显示统计可明确展开与收起花费、后台用时、生成次数
- 已验证：统一生产单列表有默认预览、显式搜索、按需筛选和回收站入口
- 已验证：390px点行打开原生预览dialog，Escape关闭并返回可达焦点
- 已验证：1440/390/320px页面无横向溢出，键盘Tab可聚焦控件

证据目录：/Users/dan/Programs/loop-control/.scratch/account-navigation-20261119/worktree/.scratch/account-navigation-verification/runs/2026-11-19T08-46-39-312Z-95ff658e/app

未调用付费生成，未读取日常 deployment 或 Keychain 秘密。本报告不包含原生剪辑导出；参见 BROWSER_NATIVE.md。

正式入口复验补充：统计展开/收起、390px行预览原生 dialog、Escape 关闭及可达焦点恢复均通过；1440/390/320px未见横向溢出。最终三张视觉证据为 app/app-1440.png、app/settings-1440.png、app/preview-390.png。

## 复验方式与隔离边界

原本地临时 runner 及隔离工作树已按用户后续授权清理；最终必要证据已归档至 `.loop-control/local/activation-recovery/account-navigation-20261119/acceptance/isolated/`。以下为当时的复验命令，不表示现在仍可直接执行：

```sh
node .scratch/account-navigation-verification/run-isolated.mjs --phase app
node .scratch/account-navigation-verification/run-isolated.mjs --phase native
# 同一轮完整验收
node .scratch/account-navigation-verification/run-isolated.mjs --phase all
```

依赖 Node 24、已准备且固定的 runtime、PostgreSQL 17、agent-browser/Chrome、ffmpeg/ffprobe、macOS hdiutil，以及指定位置的 SDK 源码和已安装依赖。新 checkout 需要根据 scripts/e2e/t12.mjs 的同类私有集群模板重建该本地 runner，不能直接使用日常 deployment。集成测试默认跳过；只有 runner 同时提供显式开关、私有 native context、SDK 副本和独立 session 才启用。

fixture 的 native startup 会绑定有效默认目录；本用例仅在私有数据库中移除第二合成 Owner 凭据及已有绑定，以明确覆盖“首次尚未绑定存储”分支，不 mock 存储 API。技术 state/program cache 放 runner 私有临时目录，制作媒体仍在独立 APFS 盘；修正了 256MB fixture 同时承载技术冷缓存导致的 ENOSPC 干扰。正式页面直接导入 src/local-app/main.tsx，完整包含 StrictMode 与全部正式 CSS。

## 最终执行与清理

最终完整运行：`.scratch/account-navigation-verification/runs/2026-11-19T08-46-39-312Z-95ff658e`。2 项通过、0 失败，45.60 秒。run.json 确认两条浏览器 session 已关闭、私有 PG17 已停止且状态复核无残留、私有挂载已核验、runner 临时根已移除、cleanupErrors 为空。另已核对内容与所有权后移除仅本任务遗留的 2 个临时 TSX 入口；记录见 task-entry-cleanup.json。视频、截图与原始日志保留在该 ignored 证据目录。未读取日常 deployment、Keychain 秘密，未调用付费生成。

收尾：旧工作树及临时视频已清理，最终结果、必要截图与 ffprobe 保留在上述归档；完整清单见恢复目录中的 `cleanup-manifest.json`。
