# 制作目录读取生命周期统一验收

日期：2026-11-09。基线：`main / d2c02a37`。对应 ADR-0031。

## 结果与范围

新增 `useProductionServiceCatalog`，集中读取归属、请求序号、AbortController、focus、激活／显式刷新／重试、pending 和错误。四入口复用现有 `localRequest`；视觉 composer 与内嵌 Pexels 共用目录、错误和重试结果，显示与检索可用性使用同一快照。独立 Pexels 继续可用。

各入口保留媒体筛选、模型／声音／参数／正文／查询草稿。普通读取失败保留上次展示，上传不依赖目录；会话失效清除目录。client 在响应解析后、401／CSRF 副作用前遵守 AbortSignal，已取消请求的迟到 401 不登出当前归属。目录 group／services 及消费路径使用的 models／constraints 基础结构在接收 seam 校验；检测到结构错误或不支持的 search 组合时保留上次目录并提示重试。

没有新增跨入口缓存、TTL、后台轮询、状态库或后端端点。服务端逐次解析／确认及执行授权不变；不把目录或已验证凭据当成推理授权。未调用真实付费供应商、修改日常业务数据、重启日常服务或推送远端。

## 回归与证据

- 改前只读分析：4 文件 80 项通过，2 个问题特征探针确认父子目录不一致和目录 401 绕过登录失效。
- 本轮将上述两处改为失败回归，分别记录红灯及修复后绿灯。401 基线通过暂时恢复 Pexels 的 `d2c02a37` 实现验证，随后立即恢复本次实现。
- 新增非数据库回归 22 项：实际 hook＋client＋受控 HTTP 17 项，真实视觉／Pexels 输入 3 项，真实认证树 2 项。覆盖旧响应／错误／pending、scope 往返、active、卸载、同 Owner 重新登录、旧请求迟到 401、当前 401、跨标签页身份变化、畸形目录保留上次展示与草稿。
- 工作区阶段定向 8 文件 102 项通过；最后补充非法 search 两项红绿。待提交版本最终定向 8 文件 117 项通过，包含保留的旧视觉入口测试。
- 新增实际 hook＋localRequest＋真实 Owner HTTP／隔离 PostgreSQL 集成 1 项通过：连接登记／验证后刷新、轮换后 focus 读取新版本、不可执行事实、GET 不读取密钥、跨 Owner 隔离及当前 401 清目录。配合既有模型设置集成 2 项，共 3 项通过。该夹具只开放手动验证，不开放推理；测试明确保留「已验证但不可执行」状态。
- 既有 `connectionCatalog.integration.test.ts:11` 固定要求图片模型数组只有 `gpt-image-2`，实际注册目录还含其他既有模型，导致 1 项失败。用改前四个入口实现再次执行得到同一失败；未改动该测试或模型清单，也未将其算作通过。
- 新增 jsdom／Owner HTTP 夹具最初遇到临时 context 不在 Vite root、DOM／Node AbortSignal 品牌不兼容及把验证资格误当执行资格的问题。context 移入隔离源码，HTTP adapter 桥接原生取消信号并按真实授权语义断言后通过；未以修改产品授权规则解决夹具问题。
- `agent-browser` 隔离真实入口在 1280／640 宽度验证通过：focus 与重试各发一次共享请求、父子目录同步、查询和口播草稿保留、目录失败仍可准备上传音频、401 进入失效流程。操作命令 0 次，未触发检索或生成。驱动最初的可访问名称／select 命令／aria-label 定位问题已调整，未据此改动产品代码。
- 工作区 `npm run check`／`npm run build`／`npm run runtime:prepare` 通过；待提交版本以独立 TypeScript build info 检查通过。期间并行动效测试的一处临时类型错误已由该工作修复，本任务未修改该文件。保留既有大 chunk 提示及 jsdom 媒体／act 警告。

默认完整回归首轮：246 文件、1,769 项通过、3 项失败、1 项既有跳过。3 项失败来自两份旧夹具把工程响应也用于连接目录 GET；仅将该路径改为合法空目录，业务断言保持原样。工作区和待提交版本分别定向重跑两文件 40 项均通过。最终完整回归覆盖 247 文件：1,776 项通过、1 项导航用例 5 秒等待超时、1 项既有跳过。该文件保持原超时设置定向重跑 16 项全部通过，累计 1,777 项通过。前序任务亦记录过同一导航用例超时，未修改其逻辑或延长超时。并行任务在两轮之间新增 1 文件／5 项界面测试，因此最终总数增加；这些改动未纳入本次提交。

## Standards

初审指出目录结构校验不足，补充 group／service 及消费路径使用的字段校验；复核又指出非法 image/search、非 Pexels video/search 可绕过 models 校验，补两项失败／通过回归并拒绝这些组合。最终复核：0 项未解决，未报告其他 Fowler smell。私有索引 diff 空白检查通过。

## Spec

初审指出旧请求的迟到 401 可先于 hook 归属检查触发全局失效。client 已在登录／CSRF 副作用前检查取消信号，受控回归及当前 401 的真实认证树回归均通过。最终复核：0 项未解决。

## 并行工作与提交范围

保存了初始 HEAD、dirty patch、状态和原文件。工作区已有清理及并行动效不纳入提交。24 个非重叠初始 dirty 路径哈希／删除状态不变；`ProductionWorkspacePanel.tsx` 与 `SystemStatusDrawer.tsx` 在本轮外继续变化，本任务未修改这两份实现。画面与口播的待提交版本由基线只变换本次目录代码生成，并单独展开做类型／回归验证；工作区继续保留动效、CSS 导入和口播精简签名。计划只暂存本次前缀，保留其他任务的计划进度。

审查与验证使用私有 Git index，避免占用其他任务的共享暂存区。最终只提交本任务路径。保留的旧入口通过同一 Pexels 独立读取路径兼容验证，无恢复已删除界面的工作区改动。

原始证据：`/var/folders/6c/wzgq_5_n40lfd6c48djmqwf40000gn/T/loop-catalog-session-implementation-20261109-hya3yjp3`。最终隔离集成：`/private/tmp/loop-catalog-session-e2e-o0sWQB/evidence`。旧集成失败与改前基线：`/private/tmp/loop-catalog-session-e2e-sYOjht/evidence`、`/private/tmp/loop-catalog-session-e2e-r5fuP7/evidence`。所有数据库容器均已销毁；日志与截图保留。
