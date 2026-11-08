# GPT Image 2.5 接入验收

2026-11-08。用户明确确认沿用现有连接和密钥，并删除“画面候选 / 数量”标题行。

## 已接入

- `gpt-image-2.5-sunburst`
- `gpt-image-2.5-flare`
- `gpt-image-2.5-sunburst-2026-09-08`
- `gpt-image-2.5-flare-2026-09-08`

保留 `gpt-image-2`、当前连接 `gpt-image2` 的 v1、原密钥引用及旧任务快照。该连接未设置显式模型限制，按现有 ADR-0020 的全部注册模型默认值，四个新模型直接可选；未新建连接或写入密钥。

注册信息、服务目录按模型约束、前后端参数校验、网络请求白名单、Worker 生成/参考图编辑链路均已覆盖。2.5 提供自动、低、中、高、超高、最高质量；GPT Image 2 保留原质量档位。输出仍为现有 PNG，保留已有尺寸、1/2/4 张、参考图、费用确认及手动采用流程。

官方明确指出 GPT Image 2 计算器不能估算 2.5 token 消耗，因此 2.5 不展示旧计算器估价，在现有确认窗中要求手动填写本次费用预留；不增加额外审批步骤。显示 Standard 文本/图片输入/图片输出每百万 token $5/$8/$30，实际费用以供应商结算为准。

删除冗余标题与数量行；候选预览、缩略图、更多操作和旧布局中仍需要的本期素材导入入口保留。

## 验证

- 9 个单元/组件文件，168 项通过：供应商请求、网络白名单、费用估算与手动预留、模型切换、旧参数保留、分镜台及候选操作等。
- 4 项隔离集成通过：原 GPT Image 2 HTTP/Worker 回归 1 项，四个 2.5 型号完整链路 1 项，连接目录/启用范围/版本并发 2 项。
- 新型号链路实际经过 Owner HTTP 确认、隔离 PostgreSQL 队列及真实 Worker 子进程，核对 task.model 和 executor.model 精确一致，xhigh/max 原样冻结；交替覆盖生成与参考图编辑，PNG 产物正常，工程未自动采用。供应商传输为受控模拟，不使用真实密钥生成。
- 现有密钥真实只读 GET 模型目录成功：96 个模型，四个 2.5 ID 全部在列，见 `provider-directory.json`。目录可读不等于已做真实生成验收。
- `npm run check`、`npm run build`、`npm run runtime:prepare` 通过。保留已有大包提示、媒体组件 act 警告与 pg 查询弃用提示。
- 正式 5174 逐个选择四个型号并核对六档质量，恢复原 GPT Image 2 选择；1543×953 与 1152×790 检查长模型名、344px 规格弹层、32px 工具栏、标题移除。无页面横向溢出，未点击生成、采用或保存，测试弹层已关闭、临时 viewport override 已清除。

## 数据库和日常更新

新增 `152-gpt-image-25-models.sql` 对当前已部署函数作有前置检查的精确扩展：队列允许五个已注册模型并按实际冻结型号创建任务，命名触发器核对任务型号与执行快照一致；保留原确认、预算退役、未知结果重试与存储命名逻辑。旧迁移未改动。

迁移前已确认无 ready/running 任务或 Studio 子进程。建立并通过 pg_restore 目录读取的数据库备份：

`/Users/dan/Programs/loop-control/.loop-control/local/backups/20261108-gpt-image-25/before-152.dump`

备份为 3,710,323 字节，SHA-256 `09a128fbbbb017cad9defec9ca6b3a6c1820a7b1cbd9479af0d925300b5ae6ef`，同目录保留迁移前两份函数定义。迁移 CLI 使用已建立的数据库备份，不重复全量媒体备份；Owner 原设置为自动备份关闭。

日常版本从 `a71e0153e38e` 更新为 `8fff5e88ec3c`。运行发布物与准备产物一致，后端源差异仅本次 8 个文件，旧发布物保留。更新前后素材、音轨、任务、候选、音频准备、连接版本与密钥绑定的数量和完整行指纹相同。

工作工程在最初盘点之后、备份之前已有一次变化（更新时间 11:50:50），未回滚这项同期编辑。将迁移前备份里的 3 个工程读入临时表，与更新后当前表做双向全行比较，全部相同，见 `workspace-full-comparison.json`；包括当时已经存在的第一镜占位状态。

## 来源与证据

- [Sunburst 官方模型说明](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [Flare 官方模型说明](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [生成参数](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [编辑参数](https://developers.openai.com/api/reference/resources/images/methods/edit)

模型与配置截图：`model-menu.jpg`、`model-settings.jpg`、`narrow.jpg`。运行与数据记录：`backup.json`、`runtime-releases.json`、`runtime-diff.json`、`daily-before.json`、`daily-after.json`、`workspace-full-comparison.json`、`browser-checks.json`。

修改前本次相关源码保存在当前聊天可视化目录的 `gpt-image-25-baseline/`。未提交、推送或清理其他未提交工作；未发起真实付费生成。
