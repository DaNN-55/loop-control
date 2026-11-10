# MiniMax 视频失败与错误展示修复（2026-11-09）

本地运行版本：`2b293cef289c`。没有新增付费调用、生成任务或数据库迁移，未提交／推送。原有无关未提交修改与本轮开始时备份一致。

## 原任务的具体原因

任务 `c6cc2b02-5f40-4c28-82af-75e4b8107d16` 使用 MiniMax-H3，实际冻结时长 4 秒，模式为 `references`，画面角色为 `reference_image`，输入图片约 1.72 MB。本机网络边界 `officialVideoOperation` 仍要求首帧角色 `first_frame`，在调用 transport 之前抛出 `Invalid video body`。

用原冻结模式、提示词和时长重建最小请求（图像字节用替身，不发送真实素材），调用当时固定版本 `4b3b769585c6`：参考图角色失败，仅把同一请求的角色改成首帧即可通过。整个复现没有网络调用，详见 diagnosis.json。因此此条任务是本机拦截，不能继续按「供应商结果未知」解释。

任务费用预留和提交开始标记先于网络边界校验登记，导致界面误判。原任务错误还被 `executeNativeMedia` 的通用包装覆盖，丢失了具体原因。

## 修复

- 网络校验复用已登记的视频生成模式及同一请求序列化逻辑，支持合法首帧、首尾帧与参考素材，继续拒绝未登记字段、非法来源、数量、类型和大小；没有扩大供应商端点范围。
- 视频诊断保留 HTTP 状态、供应商错误码、错误说明和请求编号；屏蔽真实凭据、内联媒体和带签名 URL，不回显原始 HTML。底层异常作为 cause 保留，任务结果只展示可安全输出的说明。
- 明确区分本机未发送、供应商明确拒绝、发送后结果未知和已受理任务的查询／下载失败。未知情况保持 blocked 且禁止自动重试；已有任务只能恢复原查询和下载。
- 原任务在比对状态和冻结参数后，补充 `VIDEO_REQUEST_NOT_SENT` 诊断及审计事件。原结果保存在审计及私有恢复副本，任务未重新排队，¥2.40 费用预留记录保留。提交账本已有的 rejected 桶表示该次提交无需继续等待；界面依据诊断显示「未提交」，不会声称供应商拒绝了这一笔。
- 页面采用紧凑状态条，桌面实测高度 54 px。点击「详情」在居中弹窗查看原因、连接／模型、时间、原任务和费用；Esc 关闭后恢复按钮焦点。核对、刷新、原任务恢复等动作按状态提供，未放宽付费确认。

错误协议参照 [MiniMax 创建任务文档](https://platform.minimax.io/docs/api-reference/video-generation-v2-create) 和 [查询任务文档](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)，同时保留旧版 base_resp 错误响应兼容。

## 验证

- 全量单元测试：250 个文件、1,812 项通过、1 项跳过。并行高负载时曾触发已有搜索用例的时间边界，定向复跑及最终较低并发全量均通过，没有修改搜索实现。
- Owner HTTP＋真实隔离 PostgreSQL＋Worker：参考图请求成功、HTTP 402 拒绝、本机未发送、连接中断四种路径均通过。生成成功路径使用真实 MP4 测试文件；只有供应商传输和凭据存储由受控替身提供。
- 四家视频原任务下载恢复：单次 POST、原编号查询、产物验证通过；任务编号保存权限失败后仍禁止重复提交。新增明确未知视频异常统一显示 blocked；对应历史测试期望已同步，实际重复防护仍通过。
- `npm run check`、构建、运行产物准备及 `git diff --check` 通过。
- 当前登录页面实测 1427×953 和 640×800；无页面横向溢出，弹窗控件未越界，Esc 返回焦点正常，视口已恢复。原任务显示真实原因，生成按钮恢复可用。截图见 compact-actual.png 和 details-640.png。

本轮未重新运行真实 MiniMax 在线生成；不会把受控响应冒充供应商在线成功证明。

## 检查方法

刷新原生产单，查看「视频未提交」的原因；点击「详情」查看完整记录，再按 Esc 返回。需要重新生成时，可点击「生成视频」并核对模型、参考图、时长及费用后确认。系统不会自动重发旧请求。

回归：

```sh
npm test -- --maxWorkers=2
node docs/verification/first-batch-experience-20261109/runner.mjs src/local-app/minimaxFailure.integration.test.ts src/local-app/videoTaskExecution.integration.test.ts
```

第二条创建独立临时数据库并使用受控响应，不调用真实付费供应商。日志摘要见 verification.txt；原任务修正后记录见 runtime.json。
