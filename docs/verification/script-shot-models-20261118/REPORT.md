# 脚本镜头操作与语言模型扩展验收

2026-11-18。对应镜头“…”菜单／删除、逐镜已修改标记、GPT-5.6／GPT-6.1 全通用系列及 DeepSeek 现售型号适配。

- 登记 `gpt-5.6-luna`、`gpt-5.6-terra`、`gpt-5.6-sol`、官方别名 `gpt-5.6`、`gpt-6.1-sol`、`gpt-6.1-terra`；DeepSeek 当前 `deepseek-flash`、`deepseek-v4-pro` 均适配。严格白名单，不添加无官方合同的前缀通配、已退役 Chat／Reasoner 或受限 Cyber 专用模型。
- 模型登记、连接只读验证、连接启用选择、拍法与原稿识别请求、模型推理档位全部接通。GPT-6.1 Sol 不支持 none，默认 low；其他既有默认 none 行为与请求复用保留。现有连接的默认启用仍为 Luna／Flash，新增型号须在该连接的模型页启用，未擅自改 Owner 设置。
- 新增前向迁移 210，仅扩展请求回执的模型 CHECK；既有迁移、数据行与默认选择不改。验证连接改用官方模型目录，接受任一已适配型号，仍为只读请求。
- 镜头悬浮“…”菜单包含编辑文字与删除，沿用现有 Dropdown。删除有确认，至少留一镜，原文与旧回执保留；新候选保持总时长，剩余镜头按原时长比例分配，精确到 0.01 秒；不缩短剩余口播可用时间、不调用模型，采用前不改工程。
- 顶部内容变化块改为每镜“已修改”。人工编辑与删除时长变化的标记写入回执元数据，刷新可恢复；旧人工回执从已校验的父链恢复标记，不重写旧记录。完整变化仍可在说明内查阅。

## 验证

- `npm run check`、`npm run build`、`npm run backend:build`、`npm run runtime:prepare` 通过。保留既有 bundle 大小提示，未加依赖。
- 完整回归：333 个文件、2,441 项通过。
- 隔离 native PostgreSQL／真实 HTTP／本地 Provider 替身：24 项拍法集成、8 项原稿识别集成通过。包括 6 个 GPT 型号实际请求、Sol 缺省 low 规范化及幂等、未启用拒绝、删除权限／CSRF／原文与基准／重复 ID／最后一镜／旧回执保留、采用后实际工程仅含剩余镜头且总帧数准确。单独浏览器 hold fixture 通过；其他集成中 hold 用例按显式环境开关跳过。
- 浏览器实际完成：生成 3 镜、删除中间镜头、刷新恢复为 2 镜及修改标记、菜单 ArrowDown 定位／Escape 关闭返回触发器；1543、1024、390px 无文档横向溢出，窄屏菜单贴近触发器。连接模型页显示全部 6 型号；在隔离连接启用后刷新聊天目录能选择 Sol，推理显示 low 且没有 none。浏览器 page errors 为空。
- 部分单测先失败后修正；测试环境与 DTO 字段误用的定位记录见 `test-diagnosis.txt`。完整检查通过后没有删测、跳测或降低约束。
- 日常环境仅应用迁移 210 并单独重启应用，PostgreSQL 未停止。遵从 Owner 已有 automaticBackups=false。8 张相关业务／设置表数量与 SHA-256 完全不变。运行包 `bd15f01b063b06a26fe9ca0daf33f41647f09e2caa83f2dcad45fafc1b1044bc` 完整性核验通过。正式页可视核验在紧接的聊天样式批注完成后统一做。

## 边界

未调用真实供应商计费接口；实际模型输出质量／长推理延迟未实测。人工删除只修改当前待采用方案，左侧原文不变；以后重新生成仍按原文与正常优化约束校验。已确认工程／素材不自动删除。Safari 与实体触屏设备未实测。

官方依据：[OpenAI 模型目录](https://developers.openai.com/api/docs/models/all)、[GPT-5.6 Sol 及官方别名](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[DeepSeek 模型目录](https://api-docs.deepseek.com/api/list-models/)、[DeepSeek 旧型号退役公告](https://api-docs.deepseek.com/news/news260424/)。

## Modern Web Guidance

检查 `menu` 的键盘与返回焦点规则，保留项目 React Aria Dropdown 跨浏览器实现，不另加原生 focusgroup 或第二套键盘系统。按 `viewport-aware-dropdowns` 的匹配角色与键盘合同、边缘避让要求验证菜单；使用 bottom end／翻转／视口留边，保留项目菜单最小宽度。

![镜头修改标记](desktop.png)

![已启用模型列表](models.png)

![小屏镜头菜单](mobile-menu.png)
