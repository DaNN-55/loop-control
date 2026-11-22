# 播放器与片段选择对比

交付：[独立 HTML](../media-playback-comparison-20261122.html)。可直接打开；日常 Vite 地址为 `http://127.0.0.1:5174/docs/prototypes/media-playback-comparison-20261122.html`。

- 左侧直接使用当前仓库的 `VideoPreview`、`ImagePreview`、`AudioPreview` 与 `WorkspaceAudioAudition` 两种布局。裁剪数字字段明确标为示意，不连接业务命令。
- A：当前已安装的 Video.js React 10.2.0，演示音视频共用一套控制栏，进度/音量/全屏、图片放大、双端拖动选区和按选区播放。推荐在现有依赖上统一。
- B：Media Chrome 4.19.5 的真实音视频 Web Components，同样接入选区。为比较保留其深色控制外观，注册简体中文翻译。
- 两套图片均复用当前图片放大组件。播放器套件不是图片编辑器；图片编辑/转码/导出不在此演示中。
- 素材为本次用 FFmpeg 合成的 8 秒渐变视频、低音量和弦、实际抽帧和波形，另有代码绘制的模拟图片；全部内嵌，无业务数据、API 请求和远程媒体。
- 选区是演示交互，仅控制本地播放，未接入正式裁剪保存或生成。前后端、`package.json` 和锁文件没有新增播放依赖。浏览器自带控件和项目现有库的能力保持原样。

重建：在仓库根运行 `node docs/prototypes/media-playback-comparison-20261122/build.mjs`。需要现有 Node/FFmpeg/esbuild；构建脚本把固定版本 Media Chrome 安装在系统临时目录，不修改正式依赖。生成的素材/中间文件被本目录 `.gitignore` 排除。HTML 内保留第三方打包许可注释；Video.js 为 Apache-2.0，Media Chrome 为 MIT。

官方依据：[Video.js Audio](https://videojs.org/docs/framework/react/reference/api/preset-audio)、[Media Chrome](https://www.media-chrome.org/docs/en/get-started)。版本按当前本地项目/本次固定包核验，不因官网更新自动升级项目。
