# 新开拍法对话与参考附件验收（2026-11-18）

## 结果与范围

按用户最新方案实现编号独立会话和通用参考附件。原有对话、原文、人工修改、删除镜头及采用合同保留。附件入口在推理图标左侧，窄弹层只留一个上传槽；点击槽位调用系统文件选择，槽位和聊天支持拖入。支持PNG/JPEG/WebP、PDF、TXT、Markdown、CSV、JSON、DOCX；音视频不在本轮。

实现细节和局部测试分别见[会话报告](../script-conversations-20261118/REPORT.md)、[附件报告](../script-image-attachments-20261118/REPORT.md)；当前合同见[ADR-0072](../../adr/0072-script-studio-source-and-direction.md)末节。前述子报告的初始交接状态以本主报告为准。

## 实际浏览器验收

使用独立Chrome、私有PostgreSQL和真实本地HTTP服务，三个隔离验收单均自动清理，不占用用户已有标签页。Provider替身只用于可控失败和请求形态观察，真实模型证据另列。

| 用户路径 | 实际结果 |
| --- | --- |
| 空态、新建1–6号、旧对话 | 初始虚线+；创建不调用模型。单行144px约4格，滚轮从72→108→0，方向键移焦、Enter激活。旧方案、消息和未发送草稿可切回；刷新空会话仍为空。 |
| 从原文重新构思 | 新会话首发实际输入没有previousPlan、conversation、attachments或documents；原文和15秒保持。 |
| 人工操作兼容 | 带图对话编辑运镜、删除第三镜，刷新保持两镜、人工文字和图片；操作不调用Provider。 |
| 新上传槽 | 实测260×108.5px、仅一个上传按钮，格式和限额文字位于槽内，无素材选择列表。390px时槽位x=25、right=285，页面宽度390px，无横向溢出。 |
| 文件与拖入 | 通过原生file input选择TXT/DOCX/PDF，使用File+DataTransfer触发实际dragenter/dragover/drop上传图片；MD/CSV/JSON也实际入库并发送。待发和历史预览可移除／打开，上传不会重置当前会话。 |
| 限额和失败 | 第5个文件被拦截，现有4个不丢；成功发送后待发归零、旧上传错误消失。伪装PNG和超大文件在上传前拦截。不支持图的型号阻止发送并保留草稿；PDF/DeepSeek拒绝路径经HTTP及能力单测验证。 |
| 连续对话与刷新 | 同对话第二轮累计7个附件；文字和DOCX提取内容进入实际输入。刷新后7个历史附件保留；新会话没有旧附件。 |
| 丢失响应 | 在服务端已完成后受控丢掉浏览器HTTP响应，进入核对态并锁住新建；刷新恢复完成回执，清已发送文字、3个待发文件和提交标记，历史7个附件保留，Provider总计仍为2。新写草稿再次刷新不被清除。 |
| 本期素材库 | 在隔离单实际采用进入分镜台，素材数8=当前脚本1＋图片1＋文档6；“文档”筛选显示全部6个，文档不可拖为镜头输入。文档预览提供原件下载，不内联执行HTML。 |
| 下载链路 | DOCX和PDF受控GET均200、Content-Disposition为attachment，DOCX为536字节，PDF签名%PDF-1.7。现有媒体上传accept保持不变。 |
| 浏览器错误 | 最终会话页面errors为空。真实图像缩略图complete且naturalWidth>0。 |

真人中发现并修复：临时disabled影响草稿身份、创建期间旧候选操作并发、首次恢复effect前瞬间可发送、已完成丢响应后的草稿残留、JSONB重排对象键导致引用比较失败、素材库过滤reference文档、父层将新文档临时硬编码为image、成功发送后残留旧上传错误。关键问题均增加行为回归，先确认失败再修复。曾因未hover的放大按钮不可点、aria-label误用文本等待，以及fixture十分钟到期导致下载fetch失败；改用正常hover、明确元素等待和新fixture后实际路径通过，没有将这些失败当作成功。

## 真实供应商

使用既有已授权OpenAI连接，仅发送本轮合成参考文件。凭据只在内存读取，未写入fixture数据库、日志或报告；未创建正式生产单、工作区或素材。

| 实际请求 | 结果 | 回执与用量 |
| --- | --- | --- |
| GPT-5.6 Luna，图片＋TXT，关闭推理 | 识别蓝色杯子、右侧把手及棕色桌面；明确指出原文白杯/左侧阳光与参考差异，保持原文；正确读出TXT随机编号K7V3Q-9。 | resp_00927afd84128ec2016afd5d8e137887d082baa59fa2629736；707 input / 169 output tokens；一次发送。 |
| GPT-5.6 Luna，原生PDF input_file | 正确读取页面正文中的Z581和白色杯子。 | resp_04ea7f73de94b6ad016afd618ce71087d0a005b6995f32f414；329 input / 45 output tokens；一次发送。 |

首次真实调用因运行Keychain锁定在网络发送前失败；按现有解锁路径恢复后执行，未重发任何未知模型请求。

## 自动验证与数据保护

- 私有PG/实际HTTP：35项通过，包含32项请求集成和3项会话集成。hold用例在批量中按条件跳过，另行运行三次用于上述真人验收，三次均正常结束。
- 覆盖Owner/生产单/版本/原文/时长/会话作用域、可信最新父链、跨会话拒绝、幂等、unknown跨会话防绕过；真实材料入库/文件身份篡改/权限、原生图片/PDF与提取文本、连续轮次/人工操作及新会话隔离。
- 专属附件标记在材料发布前拒绝坏DOCX、伪装PDF、非UTF-8、20001字符和false标记，材料数不增加。未传标记的同长度普通reference仍可导入。快照无base64、file_data或文档正文，仅小引用，继续受128 KiB边界保护。
- 关键恢复比较条件曾进行反向变异，组件测试失败；恢复正确条件后通过。不会仅凭同一对象的JSON键顺序判断附件身份。
- TypeScript、前端production build、worker/backend构建、runtime:prepare及源码/产物完整性检查通过。前端已有大chunk提示仍在，未为消除提示扩大本轮范围。
- 迁移211通过现有ledger应用，只新增空会话metadata表，既有迁移hash未改。日常应用只重启app，未停止日常PostgreSQL，当前运行包be2c16dec17a624233c64e4385f8c2ccd382576d26aa44b060b24994625fcdb8。
- 正式8表完整行指纹在迁移/更新前后一致：episodes 10、production_material_revisions 83、script_format_requests 28、production_workspaces 8、external_connections 14、external_connection_versions 20、connection_model_settings 5、owner_preferences 1。

最终完整回归：345文件／2521项全部通过（maxWorkers=1）；此前两轮并发完整回归亦通过。最后通用附件自动说明文案统一后，对话恢复、丢响应恢复和父链20项定向通过，前端与worker/backend重新构建通过。父层文档分类回归45项通过。

一次并发完整回归出现既有CompletedStudioView保存状态用例间歇失败。临时追踪证明：新iframe已出现，但绑定真实session的useEffect尚未安装，单次模拟state被旧闭包按origin/project鉴权拒绝，故inspect未发出。仅在该测试取得iframe后等待一次async act，错误origin断言和原1000ms等待均保留，不改运行时鉴权或超时；同握手20次加相关流程共34项通过，单独提交测试准备修复。真实桥不是无条件心跳，本轮未把该fixture修复宣称为生产桥接时序改造。

## 清理与边界

仅保留本主报告、两份子报告、规格/ADR和必要代码测试fixture。自有浏览器已关闭，三次fixture退出，私有PG已核验身份后停止并删除私有根目录；未停止日常PG。收尾清理本轮scratch日志、合成文件、Vite缓存和临时live脚本，不保留密钥或原始大量截图。

实体触屏和Safari未执行。PDF本地只验证大小、签名/结尾和非加密外壳，完整结构由原生Provider校验，真实PDF调用已验证。DOCX采用有界普通ZIP/XML文字提取，不读取内嵌图片。DeepSeek PDF不启用额外付费解析，明确提示改用支持的模型；音视频后续实现。正式原有单本轮未做写操作，真人制作/采用只在私有fixture完成。

最终清理完成：删除本轮3个自有scratch目录共275个文件、33,103,935字节（31.57 MiB），另清理4份自有临时指南副本；原生产单、业务素材、历史报告、SQL/恢复资料和用户附件未删除。运行包完整性与8表指纹在最后一次app重启后再次核对通过。
