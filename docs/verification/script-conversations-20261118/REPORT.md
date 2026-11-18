# 脚本独立会话与编号入口（2026-11-18）

## 子任务范围

新增持久的空会话、历史隐式会话只读兼容、编号方框横向导航及浏览器选择记忆。共享API派发、聊天输入框接线、图片附件、正式迁移／部署与真人浏览器验收由主agent整合完成；本子任务没有暂存或提交，没有写日常业务数据库，也没有调用付费Provider。

## 合同与实现

- 迁移 `211-script-studio-conversations.sql` 只新增 `local_identity.script_studio_conversations` 元数据表，保存Owner／生产单／脚本基准／原文SHA／时长／会话ID与创建时间。RLS限制Owner，应用仅SELECT／INSERT。旧回执行不改写，immutable baseline／manifest不修改；现有catalog自动发现新增forward，旧schema升级与fresh schema都会应用211。
- 历史未带conversationId的回执仍组成隐式会话，列表用 `id:null` 表示；新会话ID为UUID。列表按首条创建时间和ID稳定排序后从1编号；无历史首个新会话为1，既有历史占1，旧客户端在新会话之后才写入隐式回执也不会产生重复数字。
- `readStudioConversation` 先验证显式会话属于当前完整scope，再按conversationId查询回执；显式空会话不回退到旧latest。父链的每条回执必须同会话，不能携带另一会话的计划或历史。
- `createStudioConversation` 以请求幂等键作为会话ID，相同请求重放返回同一元数据，不能将ID用于另一Owner或原文／时长scope。新建与新模型派发共用scope advisory xact lock及未知请求检查；任何同scope prepared／dispatching／unknown都会阻止新建或fresh dispatch，已存在的幂等结果仍可只读恢复。
- UI初始仅虚线方框加号，有会话后依次显示编号方框；约显示3–4个按钮，粗指针按钮放大至44px。按钮group使用aria-pressed和下划线形状区分当前会话，不仅靠颜色。原生横向overflow支持触摸；垂直滚轮仅在条内确实可滚动时转换为横向，边界释放给页面。方向键／Home／End移动焦点，Enter／Space沿用原生button激活；不引入focusgroup polyfill。
- 选择按Owner／生产单／脚本版本／原文／时长记忆在浏览器localStorage。初次元数据加载前loading为true；真正scope变化才清空状态。上传或其他操作临时disabled时，当前会话和列表保留，不暂时跳回隐式会话。

## API接线

- `conversations`：主agent校验身份／可写scope后调用 `listStudioConversations(c,owner,scope)`，响应 `{conversations:[{id,number,createdAt}]}`。
- `newConversation`：同上调用 `createStudioConversation(c,owner,scope,idempotencyKey)`，响应单个descriptor；创建不发送Provider。
- 恢复、模型输入及人工修订／删除：显式会话传 `conversationId`，新回执固定保存到 `request_snapshot.data.conversationId`；隐式旧会话省略字段以保留原payload hash身份。
- 前端hook `useScriptStudioSessions` 暴露items／activeId／loading／creating／error／refresh／create／select；列表加载和creating期间主agent禁用聊天发送。发送成功后refresh补出首个隐式编号。

## 已执行定向验证

- 服务端先RED：新增helper尚不存在、显式空会话错误恢复旧记录、跨会话父链未拒绝；随后实现后通过。
- 客户端先RED：hook／组件尚不存在；随后覆盖初始加号、选中状态、横向滚轮与边界释放、键盘、禁用、新建防重复、空会话选择记忆、跨scope异步结果忽略。
- 额外RED复现主agent审查发现的disabled翻转重置；修复后同scope上传临时禁用不清列表／activeId。
- 最终定向：5文件29项通过（包含既有schema catalog与对话回归）。源日志暂在 `.scratch/script-conversations-20261118`，供主agent最终核查后清理，仅保留本Markdown报告。
- 新增 `scriptStudioSessions.integration.test.ts` 供主agent在显式私有PG上下文中运行：持久空会话／幂等／Owner与原文时长隔离、旧回执不变／父链隔离、同scope未知请求跨会话阻断。未在本子任务运行，不能算通过。

## Modern Web Guidance

使用主agent先search得到的 `tabs` 指南。按 “Keep tabs on a single row.” 采用单行原生overflow并保留固定尺寸按钮；采用原生button group及aria-pressed，不引入缺少跨浏览器支持的focusgroup。按 “Do not indicate the selected tab with color alone” 保留当前项下划线形状。选中项只调整本条scrollLeft，不调用会滚动整页的默认scrollIntoView。

## 待主agent完成

共享接线后的类型／构建／完整套件、真实隔离HTTP与新会话集成、正式迁移与运行包，以及用户要求的桌面／窄屏真人操作测试。验证中发现问题需修复重测；上述未执行项目不得算通过。

## 主 agent 整合与真人路径验收

已在本轮私有 PostgreSQL、真实 HTTP 路由和独立 Chrome 会话中实际操作，未复用正式生产单或用户已有标签页：

- 初始虚线加号、新建1至6号、单行4格（144px），滚轮向右108px再回0px；方向键移动到2号、Enter选择，刷新保留空2号且没有旧方案、消息或草稿。
- 1号生成方案后输入未发送文字，切到空2号再切回，原方案、消息与草稿仍在；发送成功后输入清空。新会话首发的实际Provider输入只含原文、时长和本轮要求，没有previousPlan、conversation或旧附件。
- 带图片和文档的1号对话连续两轮，刷新恢复7个历史附件；新2号仍无附件、文档正文或历史。另在图片对话实际编辑运镜、删除第三镜，刷新保持两镜、手工内容及图片。
- 受控丢失已完成请求的浏览器HTTP响应：核对态阻止新建；刷新读取完成回执后原文字、待发附件和提交标记均清除，历史7个附件保留，Provider计数仍为2。新写的未发送要求再次刷新仍保留。
- 该真人路径发现JSONB重排对象键导致附件比较失败。已用按不可变字段比较替代JSON序列化比较，组件回归先RED后GREEN，真实浏览器重跑通过。
- 新建会话等待期间锁住旧候选的编辑、删除、采用和继续动作；本机存储不可用时临时pending翻转保留内存草稿。Assistant首次可用渲染即等待恢复，消除effect执行前短暂可发送窗口。
- 390px时文档宽度仍为390px、聊天表单268px，控制栏均在视口内；1280px桌面路径通过。实体触屏和Safari未执行，不计通过。

私有PG会话3项及HTTP请求32项通过（另1个hold按条件跳过；真人验收单独运行该hold）。完整回归与运行包结果见本轮主验收记录。前文“待主agent”是子任务交接时状态，以本节及最终主记录为准。
