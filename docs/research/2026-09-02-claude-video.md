# claude-video（`/watch`）仓库核验

核验日期：2026-09-02。范围仅限仓库维护者提供的 README、技能契约、源码、测试、发布配置与许可证；未安装、未执行下载或调用第三方 API。

## 结论

[`bradautomates/claude-video`](https://github.com/bradautomates/claude-video) 不是视频生成工具，也不是独立的视频理解云服务；它是一个让 Claude Code、Codex 等 Agent 通过 `/watch` **获得视频输入能力**的可安装 Skill。它把 URL 或本地视频转成“带时间戳的字幕/转写 + 一组 JPEG 帧”，再由宿主 Agent 读取这些帧并回答问题。[技能契约](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/SKILL.md)将这一流程写成明确的执行规则。

适合把公开视频、课程、产品发布视频或本地录屏变成可询问的内容，特别是“某时刻屏幕发生什么”“界面何时出错”“总结视频并保留视觉证据”这类问题。它不能保证逐帧、长视频或受登录/地区限制内容的完整理解，也不会绕过平台权限。

## 输入、输出与实际工作流

| 环节 | 实际行为 |
| --- | --- |
| 输入 | 一个 `http(s)` 视频 URL，或本地路径；本地常见扩展名包括 `.mp4`、`.mov`、`.mkv`、`.webm` 等。[`download.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/download.py)的 `is_url` 与 `resolve_local` 是实际入口判断。 |
| 字幕优先 | 对 URL 先用 `yt-dlp` 拉取人工/自动字幕（仅请求 `en.*`、VTT）；若 `--detail transcript` 且成功得到字幕，不下载视频。[`download.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/download.py)；[`watch.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/watch.py)。 |
| 视频与帧 | 需要视觉信息时，最多以 720p 下载视频，再用 `ffmpeg` 生成 JPEG。`efficient` 取关键帧；`balanced`/`token-burner` 做场景变化采样，并去除近似重复帧。[`watch.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/watch.py)；[变更记录](https://raw.githubusercontent.com/bradautomates/claude-video/main/CHANGELOG.md)。 |
| 无字幕时的音频 | 提取单声道 16 kHz、64 kbps MP3，上传到 Groq `whisper-large-v3`（优先）或 OpenAI `whisper-1` 换取分段时间戳转写；长音频会切块。实际 API 地址和上传逻辑见 [`whisper.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/whisper.py)。 |
| 输出 | 命令行输出工作目录、帧文件路径与时间戳、转写文本和来源；随后由 Agent 的图片读取能力逐帧读取 JPEG，再结合转写回答。它输出的是分析素材，不是编辑后的视频文件。[`watch.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/watch.py)；[`SKILL.md`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/SKILL.md)。 |

## 如何运行

- Claude Code：仓库 README 给出的方式是添加 marketplace 后安装 `watch@claude-video`。
- Codex、Cursor、Copilot、Gemini CLI 等：`npx skills add bradautomates/claude-video -g`，去掉 `-g` 则只装到当前项目。[README 安装说明](https://raw.githubusercontent.com/bradautomates/claude-video/main/README.md)
- 运行时必需 `python3`（Windows 为 `python`）、`ffmpeg`、`ffprobe`、`yt-dlp`。macOS 的首次安装脚本会调用 Homebrew 安装缺失二进制；Linux/Windows 只打印相应安装命令。[`setup.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/setup.py)
- 有原生字幕的公开视频可不配 API key；本地视频或没有字幕的来源，要得到语音转写则需 Groq 或 OpenAI key。密钥从环境变量、`~/.config/watch/.env` 或当前目录 `.env` 读取。[`whisper.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/whisper.py)

常用控制项是 `--start/--end`（聚焦片段）、`--detail transcript|efficient|balanced|token-burner`、`--timestamps`（强取指定时间点）、`--max-frames`、`--resolution` 与 `--no-whisper`。完整参数定义在 [`watch.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/scripts/watch.py)。

## 成熟度与限制

- 这是一个版本为 `0.2.0` 的开源 Skill，初始 marketplace release 是 2026-04-24，最新变更记录为 2026-06-29；并非稳定 API 或托管产品。[`CHANGELOG.md`](https://raw.githubusercontent.com/bradautomates/claude-video/main/CHANGELOG.md)
- 项目包含针对本地合成视频的 pytest 测试，覆盖 detail 路由、关键帧/场景采样、去重和回退行为；仓库发布工作流在 tag 推送时只构建并发布 `.skill` 包。我未执行这些测试，也未找到该发布工作流中的测试步骤。[`tests/test_watch.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/tests/test_watch.py)；[`tests/test_frames.py`](https://raw.githubusercontent.com/bradautomates/claude-video/main/tests/test_frames.py)；[`release.yml`](https://raw.githubusercontent.com/bradautomates/claude-video/main/.github/workflows/release.yml)
- 默认 `balanced` 模式受 100 帧上限约束，`efficient` 受 50 帧上限约束；视频超过约 10 分钟会被稀疏采样。`token-burner` 解除帧上限，但相应提高图像 token 成本；所有模式的采样速率不超过 2 fps。因此它适合定位和概览，不等同于逐帧取证。[`SKILL.md` 的推荐限制](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/SKILL.md)
- 它只能处理 `yt-dlp` 能取得的公开资源。仓库明确要求下载失败（包括登录或地区限制）时直接告知，且实现未包含登录、cookie 或账号访问。[`SKILL.md` 的失败与权限边界](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/SKILL.md)
- 隐私边界：视频本身不上传给 Whisper；但在“无字幕且启用 Whisper”时，提取出的音频会上传到 Groq 或 OpenAI。下载视频、帧、音频和中间转写会写入系统临时目录（除非指定 `--out-dir`），需要在分析后清理。[`SKILL.md` 的安全与权限说明](https://raw.githubusercontent.com/bradautomates/claude-video/main/skills/watch/SKILL.md)
- 许可证是 MIT，允许使用、修改和分发，但按原样提供且不附担保。[LICENSE](https://raw.githubusercontent.com/bradautomates/claude-video/main/LICENSE)

## 适用与不适用

| 建议使用 | 不建议把它当作 |
| --- | --- |
| 公开视频的结构总结、开场/卖点拆解、关键时刻问答 | 视频生成、剪辑、字幕烧录或导出成片工具 |
| 本地产品录屏或 bug 复现视频的界面诊断 | 需要逐帧、无漏帧证据的审计/取证流程 |
| 只想先读字幕的长视频：`--detail transcript` | 受账号、付费墙、DRM、地域限制的视频访问方案 |
| 针对已知时段复查：`--start/--end`，减少 token | 可将私密音频无条件留在本地的方案（无字幕时须关闭 Whisper，或接受音频上传） |

## 对本项目的判断

如果目标是把公开参考视频或本地录屏交给 Agent 做一次性分析，这个 Skill 已经覆盖下载、转写、抽帧和上下文交接，不需要在本项目再造一套视频理解管线。若以后要把它纳入可重复的生产工作流，应先对目标平台的下载授权、API 音频外传边界、长视频 token 预算与本机 `ffmpeg`/`yt-dlp` 安装策略逐项验收；本次仅完成代码与文档核验，未进行安装或真实视频试跑。
