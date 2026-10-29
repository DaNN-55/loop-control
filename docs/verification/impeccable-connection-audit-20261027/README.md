# 连接配置：Impeccable 与现有 Skills 只读对比

日期：2026-10-27。对象：本机 Loop Control 的「系统维护 → 连接管理」。结论：本轮两套指导的主要发现相近，现有规范更直接约束项目视觉，Impeccable 更便于组织审查维度；其源码 detector 没有给本页面增加已确认缺陷。

## 安装与边界

- 已通过系统 `skill-installer` 从 `pbakaus/impeccable/.agents/skills/impeccable` 安装到 `/Users/dan/.codex/skills/impeccable`。
- 安装 Skill 元数据版本为 `4.8.0`，首次运行下载并按附带 checksum 校验引擎，`engine-probe` 返回 `impeccable-engine 0.1.18`。已修正 launcher 的用户执行权限并验证直接调用。
- 没有运行官方 install/update 命令或 init，没有安装/启用自动 hook，没有生成 PRODUCT.md 或 DESIGN.md。`context` 明确返回本次无自动设计 hook，项目 `.codex/hooks.json` 不存在。
- 本轮没有修改应用源码、样式、依赖、连接、Keychain 或认证；没有保存、测试、撤销连接或调用 Provider。只增加计划、报告、截图和审查源码快照；未提交或推送。

官方依据：[Skill 入口](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/SKILL.md)、[audit 流程](https://github.com/pbakaus/impeccable/blob/main/skill/reference/audit.md)。

## 比较方法与版本

现有流程使用 `web-design-guidelines` 最新官方规则与本机 `dan-ui-foundation/reference/ui-contract.md`；Impeccable 使用安装版本的 context、Operate 指导与 audit playbook，并实际执行 detector。

先固定现有流程的源码初稿，再运行 detector，最后共用同一真实浏览器证据复核。两套流程由同一 Agent 顺序执行，不是独立盲测；不能据此量化设计胜率或 token 节省。

审查包括 `ConnectionWorkspace` 的管理表单和列表、`ConnectionTestButton`、`LocalConnectionsPanel`、`LocalMaintenancePanel` 及相关 CSS。文件内的 `ExternalConnectionPicker` 属于蓝图能力内嵌入口，不算本次页面。共享 CSS 中不命中本页面的规则不计入发现。

开始时正常连接与旧测试连接分组仍存在，随后其他工作删除了该分组逻辑；现场从「4 + 10」变为「14」。本轮没有实施该变化。为避免混用版本，最终报告以 [source-sha256.json](source-sha256.json) 和 [source-snapshot](source-snapshot/) 固定的五个文件为准；初稿 [existing-skill-initial.md](existing-skill-initial.md) 保留，但其中旧行号与分组描述已由此报告更正。

## 发现

### F1 / P1：连接凭据表单被登录自动填充命中

位置：[ConnectionWorkspace.tsx:224](source-snapshot/src/connections/ConnectionWorkspace.tsx#L224)、[ConnectionWorkspace.tsx:226](source-snapshot/src/connections/ConnectionWorkspace.tsx#L226)。

实际操作：用户在新标签页登录后，打开系统维护。Agent 没有在连接表单输入任何内容，「连接名称」却出现登录邮箱，Pexels API Key 出现掩码内容，输入框显示 Chrome 自动填充底色，「仅保存凭据」按钮可用。见 [desktop-autofill.png](desktop-autofill.png)。

证据只证明自动填充现象；没有读取掩码原值，不能断言它与登录密码逐字相同，也没有实际提交来验证服务端保存结果。风险是把站点登录自动填充当成 Provider 连接材料，误导后续保存。

源码使用 `type="password"` 和 `autoComplete="off"`，字段缺少稳定的 `name`。当前浏览器结果表明仅靠 off 未能隔离登录自动填充。后续可评估连接专用字段语义、适合新秘密的 autocomplete 策略，并在已保存登录凭据的 Chrome 中复测；不能保证单一属性解决所有密码管理器。

对比：现有规则首先指出表单 `name` / autocomplete 语义，Impeccable 从实现完整性与错误预防分类；真正把它提升为 P1 的是浏览器证据。detector 没有识别该问题，不能归为自动检测成果。

### F2 / P2：切换连接会无提示丢弃未保存草稿

位置：[ConnectionWorkspace.tsx:159](source-snapshot/src/connections/ConnectionWorkspace.tsx#L159)、[ConnectionWorkspace.tsx:222](source-snapshot/src/connections/ConnectionWorkspace.tsx#L222)。

`choose()` 直接覆盖连接名称和说明，并清空秘密、业务空间及恢复草稿，没有 dirty 判断或保留路径。已填写内容后切换操作对象，会丢弃当前编辑；清空秘密具有隔离目的，不应简单取消。

这是源码确认的行为路径，本轮没有输入测试草稿或切换连接复现，不能记作浏览器实测。建议后续为非空未保存编辑提供明确的丢弃确认或保留策略，同时维持秘密不跨连接继承。

对比：现有 Web Guidelines 直接覆盖未保存更改保护；Impeccable 的实现完整性检查也能容纳此项，没有证明其独有优势。

### F3 / P2：关闭按钮触控区域偏小

位置：[LocalMaintenancePanel.tsx:24](source-snapshot/src/local-app/LocalMaintenancePanel.tsx#L24)、[styles.css](source-snapshot/src/styles.css)。

360px 模拟视口下，读取实际 `getBoundingClientRect()` 得到「关闭系统维护」按钮约 `12.66 × 24 CSS px`。它有可访问名称，不能报成缺少 aria-label。建议后续扩大实际可点击区域，视觉上的 × 无需变大。

这是可用性改进，不在未核查相邻目标间距例外的情况下宣称违反 WCAG 2.5.8。现有 Dan UI 的常规 IconButton 约定为 40px；Impeccable 强调触控目标，两套规则都能指出问题。

### F4 / P3：常规按钮与现有 Dan UI 约定不一致

位置：[styles.css:45](source-snapshot/src/styles.css#L45)、[styles.css:1871](source-snapshot/src/styles.css#L1871)。

本页输入框使用 40px / 8px 圆角，常规按钮仍继承 42px / 5px 圆角 / 14px 文字；Dan UI contract 为 40px / 8px / 13px。浏览器测量确认刷新按钮高42px。这是规范差异，不是阻断功能，也不应仅为凑统一而全项目替换。

现有 Skill 直接提供对照值；Impeccable 若未补充这份项目规范，只能提出一般一致性建议。具体数值不能算 Impeccable 自己发现的标准。

### 不列为优先问题的候选

- 字段普遍缺少 `name` 属于低优先级语义改进；与 F1 有关的部分已合并，不重复计数。
- 搜索列表筛选后，分组数字仍为连接总数。源码可确认，但未在本轮输入搜索词；可考虑「匹配数 / 总数」，暂不列入四项主要发现。
- 本轮没有证明渲染性能、数据量或深色主题存在故障，不凭规则清单新增问题。

## Impeccable audit 结果

实现完整性结论：需要处理 F1 的自动填充风险，并评估 F2 的编辑保护；现有界面仍有明确领域标签、表单分组与验证状态，未发现应整体重做视觉的依据。

| 维度 | 范围内判断 | 依据和限制 |
| --- | --- | --- |
| 无障碍 | 有基础，关闭目标需改善 | 原生表单、label、tablist、dialog、alert/status、焦点管理存在；未做屏幕阅读器验收 |
| 性能 | 未确认缺陷 | 未做性能录制或真实负载测试；不能把未量测当作满分 |
| 主题 | 静态路径存在 | 维护区有主题 token 和深色状态覆盖；本轮没有切换用户主题 |
| 响应式 | 本次视口通过基本布局检查 | 实际查看桌面和360×800模拟视口，document.scrollWidth=360；不代表真机触屏与200%缩放通过 |
| 实现完整性 | 有两项优先候选 | F1浏览器确认，F2源码路径确认；detector本页有效新增为0 |

playbook 提供 `/20` 评分，但本次缺少性能量测等证据，未补造总分。建议顺序为：后续确认授权后处理 F1、F2，再处理 F3，最后按需精修 F4；没有执行这些修改。

### Detector 原始输出与误报处理

首轮源码扫描完成、退出码2，产生20条告警。扫描后目标源码发生并发变化，因此在固定的最终快照上重新扫描；最终仍为20条，原始输出见 [detector-source.json](detector-source.json)。

其中19条是 `side-tab`，1条是 `border-accent-on-rounded`，都来自共享 `styles.css` 的审核、分镜、生产单、账号等其他区域。经 selector 与当前页面对应关系复核，20条全部排除出本轮。它们属于范围外命中，不能直接说成检测器全部误报，也没有评审这些页面设计是否有问题。

TSX/CSS 源码模式使用模式匹配；没有连接已登录 Chrome 的 CDP，因此没有跑登录态 DOM detector。没有拿登录页的扫描冒充连接页结果。0条范围内检测告警不能证明页面没有问题，F1正是反例。

## 哪套更好用

| 比较项 | 现有 Skills | Impeccable |
| --- | --- | --- |
| 本项目视觉约束 | Dan UI 的数值与组件语义直接可用 | 仍要读取项目规范 |
| 审查组织 | 规则精简，直接定位文件和行 | 五维度、严重程度与后续命令更完整 |
| 本次关键发现 | 规则与浏览器结合可识别F1–F4 | 人工流程可识别同类问题；detector没有有效新增 |
| 使用成本 | 已有，不增加运行工具 | 首次引擎下载、上下文加载及输出范围筛选 |

这次结果支持继续以现有规范做日常实现，用 Impeccable 做阶段性集中审查；没有证据支持替换整套现有 Skills。实际自动化收益取决于后续是否出现其规则能覆盖的问题。

## 验证、限制与自动审批

- Chrome由用户登录，Agent没有读取密码、绕过认证或新建会话。
- 查看真实桌面与360px模拟布局；只读表达式仅测量尺寸和属性，不读取任何input.value或掩码原值。尺寸记录见 [observed-metrics.json](observed-metrics.json)。
- 自动审批拒绝了尝试清空自动填充草稿，理由为会改变表单状态，与「先不要改页面」冲突。该动作未执行；随后仅保存截图和继续只读检查，表单原状保留。
- Chrome期间有人工切换标签，后续工具输入被中止；没有把未完成的二次尺寸读取计作成功。本轮没有运行页面交互回归、Provider验证、构建或测试。
- 工作区并发变化已记录并固定快照，不把其他任务改动归为本轮修改。没有安装自动hook、没有修改页面代码。

规则来源：[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)、本机 `/Users/dan/.agents/skills/dan-ui-foundation/reference/ui-contract.md`、[Impeccable audit](https://github.com/pbakaus/impeccable/blob/main/skill/reference/audit.md)。
