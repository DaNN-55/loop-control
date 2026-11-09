# 视频执行恢复与下载协议集中管理验收

日期：2026-11-09。基线：`8fd6d8a07378375fbdcd9dd57391a89277b1c3b1`。Owner 批准第四项方案，决策见 [ADR-0029](../../adr/0029-video-task-execution.md)。

新增 `videoTaskExecution`，Wan 与 Official 生成入口共用预留分流、任务 ID 校验及登记前置、轮询、进度与下载机制。供应商继续拥有输入／凭据校验、请求体、状态解释、endpoint、下载域名、等待节奏和错误文本。共同类型移至新 module，Wan 的旧类型兼容导出及 `reserveWan`／`recordWanSubmission` 等字段保持。

`providerNetwork` 的实现未修改：在线拒绝 3xx、严格检查声明长度、绑定原任务及授权，并保持原有缓冲和 Response 重建。新 module 只使用传入的受控 fetcher；其可透传路径保持逐跳 URL 校验、最多四次请求、60 秒 signal、100×1024² 字节上限、MP4 MIME／空流检查和 reader 释放。没有改变账务、租约、submission 记录或原生产物发布恢复，也未增加队列、迁移或依赖。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 下载行为改前基线 | 新增四家相对重定向契约与既有供应商用例共 27 项通过，再集中下载 |
| 共同生命周期 | 原实现固定登记／轮询／等待／进度顺序；当前相关 5 文件 122 项通过，含 84 项执行契约 |
| 实际网络 adapter | 新增 12 项与既有 44 项网络测试及执行契约共 140 项通过；覆盖在线 3xx、严格长度、任务绑定、过期新提交授权下原任务续查和更短 policy 超时 |
| 改前源码对照 | 在隔离副本恢复原 Wan／Official 两个实现，8 文件 184 项通过，包含新增六项真实 Worker 集成 |
| 新增真实集成 | 四家下载失败后重启恢复、两条路径 ID 登记权限失败，共 6 项通过 |
| 扩大隔离集成 | 10 文件 50 项全部通过，无跳过；含新增六项及既有候选、未知提交／续查、确认、图片、声音和原生保存 |
| 类型／构建 | 定期 `npm run check`、前端构建、后端／Worker 构建及最终 `runtime:prepare` 均通过 |
| 默认完整回归 | 完整运行 1 轮、239 文件：1,728 项通过、1 项页面等待超时、1 项既有跳过；超时所在文件定向 16 项全部通过，原失败项通过，累计 1,729 项通过 |

默认首轮的 `LocalCatalogApp.navigation.test.tsx` 用例 `ignores an older catalog response after browser Back restores the original query` 超出 5,000 ms。隔离任务及构建已在首轮前结束；随后使用相同源码、相同超时设置定向复跑该文件 16 项全部通过。只记录为页面等待时序不稳定，未修改无关前端或用例，也不将首轮记为全绿。原始结果见 `default-vitest.json`、`default-retry-vitest.json`；`default-summary.json` 按用例核对了原失败项通过。

执行契约通过现有 `generateWanVideo`／`generateOfficialVideo` 入口及受控外部响应，未 mock 新 module。覆盖未知预留、无效任务 ID、登记失败后零查询、原始异常透传、查询或下载失败不重发、超过 60 次轮询、供应商等待节奏与进度；下载覆盖逐跳越权、次数边界、头部超限、流超限、空流、读取失败及取消失败不覆盖原错误。

网络用例通过实际 `createWorkspaceGenerationFetcher`／`createVideoContinuationFetcher` 与受控 transport，区分可透传下载和在线限制。测试私有 policy／ledger 使用自有临时目录，不读取日常授权、秘密或网络账本。

集成通过真实 Owner HTTP、隔离 PostgreSQL、实际 Worker 及版本化 MP4。四家均在供应商 ID 登记后让下载真实失败，再重启 Owner／Worker 并恢复：原 ID、冻结输入、预留保持；POST 一次、查询两次，恢复后候选及真实字节可读取，完成任务不能再次恢复。两条路径撤销 Worker 登记函数的 EXECUTE 权限，验证供应商返回 ID 后即中止，不查询／下载，旧预留无 ID 保持未知提交，重试及修改描述均不能绕过。所用 MP4 经过现有 ffprobe 校验，不将 MIME 检查或时长探测描述为完整解码。

## Standards

0 项问题。共享 module 封装预留、任务登记、轮询和下载顺序；供应商保留输入校验、鉴权、响应解释与错误文本，职责及 interface 粒度合理。原错误传播、网络限制、旧类型兼容导出和调用字段均保留，未发现硬标准违规或需处理的 Fowler smell。审查只读检查固定暂存快照，未运行测试、启动服务或修改文件。

## Spec

0 项问题。预留分流、登记前置、原 ID 恢复、异常透传、默认持续轮询和下载限制符合批准规格；没有绕过受控 fetcher 或迁移账务、发布逻辑。新增用例经真实入口及 Owner／Worker／SQL 验证单次 POST、冻结输入和预留保持、产物单次登记。审查只读检查固定暂存快照，未运行测试、启动服务或修改文件。

原始状态、补丁、逐项日志、构建与隔离执行入口位于仓库外 `/var/folders/6c/wzgq_5_n40lfd6c48djmqwf40000gn/T/loop-video-task-implementation-20261109-3kmqhh9x/`。各执行日志首行记录独立证据目录。自有容器使用无网络、无持久卷实例；三轮隔离容器及复制源码／SDK 已释放；`integration-summary.json` 保存结果、清理状态及改前实现／最终生产源码核对。

没有调用真实付费供应商、改写日常业务数据或重启日常服务。既有工作区清理改动保持原样；仅暂存、提交本任务，不推送。未测量生成速度、费用或内存改善。
