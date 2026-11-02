# 保守费用预留的官方价格核实

核实日期：2026-11-02。范围：只读官方公开资料与本地执行代码；未读取密钥，未发起生成、充值或其他付费 API 请求。以下是调用前估算依据，不能代替供应商最终账单。美元换算继续使用平台现有的 `USD/CNY = 7.2` 规划假设，不代表实时汇率。

## Kling 3.0

结论：当前 `kling-v3` 单首帧、`mode: std`、`sound: off` 路径可采用 **$0.084/秒**，替换 `¥1/秒` 的未核实预留。[官方 API 定价](https://kling.ai/dev/pricing) 中，视频模型表选择 `Balance` 后，`Kling 3.0` → `No Native Audio` → `Price (720P)` 明确显示 `$0.084/s`；同一行的 `Unit` 视图显示 `0.6 Units/s`。该模型的换算关系由两者相除得到 `$0.14/API Unit`。

### 适用规格与命名

本地 `src/worker/officialVideoProvider.ts` 的 `officialVideoBody()` 固定发送 `model_name: kling-v3`、`mode: std`、`sound: off`，创建接口为 `/v1/videos/image2video`。[官方 Legacy 图生视频接口](https://kling.ai/document-api/api/video/3-0-omni/image-to-video/legacy) 位于 `Kling 3.0 & 3.0 Omni` 目录，模型枚举包含 `kling-v3`；`std` 定义为 720P，`sound` 支持 `off`。因此匹配普通 Kling 3.0 的无声 720P 行，不匹配 Turbo、Omni 或 Motion Control。[官方更新记录](https://kling.ai/document-api/apiReference/updateNotice?date=2026-02-11) 的 2026-07-15 条目说明新接口已支持 Kling 3.0，同时 Legacy API 继续可用。

### 套餐与单次成本

官方定价页的 `General (Trial Package)` 显示 100 视频 Units 套餐原价 $14、优惠价 $9.8、有效期 30 天；这是符合条件时的预购支出，不能当作单次调用最低消费。未查询登录后的余额充值最低金额，也未核实当前所有者是否享有该优惠，因此估算采用公开原价。默认展示的 `Flagship` 套餐仅适用 Kling 4.0 / 4.0 Flash，图片 API 的 Unit 汇率也不能用于此视频路径。[来源：官方 API 定价](https://kling.ai/dev/pricing)。

实施公式：`yuan = seconds * 0.084 * 7.2`。例如 5 秒原币费用为 `$0.42`，规划换算为 `¥3.024`；按现有规则向上取整为 303 分，增加 20% 预留后为 363 分。缓冲是平台规则，不是供应商加价。

### 复核证据与限制

公开抓取器有时只得到页面壳或默认 Unit 表，本次已实际打开页面并切换 `Balance`。短摘录：`Kling 3.0` / `No Native Audio` / `$0.084/s`。本机临时证据位于 `/tmp/loop-control-kling-pricing-balance-20261102.txt` 和 `/tmp/loop-control-kling-pricing-balance-20261102.png`；它们用于本次复核，不是仓库长期证据。价格适用本次固定的无声 720P 规格，后续如增加音频、分辨率或其他任务类型，应重新匹配价目。

## MiniMax H3

结论：国内 `api.minimax.cn` 的 `MiniMax-H3`、`768P`、单首帧可采用 **¥0.50/秒**；国际 `api.minimax.io` 保持 **$0.08/秒**。国内价格不是把国际美元价格换算成人民币。[国内官方定价](https://platform.minimax.cn/docs/pricing/overview) 与[国际官方定价](https://platform.minimax.io/docs/pricing/overview) 分别列出对应价格。

### 国内计费依据

国内表格的 `H3 系列旗舰模型` → `MiniMax-H3` → `768P`，输出视频为 `¥0.50/秒`。同页说明每次任务前 5 张输入图片免费；当前仅发送一张首帧且没有输入视频，故无需另加输入素材费用。相同模型、分辨率下，图生与文生任务单价相同。[来源：国内官方定价](https://platform.minimax.cn/docs/pricing/overview)。短摘录：`768P | ¥0.50`；`每次任务前 5 张免费`。

本地 `officialVideoBody()` 发送 `model: MiniMax-H3`、`resolution: 768P`，`content` 中为文本及一张 `role: first_frame` 图片，创建接口为 `/v2/video_generation`。[国内官方创建任务接口](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create) 使用相同域名和路径，明确列出 `MiniMax-H3` 的 `768P` / `2K` 规格及首帧输入。它不是价目中另列的历史 `MiniMax-Hailuo-02` / `MiniMax-Hailuo-2.3` 模型。

### 套餐、预购与估算边界

国内官方价格页说明按量计费从余额按实际用量扣费，视频资源包暂不支持 H3。因此不能将 Hailuo 资源包折扣套用到 H3。未核实登录后充值最低金额；充值金额也不属于一次生成的费用。[来源：国内官方定价](https://platform.minimax.cn/docs/pricing/overview)。

实施公式：国内 `yuan = seconds * 0.5`；国际 `yuan = seconds * 0.08 * 7.2`。例如 5 秒国内预估 250 分，增加 20% 预留后为 300 分。实际站点应取执行所用连接配置中的地区；不能仅凭连接版本的历史 Endpoint 推定地区。

后续若改为多张参考图、参考视频、2K、再生成或其他 H3 变体，需要分别增加适用输入费用或替换输出单价。本次只确认现有固定请求的费率，未验证供应商实际生成或最终账单。

## GPT Image 2

结论：可以将输出部分改为官方计算器算法，替换“平方图价格 × 像素比例”的旧外推；输入部分仍为保守预算。明确质量时能按所选尺寸计算输出 token，`auto` 质量取决于生成结果，调用前不能确认最终档位。[官方图片生成指南](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)。

### 输出计算

指南挂载的公开组件 `GptImageTokenCalculator.react.BWGLfw71.js` 提供 GPT Image 2 算法：低／中／高质量的长边网格分别为 16／48／96；短边网格由长边网格乘宽高比例并四舍六入五成双取整；输出 token 为 `ceil(长边网格 × 短边网格 × (2,000,000 + 宽 × 高) / 4,000,000)`。这里是计算器的输出估算公式，不是旧 GPT Image 模型 token 表。[官方页面](https://developers.openai.com/api/docs/guides/image-generation)、[本次页面所引用的计算器脚本](https://developers.openai.com/_astro/GptImageTokenCalculator.react.BWGLfw71.js)。脚本地址可能随文档发布变化，业务运行不依赖在线抓取。

复核点：1024×1024 的低／中／高质量分别为 196／1756／7024 输出 token；1024×1536 为 158／1372／5488；864×1536 为 120／1078／4312；1152×2048 为 157／1413／5650。横竖对调结果相同。

### 适用费率与保留部分

[官方价格页](https://developers.openai.com/api/docs/pricing) 的 **Standard → All models → gpt-image-2** 为图片输入 $8／百万 token、图片输出 $30／百万 token、文本输入 $5／百万 token。页面也有 Batch 半价表，抓取器可能只显示该隐藏模型的 Batch 行；项目直接调用 `/v1/images/generations` 或 `/v1/images/edits`，不应套用 Batch 的 $15 输出单价。价格页初始 HTML 的 Standard 组和官方输出计算器的每百万 $30 均已复核。

输出费用按上述 token × 张数 × 标准费率计算。文本 tokenizer 用量、参考图输入 token 和自动质量的实际选择仍无法在本次提交前确定，不能标成全额精确报价；继续明确预留输入额度。旧“每张参考图 $0.08”是本地 10,000 输入 token 的预算假设，不是官方按张计费。[GPT Image 输入说明](https://developers.openai.com/api/docs/guides/images-vision#gpt-image-model-inputs) 明确将其与普通视觉模型的图片 patch／tile 计费区分，不能借用视觉模型计算器补成确定费用。

例如明确高质量、1024×1536、单张、空提示词且无参考图的输出部分为 `5488 × $30/1,000,000 = $0.16464`；按 7.2 折算并向上取分约 ¥1.19，含 20% 余量建议 ¥1.43。真实请求还要计入实际文本和参考图输入。

## 实施结论

现有视频模型不再需要未核实的 ¥1/秒回退。Kling 3.0 标准无声 720P 和 MiniMax H3 国内 768P 已有匹配的公开 API 价格。GPT Image 2 输出已使用官方公式；其输入用量和自动质量仍保守，并在界面说明。其他已核实费率、金额可调整、20% 余量及系统上下限不变。
