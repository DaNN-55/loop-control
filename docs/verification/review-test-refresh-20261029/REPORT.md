# 审核台四项失败排查

2026-10-29，范围为 `src/reviews/ReviewWorkspace.test.tsx` 中四个失败场景，不修改真实生产单。

## 原始复现

`npx vitest run src/reviews/ReviewWorkspace.test.tsx --reporter=json`：68 通过、4 失败；与上一轮结果相同。

## 分类与依据

| 场景 | 根因 | 调整与保留的行为验证 |
| --- | --- | --- |
| 同步预览与字幕修改 | 测试仍要求 QC 阶段的“新增镜头”禁用；ADR-0014 已允许从已批准分镜到 QC 阶段提出结构修订 | 改为允许修订；保留字幕修改使当前确认和代理过期、保存后回到预览、QC 证据保留等断言 |
| 失败/缺原片/旧合同 | 提示精简为“旧版镜头记录，请重新保存草稿并确认同步预览。”，旧断言仍含“这是” | 匹配当前提示，并检查旧合同禁止生成代理；保留确认计数归零、不能显示 Owner 已确认、允许回编辑 |
| 删除镜头切换新版 | 删除操作已有专用“确认删除镜头”按钮，测试仍匹配通用修订按钮 | 使用专用确认入口；保留提交理由和删除操作、后台应用及新版 hash 指向下一镜 |
| 合成前冻结 | ADR-0014 已移除独立预渲染人工审核，旧测试仍要求显示旧审核包标题及旧说明 | 检查六步流程将此阶段归入合成与 QC、不标人工待审、不出现逐成员审批、无人工状态迁移回调 |

上述四处均为测试预期未同步，未发现需要恢复旧功能的依据。冻结成员和指纹仍是内部契约，不恢复独立预渲染审核页面或伪造审批。

依据：[ADR-0014](../../adr/0014-production-reconfirmation-and-six-step-workflow.md)、`EpisodeProduction.tsx` 中结构修订阶段围栏、旧合同预览围栏及六步流程；`reviewSelectors.ts` 中内部冻结包不计入人工待审。

## 并行改版引起的定位调整

首次定向重跑遇到 C 版接入新增 CSS import 已加入但文件尚未落盘，未将其当作原四项故障。依赖完整后，步骤序号和工程路径 title 也已移除；测试改用语义标签与可见路径定位。

扩大到节点回归发现一项还在断言旧“OpenChatCut 审核视频”整期编辑区域及 B 版“编辑声音与字幕/返回概览”入口。C 版已明确移除该重复区域，改为直接的“声音与字幕/原片与构图”标签；同步对应测试，保留生成动作、删除前确认、带原因排序和不原地修改已批准分镜的检查。未修改并行 C 版功能代码或回退其他改动。

## 验证

- 审核台 `ReviewWorkspace.test.tsx`：72/72 通过，原四项均通过。
- 节点界面 `ProductionNodes.test.tsx`：17/17 通过。
- `reviewSelectors.test.ts`、`storyboardRevision.test.ts`、`shotAcceptance.test.ts`、`shotCaptions.test.ts`：16/16 通过。
- 合计 105 项通过。未以移除或跳过原场景换取通过；保留旧合同阻塞、代理失效、版本切换与人工审批边界断言。
- `npm run check` 通过。
- `npx vite build --outDir /private/tmp/loop-review-test-build-20261029` 通过，保留已有大 chunk 提示；未覆盖正在运行的后端构建或重启服务。
- 浏览器打开独立只读标签页时返回登录页，未继续真实业务操作；本次仅修改测试，未改产品界面/业务实现或真实生产单。临时标签页已关闭。

证据：[原始失败](before.json)、[审核台通过](review-after.json)、[节点通过](nodes-after.json)、[契约通过](contracts-after.json)、[类型检查](check.log)、[构建](build.log)。
