# 原型对齐第二轮验收 · 2026-10-28

已完成用户确认的12项清单。右侧打开真实5174工作台，保持未提交；起点HEAD仍为30f3361bbe0d80be73bac7684ad22c2e20059d09。原有未提交工作保留。

## 逐项结果

| 项 | 结果 | 证据 |
|---|---|---|
| 1 列宽 | 第一列最大320px；1280px视口五列为320 / 307 / 112 / 126 / 36px，时间单行 | real-list.png、browser-checks.json |
| 2 状态识别 | 阶段为中性文本，行动状态为语义图标与文字；绿完成、琥珀待审、蓝制作、红需处理、中性准备。删除浅色且错配的图例 | real-list.png、fixture-list-dark.png |
| 3 连接列表位置 | 已保存列表放到编辑器及版本区后 | real-connections.png |
| 4 双箭头 | 采用选择器清除旧背景图，只绘制组件chevron | 真实select backgroundImage=none |
| 5 表单边界 | 连接文字标签上置，选择器和文字输入x251、宽644px，帮助同宽；下拉外部标题继续隐藏 | browser-checks.json、连接专项回归 |
| 6 重复标题 | 删除连接管理重复h3，保留页面连接配置、表单legend、验证状态和刷新 | real-connections.png |
| 7 合并待审核 | 侧栏删除独立页，生产单含待审核标签与数量；工作台提醒直达该筛选 | 真实浏览、ImpeccableNavigation回归 |
| 8 当前作品＋下一步 | 选列表行更新当前作品、真实阶段、版本及更新时间；一个主操作打开该单真实详情；空阻塞区不展示 | real-final-workbench.png、选择/返回/分页回归 |
| 9 阶段与行动状态分离 | 服务端复用真实待决包/成员决定及最新有效任务；blocked优先展示，但有待决的阻塞单仍可进入待审核标签 | catalog-integration.log |
| 10 五列精简 | 保留作品、阶段、状态、更新、操作；账号/系列进入标题次行，编号/蓝图/产物数进入行菜单；重命名、归档、恢复和永久删除原处理链保留 | real-row-menu.png、现有生命周期UI回归 |
| 11 搜索/排序/标签 | 标题/UUID字面匹配、最近/最早更新和标题排序，全部服务端先筛后分页；保留账号/系列/归档范围。标签支持方向键、Home/End、焦点及关联面板 | 真实搜索空结果/恢复/排序/键盘检查、SQL隔离验证 |
| 12 QC首屏 | 真实当前成片与QC技术证据前置，制作工具后置；同一QC产物不重复展示，非QC阶段布局及已完成交付流程保留 | real-qc-evidence.png、72项审核回归 |

表格补齐columnheader/cell语义。当前没有填入模拟封面，使用真实标题及账号/系列识别作品。侧栏分组、OpenChatCut底部位置、四工具、主题和其他已认可设计保留。

## 验证结果

- 34个文件315项相关回归通过（含目录解析）：ui-tests.log。最后徽章口径与键盘调整后，受影响两文件13项再次通过：final-navigation-tests.log。
- 目录HTTP边界1项通过：http-tests.log。首次沙箱监听端口EPERM，获许可后原测试不变重跑通过，没有弱化断言。
- 真实PostgreSQL隔离数据库4项通过：catalog-integration.log。覆盖原20条之后的搜索命中、字面%/_、UUID、稳定排序与分页、严格pending/成员决定、blocked与review交叠、最新任务/恢复、Owner及历史隔离、阻塞独立分页。测试仅创建并删除自己的loop_ui_catalog_test_*合成库，未写日常业务库。
- TypeScript项目检查、后端编译、夹具类型检查与Vite构建通过：check.log、backend-build.log、fixture-check.log、build.log。最终构建写独立临时目录，JS gzip308.74kB、CSS83.28kB；原有大chunk提示仍在，未调高阈值。
- 独立只读代码审查无Critical问题，发现侧栏阶段计数不等于真实待决数，已改用statusCounts.review（兼容夹具回退pending.total），并以reviewCount=52、真实待决=45的测试验证徽章/标签同为45。
- 手工Impeccable detector一次运行结果[]：detector.json；未启用自动hook。视觉结论同时基于实际渲染，不以检测器空输出替代。
- 真实5174只读验证工作台→审核标签→搜索空结果→清除→键盘状态切换→标题排序→行菜单→工作台下一步→QC视频→返回→连接页。当前成片readyState=4，无媒体错误；QC证据top384，返回制作top1174。浅深色均无页面水平溢出；列表控件统一36px高、同y167、间距10px。
- git diff --check通过。相对本轮起点的14个直接localRequest/localCommand调用参数一致：request-contracts.json；新增目录只读筛选参数及查询属于本轮明确授权范围。

## 运行与边界

目录后端使用预编译模块。初次配置重载仍缓存旧解析器，真实HTTP新参数返回400；已使用项目脚本正常重启应用并加载新编译模块，随后真实页面各筛选成功。数据库和独立剪辑服务未停止，未改凭据、认证设置或数据库结构。

真实应用未执行创建、保存、审批、删除、Provider生成或Studio工程命令；测试写路径只在隔离夹具/测试数据库执行。原有审批、冻结配置、CSRF、Owner权限、历史只读及命令业务逻辑保留。

未运行整套后端测试，也未运行依赖退役stage-d夹具的旧catalogContract集成；新增SQL隔离测试及真实HTTP页面检查已单独记录，不能视为旧部署环境全套验收。

新查询派生计数基于当前账号/系列/归档/搜索范围，review与blocked可交叠，不宣称状态计数相加等于总数。只改变展示与读取筛选，不替换原业务状态机。

最终源码与起点差异见changes.json、implementation.diff；计划见PLAN.md。只关闭本轮QA标签和5191夹具服务，真实应用继续运行供用户确认。未提交、推送或部署。
