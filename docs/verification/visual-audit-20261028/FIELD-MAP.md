# 字段边界与极端数据目录

审查日期：2026-10-28。PC 优先，保留既有 Dan UI。所有例子均为合成数据，通过实际组件 props、同形 API stub 注入；没有修改产品节点或 CSS 制造故障。

完整源码值索引见 [rendered-values.json](rendered-values.json)：27 个当前可达 TSX 文件、2,560 条 JSX 文本／表达式／属性记录，含来源行号、TypeScript 类型、可选性提示。它是静态索引，包含条件分支和重复引用，不代表 2,560 项都逐一完成了交互验收。下表按数据实体归并边界；静态按钮、枚举、帮助文字的确切值以索引和源码为准。

| 字段／来源 | 类型与可选性 | 已确认边界 | 本次数据与检查 |
| --- | --- | --- | --- |
| account.name / AccountForm、AccountWorkspace、生产单账号列 | string，必填 | 表单无 maxLength；配置命令通用字符串上限 100,000，不等于合理的业务名称上限（configurationCommands.ts:52） | 华南地区跨境内容创作与品牌合作工作室（广州・深圳・胡志明市联合制作）、Jo、J、带重音人名、emoji 名称；名称布局与头像收缩 |
| account.slug | string，必填 | 表单小写化、删除非 a-z0-9-，pattern 校验连字符；无专用长度限制 | south-china-cross-border-documentary-production-and-brand-partnership-studio；菜单与选中值识别 |
| account.timezone | string，必填 | UI 有限时区选项；后端 Intl.DateTimeFormat 校验 | Asia/Shanghai，长地区标签；没有伪造未知时区 |
| episode.title | string，可空 | 创建与重命名后端上限 200；创建输入无 maxLength（episodeCommands.ts:66、EpisodeForm.tsx:68） | 合理的中英双语项目标题、空标题、J、文件名式标题、字面 HTML/Markdown；不使用超长随机串证明溢出 |
| series.name / SeriesSettings | string，必填 | 无专用业务长度约束；配置通用字符串上限 100,000 | 城市日常与跨境生活观察：Aleksandra Wiśniewska-Kowalczyk 的联合拍摄记录；230px 实际左栏 |
| series version / blueprint version / revisions | number | UI 未找到显示长度上限；不是金额 | 1、1284，带版本前缀和保存后下一版本；不截断数字 |
| Blueprint 与系列规则 | Json，键可缺省 | 类型化表单、各能力枚举与 validateConfigurationPolicy；不是任意所有字符串都可无限提交 | 约千字真实定位要求，缺少可选规则，人工／未启用路径；长段落滚动与超宽屏阅读长度 |
| Prompt.name / slug / summary / instructions | string，部分摘要可空 | 类型为 string；没有从 CSS 推断业务上限 | 长规则名称、storyboard-planning-v1、中文摘要与正文；字段标签、帮助与摘要截断 |
| connection.name / description / status / provider | string / enum | UI name 100、description 500；status 使用 unverified / verified / revoked 等实际枚举 | 长中文项目连接名称、Jo、未验证／已验证／已撤销；不把无效枚举造成的缺失当作缺陷 |
| secret reference / names / purpose / aliases | string 与 string[]；别名可空 | reference 使用合成占位；未将凭据值纳入测试。名称别名的 inventory 校验上限 2048，与用途正文不是同一限制 | 长说明、长连接名、缺失状态、无引用状态、空 aliases；列表、详情、选中态、禁止查看；未输入密码或取回明文 |
| history title / source path / row key / counts | string、JSON、数字字符串；部分元数据缺失 | 历史来源可能带旧结构；搜索 UI 上限 200 | 多层有空格的中文路径、长文件名、1,234,567 条记录、1,284 文件；不据格式化数字字符串断言数值精度 |
| material source_path / storage_path / artifact relative_path | string，必需或按类型可缺 | 名称显示缩写逻辑 38 字符，中间省略（EpisodeProduction.tsx:772）；存储路径另有边界，非任意用户 URL | 清晨街道采访_Đặng_Thị_Ngọc_Hân_原片_授权确认_中英越字幕_2026-10-28_v12-final-approved.mp4；长路径在标签、下拉、卡片、预览中显示 |
| shots.scriptSegment / subtitle_text / tts text | string，按模式可空 | subtitleText 后端上限 100,000；AI 动作 UI 上限 1500；不同字段不混用上限 | 中文、Vietnamese、带重音姓名、真实多句口播；文本／画面／预览页签、音频与字幕开关、错误状态 |
| task blocker.detail / retry reason / QC reason | string，可缺 | QC 与重试 UI 上限 4000；原因是否必填随操作变化 | 数句可执行的修复说明、空原因、技术代码；运营阻塞卡与 QC 展开 |
| stage / task status / creation step / button labels | finite union 或静态文本 | 16 个生产阶段；状态与操作标签来自当前源码 | 全阶段浅／深色首屏；创建、等待、保存中、失败、审核、交付状态 |
| owner identity / login / password | string；密码仅空输入 | 本次不检查密码保存政策或凭据强度 | 合成长邮箱 bartholomew.fitzgerald@northwind-industries-holdings.example.com；只检查布局、焦点、显示密码按钮；未输入真实或新密码 |
| dates / durations / byte sizes / costs | ISO 时间、number；可缺省 | 未给缺失值伪造日期；费用没有实付或网络生成 | 2023 历史日期、2026-12-31 未来日期、0/1/1284 计数、合成小媒体；不声称覆盖数值的全部有效极限 |
| 集合长度与分页 | array / total / page | 生产单 20/页、密钥与历史 30/页；系列直接 map | Empty=0、One=1、Worst=8、Huge=1284；密钥／历史仅返回 30 条并设置 total=1284；20 与 21 条边界。系列实际渲染1284个按钮 |
| 媒体及可选状态 | image / video / audio / null | 仅本地合成媒体，3 秒测试音视频；不同宽高比遵循真实容器 | 无媒体、合成竖版视频、封面、音频、预览灯箱、加载／失败；未测试第三方编辑器内部 |

文字中的 `<b>`、`&amp;`、`**` 作为用户字面输入保留；本次没有将它们解释为富文本，因此其可见字面形式不是转义错误。中文产品不提供 RTL 模式，RTL 不列为本次产品验收项。320px 早期补充检查仅列附录，后续优先级完全依据 PC。
