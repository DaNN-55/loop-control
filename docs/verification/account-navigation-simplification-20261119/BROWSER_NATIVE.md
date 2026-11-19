# 独立剪辑隔离浏览器验证

结果：通过。阶段：export through the native MP4 workflow and inspect the actual file。

- 已验证：新安装先初始化私有媒体根，配置已切换到明确选择的位置
- 已验证：零账号时左下独立剪辑打开独立新标签页原生工程首页
- 已验证：原生新工程上传并加入真实5秒MP4
- 已验证：原生刀片工具把时间线实际切成两段
- 已验证：返回工程库、刷新后重开同一工程，自动保存的两段时间线仍在
- 已验证：原生实际MP4导出，ffprobe确认视频流与约5秒时长；仍无账号/生产单

证据目录：/Users/dan/Programs/loop-control/.scratch/account-navigation-20261119/worktree/.scratch/account-navigation-verification/runs/2026-11-19T08-46-39-312Z-95ff658e/native

未调用付费生成，未读取日常 deployment 或 Keychain 秘密。

## 实际文件与接续记录

实际 SDK 导出为 H.264、1920×1080、30fps，MP4 3,072,780 字节、时长 5.077333 秒；ffprobe.json 保存完整探测结果。上传文件从浏览器同源 HTTP 读回为 200 video/mp4、546,798 字节，SHA256 与原始 5 秒文件一致。明确素材菜单添加、原生刀片两段、自动保存后返回工程库刷新重开、原生导出全部由真实 UI 完成。全过程仍为零内容账号/生产单。

前一轮 08-43-42 自动脚本因错误限定 video[poster] 而暂停；保持同一私有会话后发现实际为 img 媒体海报，现场继续完成添加、切分、保存重开和实际导出，证据见该轮 native/manual-continuation.json。修正脚本支持真实 img/video 结构并使用已观察的明确素材菜单后，最终完整自动复跑两项全部通过，没有将暂停轮的自动结果冒充通过。

已保留原始 SDK stdout/stderr：冷启动仍出现一条 /@fs/src/main.tsx 预转换消息及导航取消派生媒体请求的日志；后续首页、媒体读取与全部导出断言通过。本次没有将“控制台零消息”列为通过项。Safari、实体触屏和屏幕阅读器未测试。

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
