# #164 / T12 验收记录

本票实现了已确认 MP4、导出时完整可编辑工程、封面、元数据、检查证据与 v2 清单的真实交付。只有独立 Worker 完整验证并持久报告后，Episode 才进入 `production_completed`。没有再次渲染、外部发布或付费调用。

## 实现与边界

- 代码基于 integration `a7c4d3a2`（含最终 T11/T05），完成前合入 `91dfeb36`。未修改 Host/bridge、T11 导出实现或 PLAN/state。
- v1 历史四类包继续由原测试验证；v2 生产者和验证器共同要求完整工程。选择保存保留确认时，包工程仍引用导出时不可变文件。
- 交付状态与实际 `tasks/task_runs/last_result`、文件索引、transition/audit 在真实数据库一致提交。失败追加任务，保留原输入、视频身份与旧文件；不同导出无法借重试替换。
- 已用 TTS 来源正文来自不可变任务；T08 adopted-text 优先分支已按最终 SHA/fingerprint 契约接入，当前本票隔离库未含 090，须在最终跨票集成复验 owner_adoption 分支。

## 已执行验证

| 边界 | 结果 |
| --- | --- |
| Owner 未确认/错误视频 SHA/缺封面 | 拒绝，未生成完成记录 |
| 原生 selection-only 保存 | 当前工程 SHA 改变，内容版本与确认保留，包仍引用原导出工程 |
| 真 Worker CLI 子进程 + 随机 PG | 原 claimant、lease、task_run、生产打包代码和结果 RPC 实际执行 |
| MP4 篡改、不可变工程丢失、封面丢失 | 任务持久失败，未生产完成；恢复原字节后可新任务重试 |
| 不同 exportId / 晚到 Worker | 旧包失败，旧交付不能重试到新视频；新导出需重新确认 |
| 六类实际文件 | Owner HTTP 下载成功且 SHA 相符，其他 Owner 404；重启后 verified 可读 |
| 完成后 metadata 丢失 | 刷新显示 verified=false 与文件错误，保留历史结果 |
| 实际受控 TTS + 原生裁切 + 新 draft | 已用旧任务 sourceText 保留；12 帧源入点、2 秒覆盖，adoptedText=null，不用未采用新正文冒充实际说词 |
| 浏览器 | 独立会话检查真实完成数据、上传/输入和六文件入口；800px scrollWidth=800；实际 MP4 readyState=4，工程入口可读 JSON |
| 构建与回归 | check、backend:build、worker:build、build；v1 publishing、ExportPanel、ProductionWorkspacePanel、workerDatabase；T11 真实导出兼容 |

最终受影响回归 10/10 通过（T12 4 条真实链和 v1/UI/Worker 6 条）；T11 真实回归另轮通过 1/1。最终正式主题浏览器使用全新 session 与根路径 Cookie，等待 MP4 readyState=4 后截图。

测试入口为 `src/local-app/workspaceDelivery.integration.test.ts` 和 `workspaceExport.integration.test.ts`。新测试先观察真实 HTTP 拒绝/失败，再沿同一公共边界推进实现。遇到两个 PL/pgSQL 变量/表别名歧义时统一改成明确 JSON alias，未通过伪任务绕过。

```sh
npm run runtime:prepare
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
node_modules/.bin/vitest run src/local-app/workspaceDelivery.integration.test.ts src/local-app/workspaceExport.integration.test.ts
```

## 证据与限制

`publish_package.json/worker-result.json/workspace.json` 为真实成功链的不可变快照；`final.mp4/editable_project.json/cover.png/metadata.json/final_qc_report.json` 是对应文件副本。原清单中的 Episode 路径保持原值；隔离数据库与媒体按 fixture finally 清理，证据副本不能冒充仍在运行的下载服务。

`trimmed-voice-metadata.json` 为另一轮真实受控口播和最终交付的元数据。截图记录交付表单与完成态；准备表单浏览器操作只验控件和按钮启用，生产动作另由真实 HTTP 测试执行，未将浏览器夹具回调当作后台成功。正式主题复验发现文件 input 固有宽度使 800px 视图溢出 22px；局部设置 grid minmax(0,1fr) 与 input min-width:0 后，实际 scrollWidth=800、封面控件右边界 747。最终截图已使用正式主题。

受控 Provider 返回已知本地音频，不证明在线付费 TTS 质量或逐字内容；裁切正文只声明来源和覆盖未知。UI 800/1280 验证不是整票 #152 的正式默认入口/完整跨票验收。设计检测仅报告原 CSS 已存在颜色/字号 advisory，未扩大本票修订设计系统；Impeccable sidecar 过期也保持原状。
