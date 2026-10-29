# Loop Control 原型全量迁移验收

已将认可的 Impeccable 原型落实到当前本机应用：七个直接导航入口、完整制作工作区、全部现有配置/管理表单与菜单、登录/安全/密钥及各生产阶段。保留现有功能、真实数据路径与 OpenChatCut 引擎。全部改动未提交，Git HEAD 未变。

## 实施结果

- 统一冷蓝灰任务底色、钴蓝导航、明暗 token、紧凑字段与边界层级；减少重复说明，次要帮助按需查看。
- 工作台复用真实运营目录；待审核保留原生产单菜单及服务端筛选。三组独立分页和统计口径已用超过 20 条的夹具验证。
- 生产详情改为整页上下文，保留列表筛选/页码/深链返回、实际审批和冻结配置；七阶段轨迹只读，绿色已过、琥珀待决。
- 账号蓝图/能力/Prompt/系列版本、新建生产单、连接/版本/测试、历史/来源/独立文件记录分页、清理恢复、系统证据、安全与密钥表单均保留实际处理程序。
- 镜头文字/声音/字幕/片段/构图/同步代理、Studio 冲突及修订、QC/发布包与生产单生命周期继续使用真实规则。登录采用原型双栏和真实认证；无任意演示口令。

批准原型与真实能力的适配记在 [.impeccable/briefs/native-app.md](../../../.impeccable/briefs/native-app.md)：首页不虚构封面或行；模型与连接选项来自真实注册目录；原型时间线不替换实际剪辑引擎。已退役独有界面不迁移。

## 验证

| 检查 | 结果与证据 |
|---|---|
| 起点相关 UI 基线 | 9 文件 / 83 项通过，[日志](baseline-ui-tests.log) |
| 最终 UI 回归 | 31 文件 / 290 项通过，[目标](final-ui-targets.json)、[日志](final-ui-tests.log) |
| 最后登录布局 | 认证/目录 3 文件 / 26 项通过，[日志](login-tests.log)；不重复计入唯一测试总量 |
| 新导航强回归 | 5 项通过；合法 view、52候选/45待审口径、三路第二页、筛选重置、返回/inert、连接修复与 Studio 失败/CSRF，[源码](../../../src/local-app/ImpeccableNavigation.test.tsx) |
| 类型 / 夹具类型 | 通过，[应用](final-check.log)、[夹具](fixture-check.log) |
| 最终构建 | 通过，输出到临时目录并保留原运行时 dist，[日志](build.log) |
| 完整非集成测试 | 144 文件通过、2 文件失败；1077 项通过、9 项失败，[日志](full-tests-local.log) |
| 真实浏览器 | 只读查看七入口、历史内容、待审生产单、返回与系统浮层；全新右侧标签 5174 加载后 warn/error 为空，[日志](fresh-real-browser-logs.json) |
| 阶段与布局 | 16 个真实 React 阶段；1280/1440/1920 PC 与实际用户宽度、390 窄窗、明暗/长名/空/错误/禁用/待生成/交付就绪；[记录](visual-results.json)、[截图](screenshots/) |
| 请求/命令源码 | 10 个文件、35 处 localRequest/localCommand 参数与本轮起点完全一致，[对照](business-call-comparison.json)；该静态结果不替代运行验证 |
| 机械检测 | 仅一次、24 目标、0 命中，[原始结果](detector.json)；未启用 hook，不能等同完整审查 |
| Git 与范围 | HEAD 保持 30f3361bbe0d80be73bac7684ad22c2e20059d09；未提交/推送/部署，保留既有改动，[清单](implementation-manifest.json) |

完整测试的两组失败与[此前基线](../dan-ui-rollout-20261027/baseline-tests.log)相同：本地 application 测试缺少 `dist/local-app/local-app/secretAdministration.js`；Worker CLI 的 9 项报 `Invalid tsconfig.worker.json`。未为 UI 迁移修改无关后端或放宽断言。首次完整测试受沙盒监听 EPERM 影响，其日志单列为 full-tests.log；解除本机监听限制后的结果以上表为准。

构建保留已有大 chunk 提示：主 JS 966.32 kB / gzip 290.20 kB，CSS 540.56 kB / gzip 79.15 kB；未新增依赖或调高警告阈值。

## 独立审查与设计记录

先由子 Agent 对迁移计划做十项补充，见 [PLAN.md](PLAN.md)。实施差异审查发现并修复窄窗导航、隐藏通知及系统浮层；新测试发现并修复三路分页互相重置。

独立视觉完整审查先要求有效补拍，再固定三项修正：连续阶段轨迹、暗色主按钮对比与长名称密度。三项均获 resolved，disposition: ship；该结论只覆盖固定修正与其引入的可见回归。登录拓扑单独由全新 Agent 审查，disposition: ship。见 [审查记录](finish-review.md)、[对比度](fix1-contrast.json)、[补拍索引](fix1-captures.json)。暗色主按钮正常 6.74:1，hover/loading 8.32:1；长名称在 1280 视口行高 89px，键盘可查看全文。

独立 documenter 写入实际实现的 [DESIGN.md](../../../DESIGN.md) 与 [.impeccable/design.json](../../../.impeccable/design.json)：8 个规范章节、37 个颜色 token、schemaVersion 2、10 个组件。规范以真实源码为准，不固化模拟媒体或过期原型值。

## 数据与服务边界

真实服务仅进行查看、导航、筛选、展开和显示偏好检查。没有创建/修改/归档/删除业务记录、修改密码、查看真实密钥、调用 Provider 生成、准备/替换真实 Studio 工程或导出真实视频。涉及写入、清敏和失败的路径使用合成测试；不把合成媒体预览当作真实生产产出。

本轮临时 5191 验收服务及 QA 标签已关闭；既有 5174 应用与 58749 原型服务保留。右侧最终标签是 `http://127.0.0.1:5174/`，不是隔离夹具。起点源码副本在 before/，原 Git 状态及原型哈希在 baseline.json；本轮只维护当前项目，不修改全局 Skill。
