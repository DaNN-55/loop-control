# 设置与调用边界覆盖

2026-11-09，注册目录 7 个图片模型、13 个视频模型；另有 Pexels 视频检索、Freesound 音乐／音效检索。用户连接当前启用 7 个图片与 6 个视频模型。未改用户连接、启用列表、默认模型或速度策略。

| 界面设置 | 实际落点 | 验证 |
|---|---|---|
| 图片连接、7 个模型 | selection → connectionVersionId → 冻结执行身份 → OpenAI model / Authorization | Owner HTTP 集成、在线逐模型 |
| 5 种比例×标清／高清（10 个尺寸） | settings.size → size | 2,400 组真实网络边界组合 |
| 图片质量 auto/low/medium/high；2.5/2.6 另有 xhigh/max | settings.quality → quality，按模型约束校验 | 同上 |
| 图片 1/2/4 张 | settings.count → n → 返回数量校验 → 分别登记候选 | 同上＋4 张 Owner/Worker 集成 |
| 图片参考图、用途、保留／允许改变、主体构图、裁切保护、字幕留白 | reference IDs 校验与冻结 → /images/edits 的 images；语义构图项加入 actualPrompt | 有／无参考的组合、实际冻结文本与发出文本一致集成 |
| 视频连接、每个模型、提示词 | selection → 冻结连接与模型、合并账号／系列规则 → 供应商 model/model_name 与 prompt/content | 13 模型真实 Owner HTTP／Worker、所有模式 |
| 首帧／首尾帧／参考图／参考视频 | 注册模式约束 → visualInputs → 供应商对应字段／角色 | 首尾帧、参考上限、inline MP4、HTTPS、asset ID 和不支持字段；修复 Kling 首尾帧拦截 |
| 首帧完整保留／居中裁切 | firstFrameComposition → 本地 FFmpeg pad／crop → 冻结首帧 PNG | 现有视频集成及代码核对；是本地预处理 |
| 时长、跟随主声 | durationSeconds／providerDurationSeconds → provider duration；固定时长模型省略 duration | 620 组百炼组合与其他模型最小／最大值；实际声轨窗口集成 |
| 百炼分辨率、声音、扩写、结构、水印、种子、负面词 | parameters.resolution/size/audio/prompt_extend/shot_type/watermark/seed 与 input.negative_prompt | 620 组合法组合＋各模型 Owner HTTP 冻结／网络边界 |
| 其他供应商规格 | 当前支持的 720p／768P、无声、固定模式在供应商序列化器中写入 | 模式边界与在线最小规格；界面未开放的规格不冒充已接入 |
| 参考素材输出比例 | 时间线比例 → referenceRatio → Wan size／Kling Omni aspect_ratio | 三种比例边界、Wan 竖屏请求体断言 |
| Freesound 来源、连接、检索词、目标时长、候选顺序 | search query/filter(duration)/sort/fields/page_size；选择不同预览结果 | 在线真实搜索＋Owner/Worker 音效、候选、默认来源集成 |
| 配乐用途、音效时间线位置／跟随镜头、偏移、采用时长、音量、淡入淡出、压低配乐 | 本地准备与剪辑工程字段、裁切及混音；不伪装成供应商生成参数 | 音效定位／开关／候选／默认设置集成 |
| Pexels 搜索、预览和采用 | 冻结 query 与 targetDurationSeconds → 视频搜索 → 候选下载，采用由本机处理 | 真实在线搜索；已有检索与候选回归 |

图片/视频语义说明通过提示词或本地预处理实现，不能理解为供应商的独立精确控制参数。未付费穷举所有参数组合；收费仅逐模型最小规格一次，组合使用替身响应但通过项目实际校验、网络准入和序列化边界。

## 执行文件

- `src/worker/modelSettingsBoundary.test.ts`：2,400 个图片组合、620 个百炼组合、所有官方视频模式和参考数量上限。
- `src/local-app/modelSettings.integration.test.ts`：13 个视频模型，包含确认、真实 HTTP、数据库、Worker 与真实网络准入；额外验证 5 秒任务收到 4 秒产物时保留具体错误及供应商任务号。
- 既有 `gptImage25/26`、`workspaceImageGeneration`、`workspaceImageInputEstimate`：图片所有身份、质量、参考图、估价快照和真正发出的请求一致。
- `live.test.ts`／`finish-live.mjs`：显式 opt-in 的在线样本；原任务恢复禁止 POST，有持久化费用与任务记录；已有账本禁止重跑首轮。
