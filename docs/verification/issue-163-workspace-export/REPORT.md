# #163 / T11 验证记录

已实现先导出真实最终 MP4、检查后绑定精确文件的一次 Owner 确认。历史 QC/renderer 保留，新工程不伪造逐镜批准；本票不生成发布包或提前完成 Episode。

## 已验证

- TDD：缺少 093/命令入口、缺少检查 UI、最终文件未接入 Owner 文件映射均先出现红灯；随后在相同公共 seam 修正。
- 随机隔离 PostgreSQL、媒体根、Owner HTTP 和真实 native render：占位阻塞保存诊断、必要字幕缺失阻塞、补齐素材/显式关闭字幕后导出；嵌套 sequence 实际渲染；未用且缺失的 pool 项不阻止 save/reopen/export。
- 实际最终视频先生成，文件 SHA/大小与检查证据持久化后才可确认。错误 hash、旧导出确认、内容编辑后旧批准、MP4 篡改被拒绝；无变化/selection-only save 保留批准；重启保留记录；问题与失败重试保留。
- Owner 文件 HTTP：返回字节 SHA 与记录一致、Range 206、其他 Owner 404，复用既有文件边界。
- 真实 ffprobe、ffmpeg 解码代表帧已执行并读取。视频流时长与 container 时长分别记录，不能把 AAC 尾部填充解释为视觉时长变化。
- 受影响 UI/renderer 测试、TypeScript check、backend build 与完整 build 通过；Vite 仍报告既有大 chunk 提示。

可复现命令：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
LOOP_T11_EVIDENCE_DIR=/private/tmp/t11-export-evidence \
./node_modules/.bin/vitest run src/local-app/workspaceExport.integration.test.ts
```

原始证据位于 `/private/tmp/t11-export-evidence/`：`final.mp4`、`representative.jpg`、`workspace.json`，以及检查/确认页截图。测试中的数据库和媒体夹具在结束后清理；此证据副本单独保留。独立 UI driver 为同目录 `serve.ts`，输出随机 origin、临时 Owner 和唯一进程 PID，只能终止自己输出的 PID。

## 浏览器验证

专用 driver 创建随机 Owner、数据库、媒体根和端口。真实浏览器从正式生产单进入检查页，按「最终导出视频」标签读取了可见视频，实际解码 1080×1920，readyState=4，container duration=4.053333 秒；点击播放与精确确认成功。不能查询页面第一个 video 代替最终文件，历史区域仍可能挂载隐藏预览。

800 px viewport 的 document scrollWidth=800，无页面横向溢出。已保存 `check-page.png`、`confirmed-page.png`、`check-page-800.png`；本次只验证检查页，整期 Host 与完整响应式验收由主 Agent 负责。初轮浏览器发现新 export 表未进入 Owner 文件读取，已补文件映射并通过实际字节 hash/Range/foreign Owner 回归。

## 范围与后续

本机导出不使用付费 Provider，不读取 Keychain，不写日常数据库，不运行日常 start/migrate/stop。真实公开 Provider、T12 包校验及 `production_completed`、T13 四步默认入口、T08/T10 Host 结构交互由相应票验收。本票最终还需在 T05 最终 shot 口播与最新 integration 合入后使用全新夹具复验；以本报告后续补记为准。
