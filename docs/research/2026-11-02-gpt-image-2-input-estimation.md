# GPT Image 2 输入费用估算边界

核实日期：2026-11-02。目标模型保持 `gpt-image-2`。本次只读取 OpenAI 官方公开资料及网页公开计算器源码，没有读取密钥、安装依赖或调用付费 API，也没有验证供应商真实用量。输出 token 算法已记录在[前一份价格核实](./2026-11-02-conservative-reservation-prices.md)，本文只补充输入估算。

## 结论

官方单价可以确认，但本次检索未找到 `gpt-image-2` 专属的公开文本编码映射、参考图缩放算法或输入 token 公式。可以让本地预算随完整提示词长度、参考图实际尺寸变化；这属于工程近似，尚不能宣称比固定额度更接近真实账单。应保留「估算」含义，并让后续真实用量成为校准依据。

## 可确认的官方规则

### Standard 单价

[OpenAI API Pricing](https://developers.openai.com/api/docs/pricing?image-pricing-expanded=true) 的 Standard → All models → `gpt-image-2` 为下表，单位均为美元／百万 token：

| 项目 | Standard |
| --- | ---: |
| 文本输入 | $5 |
| 图片输入 | $8 |
| 图片输出 | $30 |

已检查页面初始 HTML 中 `data-value="standard"` 面板的 `GroupedPricingTable` 数据：该模型 Image 行为 `8, 30, 2`，Text 行为 `5, "-", 1.25`，列顺序为输入、输出、缓存输入。同页 `data-value="batch"` 面板为半价；网页正文抓取可能只露出旧模型的 Batch 行，不能据此把直接 Images API 调用改成 $4／$15／$2.5。来源：[官方价格页](https://developers.openai.com/api/docs/pricing)。

### 高保真输入与自动质量

`gpt-image-2` 自动以高保真处理所有参考图，调用时应省略 `input_fidelity`，不能设置低保真来减少图片输入用量。[官方编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit) 与[图片生成指南](https://developers.openai.com/api/docs/guides/image-generation#image-input-fidelity) 相互印证。

输出 `quality` 与输入保真度是不同维度。把输出 `auto` 按 `high` 预留，是本项目的预算选择；官方只说 `auto` 随生成结果决定，未承诺固定等于 `high`。直接 Images API 不适用 GPT Image 2 的缓存输入优惠。[官方指南](https://developers.openai.com/api/docs/guides/image-generation#cached-input-pricing)。

## 不能拿来当 GPT Image 2 公式的规则

[Images and vision](https://developers.openai.com/api/docs/guides/images-vision#calculating-costs) 明确区分两类输入计费：通用 vision 的 patch／tile 规则不覆盖 GPT Image 生图或编辑。该页 `GPT Image model inputs` 下的 `65 + 129 × tile` 及高保真额外 `4160`／`6240` token 位于 **GPT Image 1 历史规则**，不能迁移为 GPT Image 2 官方公式。

[图片输入计算器](https://developers.openai.com/api/docs/guides/image-cost-calculator) 面向 vision 模型，页面明确把 GPT Image 用户引向生图计算器。已读取它挂载的[公开组件](https://developers.openai.com/_astro/ImageTokenCalculator.react.DFbDXdGU.js)：模型列表不包含 `gpt-image-2`。

生图指南挂载的[GPT Image 计算器组件](https://developers.openai.com/_astro/GptImageTokenCalculator.react.BWGLfw71.js) 确有 `gpt-image-2`，但只接收模型、输出质量及输出宽高，只计算输出 token；没有提示词或参考图字段。这不是一个可计算参考图输入成本的隐藏公式。组件 URL 随官方发布可能变化，核查入口应保留[所属指南](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)。

本次未找到下列 GPT Image 2 官方输入规则，不能自行补成确定事实：

- 参考图内部是否先缩放、缩到多大、是否切块以及如何取整。
- 同一像素面积在不同长宽比下的输入 token 差异。
- 高保真输入的固定基数、面积系数或每张上限。
- 第一张和后续参考图是否采用相同输入处理。

## 文本分词与 token counting API

本次检索官方模型页、图片指南、编辑接口与 token counting 文档，未找到 `gpt-image-2` 到某个公开 tokenizer／encoding 的确定映射。不能把任意 `tiktoken` 编码结果标成该模型精确 token 数，也不能声称 tokenizer 已被证实完全不公开；准确结论是本次公开文档未建立该映射。[模型页](https://developers.openai.com/api/docs/models/gpt-image-2)。

[Counting tokens](https://developers.openai.com/api/docs/guides/token-counting) 提供基于 Responses API 请求格式的输入计数接口，并说明本地 tokenizer 不覆盖图片、工具、请求结构等因素。本次没有发现它能在生成前预报直接 `/v1/images/edits` 内部 `gpt-image-2` 输入用量的明确保证；接口 schema 包含 image generation tool 配置，也不等于已执行工具的用量。不要为了本次本地估算新增网络请求或改换 API 路径。[计数接口](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count)。

## 本地估算建议

以下为项目工程建议，**不是 OpenAI token 算法或官方收费规则**。它的用途是让调用前预算随实际输入变化，同时保留未知内部处理带来的误差。

### 完整提示词

估算对象使用实际将发送的完整 `prompt`，包括参考图说明、账号规则、系列规则及其他拼接上下文。仅统计输入框正文会漏掉请求中实际存在的文本。

不新增 tokenizer 依赖时，可以将 ASCII 文本、CJK 文字、其他 Unicode 字符分别计数，再应用明确命名的本地权重；ASCII 连续文本按字符比例估计，CJK 与其他字符使用更保守的权重。空格、标点、数字、换行也应纳入同一个计数口径。权重是可校准假设，不应在界面声称「准确分词」；简单的所有字符统一除以 4 尤其不能代表中英文混合提示词。

### 参考图尺寸

读取**实际发送文件**的宽高，使用项目现有的本地媒体探测能力，例如 `ffprobe`。如果上传或执行路径会重新缩放，输入应以缩放后文件为准。只探测元数据，不为算预算转换图片或访问额外外部服务。

可采用参数化的预算模型：`每张估算 token = 高保真基础额度 + 每百万像素增量 × (宽 × 高 / 1,000,000)`，逐张相加。基础额度让小图仍保留高保真开销，面积项让不同尺寸产生不同预算；两项系数都应作为本地假设保留来源说明，不借用 GPT Image 1 的常数。尺寸缺失时使用明确的保守回退，不能把该参考图按 0 计费。

面积模型没有表达官方未知的缩放、裁剪、分块或长宽比差异。不要把输出图片尺寸限制当作输入缩放规则，也不要未经证据给大图加上所谓官方 token 封顶。尺寸改变后预算可响应，不代表真实 token 与像素必然线性增长。

### 合计与校准

使用已核实单价计算 `输入美元估算 = 文本估算 token × 5 / 1,000,000 + 参考图估算 token × 8 / 1,000,000`，再与已有输出费用相加，最后沿用项目的人民币换算、取整和余量规则。价格、token 假设及余量分开记录，避免将项目缓冲解释成供应商加价。

后续在用户已授权的正常生成中，如供应商返回实际 token 明细，可对照完整提示词统计、参考图尺寸、模型及输入张数校准权重；本次不额外调用真实生成接口。API 文档的用量对象包含 `input_tokens_details.text_tokens` 与 `input_tokens_details.image_tokens`，但是否返回及第三方兼容接口语义，应以该次真实响应为准。[编辑接口用量对象](https://developers.openai.com/api/reference/resources/images/methods/edit)。

## 本次交付与限制

本次只新增此研究文档；未改实现、提交或推送。已核实公开费率、模型规则及两个计算器的覆盖范围，未用真实请求检验 token 近似误差。后续实现应在说明中保留「按提示词长度和参考图尺寸本地估算，实际费用以供应商用量为准」的含义。

## 本次实现采用的本地系数

完整请求文本由估算与入队共用同一个构造函数，包括参考图说明、账号和系列规则。ASCII 每 4 个字符暂估 1 token，Han／日文／韩文每字暂估 1.5 token，其他 Unicode 字符按 UTF-8 字节长度每 2 字节向上取整；合计再向上取整。空白和标点也纳入，按 Unicode code point 遍历，避免把代理对直接当两个文字。

每张参考图使用经原文件指纹校验、`ffprobe` 实测的宽高，输入额度为 `2048 + ceil(宽 × 高 / 128)` token。基础 2048、面积系数以及文字权重均为本地预算参数，不是 OpenAI 公式，未以真实供应商 usage 做误差校准。原始参考图按原尺寸估算，不假定供应商内部的缩放／压缩，亦不改变实际发送图片。

例如 256×256、1024×1024、2048×2048 分别暂估 2560、10240、34816 图片输入 token。取消了每张统一 $0.08 的规则；按各图尺寸逐张求和，再分别使用文本 $5／图片输入 $8 每百万 token。官方输出公式及 $30／百万 token 不变；输入按本次请求计一次，输出按生成张数计算，沿用现有批次口径。自动质量仅在输出预留时按 high，不改写实际请求的 auto。仍加 20% 总余量，且可在确认框调整。

坏图、缺失文件或指纹变化直接拒绝，不将缺失尺寸按 0 计费，也不静默恢复固定费用。确认时重新校验尺寸与输入摘要；估算明细保存到同一确认记录。
