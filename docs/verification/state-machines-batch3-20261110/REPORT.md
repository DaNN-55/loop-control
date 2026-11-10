# 导出与交付下一步判断

日期：2026-11-10。本批初始 HEAD `491a123a`。期间另一会话完成视觉提交 `951a368e`，不属于本批，原样保留；本批未暂存、提交或推送。

## 改动

新增 [workspaceExportDeliveryState](../../../src/workspaceExportDelivery.ts)，两个现有组件消费同一个纯判断结果，集中状态标题、下一步／空预览提示、主操作标签、可见性和禁用原因。禁用原因是内部标识，界面沿用原文案和组件。产品差异为一个新模块及两个组件，另有三个相关测试文件。

总览继续从所有交付记录识别完成／验证，交付区继续使用最新记录；没有按当前导出过滤历史。历史已验证交付在导出过期时仍可下载原文件；最新失败交付仍按原 ID 重试，不新增标题、封面或检查条件。准备期间继续编辑文案的原行为保持。草稿、2500ms 读取保护、错误、命令参数及服务端 SHA／版本校验未改。没有 SQL、依赖、CSS、服务端或供应商修改。决定见 [ADR-0035](../../adr/0035-export-delivery-next-step.md)。

## 验证

| 检查 | 结果 |
| --- | --- |
| 先固定历史行为 | 新增两个真实组件兼容用例，提取前即通过；原组件文件 8/8，见 [history-baseline.log](history-baseline.log)。没有把历史组合当作线上缺陷。 |
| 公开纯入口 | 模块不存在时先失败，见 [selector-red.log](selector-red.log)；实现后通过。状态表覆盖无导出、检查／问题、当前／旧／stale、确认、各交付阶段及活动禁用条件。 |
| 定向 | 5 文件／94 条通过，见 [targeted.log](targeted.log)。包含真实组件、既有交付读取和主工作区回归。 |
| 类型与构建 | 类型检查、前端构建、随后顺序后端构建通过，见 [check-matrix.log](check-matrix.log)、[build.log](build.log)、[backend-build.log](backend-build.log)。交付测试夹具补齐真实协议必需的 status/checks，没有增加运行时防御。 |
| 全量 | 仅运行一次：253 文件、1878 条通过、1 条跳过，见 [full-tests.log](full-tests.log)。 |
| 差异 | [精确差异](batch.diff)以本批工作区快照生成；PLAN 仅包含本批段落，排除并行会话内容。差异及反向应用检查通过。 |

## 浏览器

独立 Chrome、loopback `5192`、真实导出／交付组件与正式基础样式，HTTP 由隔离夹具提供，不连接业务库或代理供应商。

- 13 种状态的总览、最新交付、按钮和历史限制通过；状态检查没有发命令。见 [browser-matrix.json](browser-matrix.json)、[复用脚本](browser-matrix.js)。
- 历史 MP4 实际 HTTP 正文 SHA 与链接一致，1700 字节；ZIP 绑定原 `verified-history`，1137 字节。样本为本轮生成的 160×90／0.4 秒视频，见 [media-probe.json](media-probe.json)，不代表用户生产成片。
- 1280px／390px 核对；窄屏文档宽度为 390px。截图：[桌面历史](history-desktop.png)、[窄屏历史](history-mobile.png)、[交付准备](preparation-mobile.png)。
- 导出 → 确认 → 准备交付 → 原交付重试通过。确认／准备绑定同一 export ID 与文件／内容 SHA；重复准备只发一次；重试时标题和封面为空仍使用原 ID。见 [browser-actions.json](browser-actions.json)。
- 初次动作检查早于 React 状态收敛而失败，见 [browser-actions-initial.json](browser-actions-initial.json)。改为等待可见状态后重验动作链通过，未修改产品代码，未重复已通过的 13 状态检查。

没有运行 PostgreSQL／真实 Owner HTTP 集成，没有真实渲染生产成片、供应商调用或正式业务写入。隔离接口不能替代数据库与真实生产验收；截图未独立验收另一会话新增视觉层。

## Standards

独立只读规范审查：0 项硬违规，0 项值得报告的 possible smell。共享入口有两个真实调用，复用现有类型，无新增通用状态框架。

## Spec

独立只读范围审查：0 项发现。历史存在性与最新记录、过期下载、准备中编辑、原重试资格及读取／草稿／命令参数均与基线等价。

## 收尾

[保护清单](protected-files.json)核验 53 个先前变更文件，52 个字节保持；视觉 CSS 被另一会话更新并独立提交于 `951a368e`，保留且排除本批。该提交未包含本批 PLAN 段落。浏览器、5192 预览及本轮临时缓存已关闭／清理；日常 5174 原进程保留、首页 HTTP 200。本批未更新日常运行包、重启、暂存、提交或推送。
