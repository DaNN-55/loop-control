# @ 引用接线复核 · 2026-11-09

已验证 22 个型号、33 条模式路径；修复可灵 Omni 缺少原生标签转换的问题。全部使用隔离数据库、合成素材和受控 fetch，真实供应商请求与费用均为 0。日常 5174 已更新，运行后端版本见 runtime.json。

| 模型 | 型号数 | 已验证路径数 | 传给模型的指代 |
| --- | ---: | ---: | --- |
| OpenAI 图片 | 7 | 7 | 参考图 N，并附同序图片数据；这是提示词语义，没有独立 mention API 字段 |
| MiniMax H3／Highspeed／Lite | 3 | 9 | 参考模式 `<Picture N>`／`<Video N>`；首尾帧模式按首帧、尾帧指代 |
| Seedance | 2 | 6 | 参考模式 图片N／视频N；首尾帧按角色指代 |
| Kling v3／v3 Omni | 2 | 3 | Omni `<<<image_N>>>`／`<<<video_N>>>`；普通首尾帧按角色指代 |
| 万相 | 8 | 8 | r2v 使用 characterN，依 reference_urls 的整体顺序；其余使用首帧图像 |

完整型号和路径见 [matrix.json](matrix.json)。

## 缺口与修复

原可灵 Omni 会把 `@图片1`、`@视频1` 改成“参考图 2”“第 1 段参考视频”，没有转换成供应商的原生标签。失败回归得到同样结果，已补充 Kling 参考模式转换。混合输入 B图、V视频、A图时，绑定 A 的 `@图片1` 现在转换成 `<<<image_2>>>`，绑定 V 的 `@视频1` 转换成 `<<<video_1>>>`。

## 验证边界

- 63 项 UI／引用回归通过：逐型号、逐模式从实际提示词字段插入引用，断言命令携带正确 token、素材 ID 和输入角色。
- 18 项隔离测试通过：实际 Owner HTTP 确认、冻结队列、真实 Worker 和供应商网络边界。15 个视频型号覆盖所有已注册模式，7 个图片型号分别执行；比对最终请求中的模型、文字、角色、URL 和图片／视频字节。
- 两张内容不同的合成图片及一段视频按 B、V、A 顺序提交，验证独立图／视频编号，以及万相整体角色顺序；首尾帧同时验证两份不同图片。
- 已覆盖无绑定、引用已移除、重复 token、类型不符及保留普通邮件文本。HTTP 缺失素材返回 400；未发生成请求。
- 类型检查、构建与运行准备通过。运行中后端实际加载的编译模块已检查，可灵重排样本输出 `<<<image_2>>>`，活动队列 0、HTTP 200。

测试证明请求接线与素材对应关系；本轮未验证真实供应商的出片质量或服务可用性。可灵和 Seedance 没有发起线上调用。

## 协议依据

- [MiniMax 官方提示词参考](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt)：Picture／Video 标签按媒体类型独立编号。
- [可灵官方 Omni API](https://kling.ai/document-api/api/video/o1/video-omni/legacy)：image／video 原生标签。
- [万相官方 r2v API](https://www.alibabacloud.com/help/en/model-studio/legacy-wan-reference-to-video-api-reference)：characterN 对应 reference_urls 的顺序。
- [Seedance 官方指南](https://docs.volcengine.com/docs/ark/seedance-2-0-prompt-guide?lang=zh)：按图片／视频输入顺序指代。

证据：integration.log、ui-unit.log、types.log、build.log、isolated-run.json、runtime.json。隔离测试容器已自动删除，未修改生产单或提交／推送代码。
