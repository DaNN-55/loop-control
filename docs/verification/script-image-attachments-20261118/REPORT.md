# 脚本拍法图片与文档附件（2026-11-18）

## 子任务交付范围

本子任务实现图片引用与限额、素材解析、真实多模态Provider请求、上传／选素材／拖入／预览／移除组件和会话隔离的待发图片草稿。共享页面、请求调度、会话父链累积和素材列表接线由主agent完成。未暂存／提交，未操作正式生产单、连接或收费Provider。

- 图片按钮组件位于 `ScriptStudioAttachmentControls.tsx`，由主agent放在推理图标左侧；拖入处理绑定聊天form。
- 上传走现有 `importMaterial` Owner命令，注册本期 `visual_reference`；相同已知SHA／大小／MIME复用现有材料。移除待发附件只清消息引用，不删素材或原文件。失败留错误与已成功项；重试沿用现有命令幂等／未知结果核对合同。
- PNG／JPEG／WebP，每条消息最多新增4张，单张≤10 MiB；同一对话累计≤16张、原始图片总大小≤24 MiB。没有自动压图或额外素材副本。
- 引用只保存材料修订ID、SHA、MIME、大小和名称；只读恢复不读图像字节。实际发送前重新检查Owner／生产单材料归属、元数据、位置映射／文件身份、SHA和完整媒体解码，然后临时组装data URL。
- 带图实际请求使用Responses `input_text`＋`input_image`内容块，固定 `detail: high`。原文优先；图片和图中文字只是数据，冲突须在warnings或讨论回复中说明，不能自动改写原文。
- snapshot helper保留实际文本上下文及小引用，剥离图像base64。无图请求与旧纯文本body逐字段相同，不加空attachments字段或改变字符串content形态。
- 当前不支持看图的型号拒绝带图调用；切换到不支持型号不清掉pending，UI明确提示。pending草稿按传入的Owner／会话／脚本作用域存本机小引用；成功发送才acknowledge清当前pending。

## 模型事实与官方来源

模型能力由 `supportsLanguageModelImages` 的显式逐型号事实表统一判断，不按名称前缀或未来新增目录项推断。

- GPT-5.6 Luna／Terra／Sol支持图片输入，见[图像输入指南](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses)。`gpt-5.6`官方型号页重定向到[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)。
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)和[GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)型号页Modalities均明确Image Input only、支持Responses。
- DeepSeek Flash接受Responses input_image，见[Vision](https://api-docs.deepseek.com/guides/vision/)；V4 Pro不开放此能力。无远程URL抓取或隐式转换为文字替代看图。
- 主agent决定本轮不扩大修改全局registeredAdapters目录；聊天UI和后端共用上述型号能力事实。未新增依赖／数据库迁移。

## 定向验证

| 检查 | 实际结果 |
| --- | --- |
| RED | 新多模态与不支持型号用例先失败；新引用／resolver模块缺失时失败；snapshot剥离测试先失败。原始日志留在本轮私有scratch待主agent核对后清理。 |
| 当前定向 | 4文件38项全部通过：引用5、可信材料解析8、Provider21、UI／hook4。 |
| 引用边界 | 签名识别、拒绝路径／inline bytes混入引用、SHA／MIME／大小形状、身份变化、去重顺序、16张和24 MiB上限。 |
| Provider | OpenAI及Flash真image content形态；V4 Pro拒绝；图片／原文冲突指令；snapshot无base64且有真实refs文本上下文；无图generation／discussion与旧body完全一致。 |
| 材料resolver | 未注册／外生产单材料拒绝、元数据变化拒绝、真实字节类型和解码失败拒绝、位置解析后读取、无图不接触存储。媒体边界在本组单测使用替身，不能代替主agent实际HTTP／文件集成。 |
| UI／hook | 上传一次并入素材、同bytes不同文件名复用、移除不删素材、素材库重新选择、文件拖入、切型号保留pending并报不支持、会话切换草稿隔离、存储无图像base64、伪装与超大文件发送前拦截。 |
| 局部类型 | 对本子任务入口执行strict／noUnused的tsc noEmit，通过；未运行全局build或完整回归。 |
| 差异 | `git diff --check`通过；不改共享Chat／Assistant／Requests／脚本面板／父工作区、ADR和PLAN。 |

UI首轮出现Vite模块解析问题：macOS文件系统大小写不敏感，UI `ScriptStudioAttachments.tsx` 被扩展名优先解析成后端 `scriptStudioAttachments.ts`。已把UI入口改成独立basename `ScriptStudioAttachmentControls.tsx`，四项用户路径重跑通过。

## HTTP与私有PostgreSQL集成

主agent接线后扩展 `scriptStudioRequests.integration.test.ts`，保留原24项，新增6项；在隔离原生PostgreSQL、实际本机HTTP和受控Provider下，**30项通过、1项浏览器hold按条件跳过**（2026-11-18，4.57秒）。合成PNG来自版本化 `fixtures/workspace-media/still-striped.png`，经过真实Owner importMaterial及完整文件校验，无媒体解析替身。

- 验证上传及相同上传重试只新增一次材料，上传本身无模型请求；真实OpenAI／DeepSeek Flash传输含image data URL。
- 验证同轮idempotencyKey及同payload重放不重复调Provider，改图身份不能复用原key；snapshot正文及顶层只保存小引用，不含base64，仍小于128 KiB。
- 验证后续文字、仅图片讨论、人工改镜头、删除镜头继续携带累计图片；逐turn只显示当轮引用；新显式会话没有图、历史或旧plan，旧会话完整可恢复。
- 验证其他Owner、其他生产单、未注册材料、假SHA／MIME／大小／名称、客户端inline图、磁盘真实文件被改，均在Provider调用前拒绝。
- 验证V4 Pro拒绝新图及历史累计图，Flash真实带图成功；当轮5张拒绝。
- 验证未知请求重放不重发，不能切换已有会话或新建会话绕过；unknown附件保留在本轮记录，但未并入已完成累计上下文。
- 验证显式会话已有完成记录时漏parent、过期parent、跨会话parent均拒绝。

首次集成准备因fixture helper只接受 `db/local`请求别名而拒绝 `db/current`路径；沿用现有209／210请求约定以basename选择真实catalog中的211。DeepSeek受控响应首次误用OpenAI `resp_` ID，被运行时正确拒绝；fixture修正为DeepSeek UUID后重跑全文件通过。未放宽运行时合同。

## 剩余验收

模拟真人浏览器交互由主agent执行；本子任务的真实HTTP验证使用受控Provider，并未发起收费模型请求。UI hold fixture已支持新会话与图片输入，JSON提供providerOrigin；其 `/__fixture/state`只在隔离本机fixture中返回调用次数和图片块计数，POST mode=drop／ok可验证未知请求恢复。

## Modern Web Guidance

本轮search `drag drop upload`匹配到排序用drag-and-drop，未错误套用；重查 `file input upload`后读取 `forms`。保留原生file input与可键盘访问的按钮、明确按钮type，按“DON'T nest `<form>` elements”不再嵌套表单；按“DO maintain a visible `:focus-visible` indicator”保留预览链接键盘焦点，coarse pointer将目标放大到48px。客户端校验只改善体验，真实字节与归属继续由服务端确认。


## 用户确认后的文档扩展与收尾（16:20）

- 扩展为图片＋PDF／TXT／Markdown／CSV／JSON／DOCX。累计数量／字节合同仍为当轮4个、单个10 MiB、会话16个／24 MiB。DOCX只读取正文文字，不提供内嵌图片；TXT等严格UTF-8，单份20,000字符、对话累计40,000字符，超限拒绝而不截断。
- 最新UI保持附件小弹层，移除素材列表，只保留一个紧凑上传槽，槽内显示格式／大小和DOCX文字范围；点击槽弹系统选文件，聊天和槽拖入都支持，stopPropagation防双入库。
- OpenAI已显式登记的视觉型号以真实 `input_file` 和 `file_data`接收PDF；普通文字文档与有界DOCX正文放在当前用户数据JSON的documents字段，不能成为指令。PDF与提取正文只进实际网络请求，持久snapshot剥离大内容，仍仅用不可变材料引用绑定身份。
- [OpenAI文件输入文档](https://developers.openai.com/api/docs/guides/file-inputs?api-mode=responses)明确支持Responses文件输入。[DeepSeek文件解析文档](https://api-docs.deepseek.com/guides/document_parsing/)要求PDF先走另外收费的/files解析，因此本轮DeepSeek本地PDF明确拒绝并保留草稿，不悄悄增加收费解析；安全提取文字可交给所有已启用文本模型。
- DOCX解析仅使用Node内置zlib，不增加依赖，不解压到文件系统，不获取链接或解析外部实体。依据[PKWARE ZIP规范](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)检查中央目录／本地头／CRC／范围和重叠，拒绝重复路径、加密、ZIP64、不支持的压缩、DTD实体与缺失正文；最多256条目、单条解压2 MiB、合计8 MiB、压缩比200。普通stored／deflate支持，异常包提示另存普通DOCX或UTF-8文本。
- PDF本地只校验签名、完整EOF外壳、加密标记与大小；没有声称完整解码或可靠计算页数，没有新增Poppler运行依赖，完整结构由原生Provider验证并按失败回执提示。
- 专属importMaterial可选标记 `scriptStudioAttachment:true` 在登记前执行以上附件校验；false或其他值拒绝。未传标记的普通reference材料仍保留原接受合同，未改变已有媒体上传格式和上限。此标记参与新请求hash，旧请求身份不变。
- 真人发现后补齐素材库展示：reference文档计入总数、FileText缩略tile和“文档”筛选；不能拖入镜头、不能选为镜头素材。预览面板通过受控 `download=1` 下载原件，不渲染HTML或误作音视频；已有媒体上传accept保持原值。
- 真人发现第5个附件失败后，成功发送前4个会残留旧上传错误；acknowledge现在清旧错误，与清除当前pending一起完成。

新增DOCX／格式能力／Provider／resolver／UI测试先有RED再GREEN。扩展后5文件52项定向通过；最后素材库和ack修复又先RED（11原项过、2新项失败）再GREEN，**素材库5项＋附件UI8项共13项通过**。附件入口strict/noUnused类型检查通过；最终整合全量和实际浏览器验收由主agent汇总。未暂存提交，未触碰正式数据或收费Provider。
