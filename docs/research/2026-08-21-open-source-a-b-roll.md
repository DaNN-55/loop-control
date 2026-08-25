# 开源 A-roll / B-roll 工具初查

## 结论

当前“测试生产单-1”的阻塞不是 B-roll 配置问题，而是：

- A-roll：`a_roll_retries_exhausted`，Worker 使用的 `video-generation-v1` / 当前账户运行环境不支持。
- 前置产物：`input_artifacts_invalid`，Episode 目录未挂载或不存在。
- 页面显示的 3 个阻塞项中没有 B-roll 阻塞项。

## 工具

| 工具 | 适合位置 | 是否能先不接付费 MCP | 注意 |
| --- | --- | --- | --- |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | 端到端编排：素材检索、脚本、分镜、B-roll、剪辑、渲染 | 可以，仓库列出了 Piper、开放素材库、Remotion、FFmpeg 和本地模型路线 | AGPLv3；部分云端生成器仍会产生费用，运行前应审查代码 |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | 本地可视化/ API 编排视频模型 | 可以，本地运行 | 更像模型工作台，不是完整生产单；需要自己维护 workflow |
| [Wan2.1](https://github.com/Wan-Video/Wan2.1) | 本地 T2V/I2V、视频编辑、VACE，适合生成 B-roll | 可以 | 官方说明 T2V-1.3B 约需 8.19GB VRAM；质量、速度和显存要按机器实测 |
| [LTX-Video](https://github.com/Lightricks/LTX-Video) | I2V、V2V、视频延展和多条件控制，适合短 B-roll | 可以，支持本地推理和 ComfyUI | 官方仓库标注 Apache-2.0；本地推理仍需要合适的 CUDA/MPS 环境 |
| [HunyuanVideo](https://github.com/Tencent-Hunyuan/HunyuanVideo) | 高质量本地生成/编辑 | 可以 | 原始官方实现的显存门槛很高：文档给出最低约 45GB、推荐 80GB NVIDIA GPU，不适合作为当前 Mac Worker 的第一选择 |
| [Fennec Search](https://github.com/JasonMakes801/fennec-search) | 给已有素材库做自然语言、画面、人物和语音检索，适合检索式 B-roll | 可以，本地 Docker + pgvector | MIT；官方 README 还标注约 10GB 模型磁盘空间 |
| [Remotion](https://www.remotion.dev/) / [MoviePy](https://github.com/Zulko/moviepy) | 把 A-roll、B-roll、字幕、音频组合成可复现成片 | 可以 | 它们是编排/渲染层，不负责生成素材；Remotion 的自动化商业许可要看团队规模和当前条款 |

## 对 tk-workflow 的建议

第一阶段不要把“生成模型”直接塞进生产单。先把现有 `generate_b_roll` 适配器做成可替换的本地 Worker：

1. 先用 Fennec Search 或简单的 FFmpeg 预览索引，从开放/自有素材中检索真实 B-roll。
2. 合成继续复用当前的本地渲染链；Remotion/FFmpeg 负责时间线、字幕和音频。
3. 需要生成式 B-roll 时，再把 Wan2.1 1.3B 或 LTX-Video 接到独立本地适配器，先离线生成并验证文件、时长、编码和路径，再回写生产单。
4. A-roll 先修复 Worker 的模型/账户运行环境和 Episode 目录挂载；不要通过蓝图字段或付费 MCP 掩盖这两个根因。

## 安全和许可

- 不要从 [Open-Montage/OpenMontage](https://github.com/Open-Montage/OpenMontage) 安装；同名仓库的安全风险已在 [calesthio/OpenMontage 的 issue](https://github.com/calesthio/OpenMontage/issues/200) 中被提醒。
- “开源代码”不等于所有素材或模型输出都可任意商用；素材来源、模型许可和平台条款仍需分别记录。
