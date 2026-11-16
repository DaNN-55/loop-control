# 生产模板与 OpenChatCut 能力建议

> 本文保留实施前的只读核查事实。2026-11-16 的落地能力、兼容字段与实际导出验收见 [配置约定](../../verification/template-settings-20261116/FORMAT.md) 、[实施报告](../../verification/template-settings-20261116/REPORT.md) 和 [逐字段接入清单](../../verification/template-settings-20261116/FIELD-STATUS.md)；下文“尚未落地”不再代表修复后的状态。

日期：2026-11-16  
范围：只读核查当前生产脚本模板、请求快照、OpenChatCut v3 native SDK 与适配层；本报告不修改产品代码。SDK 核查根目录为 `.loop-control/local/OpenChatCut`，不是以 `OPENCHATCUT_ROOT` 环境变量是否存在为判断条件。

## 结论

当前模板适合保存“整片默认值 + 段落制作意图”，但“脚本可解析”不等于“v3 原生时间线稳定落地”。建议分三层：

| 类别 | 当前可执行建议 | 依据与边界 |
|---|---|---|
| 可直接做（仍需显式确认） | 画幅、字幕开关/样式/位置、旁白、BGM、唯一素材引用，以及当前已验证的 `cut`/`fade` 淡入淡出 | 脚本字段和校验见 `src/reviews/productionScript.ts:3-23,51-79,151-188`；当前应用见 `src/worker/scriptRenderSettings.ts:4-28`。但本次生产中要求的字幕每行 14 字曾被默认值 16 覆盖，音效起点也需手工调整；行数/字数和 SFX 精确时序在 v3 中冻结前不能称为自动稳定能力。 |
| SDK 已支持、当前适配需补齐 | 原生 `TransitionItem`、段落级 transform/裁切/旋转、zoom、keyframes、滤镜、GL 特效、LUT、音轨路由 | SDK 的真实 v3 schema 见 `.loop-control/local/OpenChatCut/src/editor/timelineTypes.ts:24-62`、`clipTypes.ts:103-190`、`transitionTypes.ts:109-127`；但 Loop-Control 生成时间线仍以通用记录承载，且明确写 `transitions: []`（`src/worker/openchatcutProject.ts:31-45,240-270`），`scriptRenderSettings` 只应用合成设置和 SFX（`src/worker/scriptRenderSettings.ts:6-24`）。 |
| 不宜直接暴露 | `custom-shader`、任意插件参数、未验证的转场/FX/LUT ID、按 ID 直接指向外部素材、依赖编辑器私有 schema 的字段 | SDK 虽支持 GL FX/LUT（`src/gl/fx/uniforms.ts:30-57,78-109`；`src/gl/fx/effects.ts:17-47`），自定义定义必须随 `TimelineState.fxDefs` 快照才能刷新/无头导出自洽；未知 ID、版本迁移和实际渲染尚未由本适配层合同保证。 |

## 已安装 v3 native SDK 的实际能力

- `TimelineState` 原生有 `transitions?: TransitionItem[]` 和可持久化的 `fxDefs`；`TimelineItem` 原生有 `transform`、`keyframes`、`filters`、`zoom`、`effects`（`.loop-control/local/OpenChatCut/src/editor/timelineTypes.ts:24-62`；`clipTypes.ts:103-190`）。这证明 SDK 能保存这些能力，不证明当前模板已能提交它们。
- 转场不是自由字符串：`TransitionItem` 要绑定相邻 item、track、帧长及可选方向；内置库含 CSS fallback、GLSL 转场、音频 cross-fade 和 custom shader（`transitionTypes.ts:3-32,109-127`）。
- FX/LUT 有属性范围校验；`.cube` 缺失时运行时将强度置零（`src/gl/fx/uniforms.ts:59-68,87-96`）。当前 SDK 资源库确有 `.loop-control/local/OpenChatCut/assets/luts/` 下的 LUT 文件，但模板仍应写稳定的版本化 assetId，而非裸路径。
- 预览与导出不完全同一表现：选中转场在 Player 使用与导出相同的 `GlTransition`，其他转场保留 CSS approximation；不可纹理素材或缺少 custom shader 会显式 fallback（`TimelineComposition.tsx:164-180`）。`transparent=false` 的预览还使用 GRID 背景（`TimelineComposition.tsx:297-299`），棋盘格不能当作交付视频语义。
- 本次核查读取了已安装 SDK 的源码、资源和类型定义，没有执行保存→重开→headless 导出的现场回归；因此上表的“需适配”是 schema/适配层证据，“可稳定渲染”仍须真实工程验收。

## 整片与段落的边界

- 整片默认值放在 `## 制作设置`；段落覆盖值放在 `### 段落 NN`。`segmentSettings()` 的合并顺序是“传入系列/运行默认值 → 脚本整片设置 → 段落设置”，后者覆盖前者（`src/reviews/productionScript.ts:194-196`；`src/reviews/productionPlan.ts:35-42`）。
- 模板中的 `默认` 表示不覆盖上层值，不是一个实际素材或数值；空字段会被拒绝（`src/reviews/productionScript.ts:145-146`）。
- 解析器允许段落写 `转场`、`构图`、字幕行数/字数等字段，但当前渲染提示只对段落 `音效素材/起点/时长` 做逐段应用；整片合成设置只映射画幅、字幕、音量和 `cut`/`fade`，且生成的 v3 timeline 仍是 `transitions: []`（`src/worker/scriptRenderSettings.ts:7-28`；`src/reviews/productionPlan.ts:36-42`；`src/worker/openchatcutProject.ts:240-270`）。因此“模板已保存”不等于“原生时间线已执行”。
- 本次实际生产已暴露继承缺口：14 字字幕设置被默认 16 覆盖（随后通过 SDK 文档写入改成 14，证据 `docs/verification/repo-cleanup-production-20261115/production/96774cd7-1fff-4feb-b03c-c3568bb2e718-caption-template.json:3-34`），SFX 偏移需要手调。模板若要承诺这两项，必须在 v3 workspace/project 中写入并回读冻结值，禁止静默回退。
- `studio` 是工作台/准备契约中的衔接模式，不会被 `productionCompositionSettings()` 转成普通渲染设置；应由镜头准备与原生工程确认，不要在模板中把它当成普通转场效果。

## 素材引用、版本和未知值

- 模板素材字段只接受名称/别名，不接受文件路径；`无` 会转为 `none`（`src/reviews/productionScript.ts:34-41`）。
- 解析优先当前生产单，再回退到同系列；按名称/别名去重后，0 个匹配为 `missing`，多个匹配为 `ambiguous`，只有唯一绑定才进入执行（`src/reviews/productionPlan.ts:17-32`）。建议模板写稳定的人类可读别名，提交前要求界面解决歧义。
- 参考图 ID、参考提示词 token 和当前生产单归属会在请求边界校验；无效 ID、重复 ID、跨生产单素材或未知 `@图片N/@视频N` 应拒绝，不应静默降级（`src/local-app/workspaceVisualRequest.ts:37-58,97-100`；`src/promptReferences.ts:16-29`）。
- 建议记录模板版本、SDK 版本、素材 revision/sha256 与实际采用决策；不要把供应商模型的私有字段直接写入用户模板。

## 短模板示意

下面示意现有可解析字段；是否实际应用仍须回读工程。动画、LUT 和任意特效暂不放入当前模板：

```markdown
# 乔迁送礼

## 制作设置
- 模板版本：3
- 画幅：9:16
- 字幕：开启
- 字幕样式：cinematic
- 字幕位置：bottom-center
- 字幕最大行数：2
- 每行最大字数：14
- 转场：cut
- 背景音乐素材：乔迁-BGM-01

## 正文
### 段落 01
- 口播：先让新家的第一面墙，保持干净完整。
- 画面提示：新居客厅空墙，保持墙面全程空白，镜头轻缓。
- 画面来源：视频
- 构图：full
- 音效素材：轻柔开门声-01
- 音效起点（秒）：0.8
- 音效时长（秒）：1.2
```

示例中的字幕字数和音效时间是待冻结的制作合同，不是当前适配层已自动落地的保证；交付前须检查原生 v3 文档和最终导出。

英文可以作为用户填写的 `画面提示` 原文保存；它不是模板自动翻译能力，也不应隐藏为“系统翻译”。

## “制作提示词”与“实际提交提示词”

两者是有意分开的审计字段：

1. `制作提示词`是用户/制作人员输入的原始 `prompt`，用于保留创作意图。
2. `实际提交提示词`是请求前将参考素材 token 解析为供应商格式，再拼接图片 brief、账号规则和系列规则后的 `actualPrompt`。图片与视频都在请求解析阶段生成它，并按供应商限制校验长度（`src/local-app/workspaceVisualRequest.ts:58-62,97-101`；`src/imageGeneration.ts:42-61`；`src/creativeAccountRules.ts:26-36`）。
3. 请求快照同时保存两者，读模型和 UI 只在二者不同的时候显示“实际提交提示词”（`src/local-app/workspaceVisualCandidates.ts:36-49`；`src/local-app/WorkspaceVisualRecord.tsx:34,37`）。

本次乔迁首镜的英文内容在生产证据中确实作为英文 `prompt/actualPrompt` 提交（`docs/verification/repo-cleanup-production-20261115/production/2026-11-15T16-08-44.679Z/local_identity-workspace_visual_candidates.json:1718,1782`）。当前代码没有自动翻译路径：它只做 token/引用解析和规则拼接。因此按本轮制作记录，这是为修复模型幻觉而手动改写的英文提示词，不是系统自动翻译；代码证据能证明“英文被提交”，不能单独证明操作者身份。

## 建议的落地顺序

1. 先修正继承合同：生成 v3 workspace 前冻结字幕行数/字数、SFX start/duration 和素材 revision；保存后回读比较，不允许默认值静默覆盖。
2. 若要模板化转场、缩放/动画、滤镜/FX/LUT，先定义项目自己的小 schema，再映射到固定 OpenChatCut 版本的 `TransitionItem`/`TimelineItem`；保存、重开、headless render 和关键帧验收通过后才开放。
3. `custom-shader`、插件参数和裸 LUT/素材路径暂不暴露；仅允许版本化 assetId、范围校验、未知 ID 阻断，并验证 `fxDefs` 快照可在刷新/无头导出时自洽。
4. 模板优先级保持“整片默认 < 段落覆盖 < 工作台人工确认/原生手动修改”。交付前以冻结原生工程和最终 MP4 为准，不用模板文本反推画面已经执行。

