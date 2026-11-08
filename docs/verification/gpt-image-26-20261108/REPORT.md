# GPT Image 2.6 与左侧候选栏验收

2026-11-08。按用户授权接入两个 2.6 型号，沿用当前连接和密钥，缩略图移到大预览左侧竖排；保留功能与数据。

## 实现

- 新增 `gpt-image-2.6-sunburst`、`gpt-image-2.6-flare`，保留 GPT Image 2 与四个 2.5 型号。注册目录、模型质量约束、网络校验和 Worker 共用精确型号列表。
- 沿用 `gpt-image2` 连接 v1，未新建连接或写入密钥；其模型范围未设置显式限制，按既有默认包含所有注册型号。
- 两款 2.6 提供自动、低、中、高、超高、最高质量，保留 PNG、参考图、已有尺寸及 1/2/4 张。planning complexity 沿用供应商默认 high；本次未扩展 SVG/GIF 等新输出能力。
- 本平台现有 GPT Image 2 估价公式不用于 2.6；沿用已有手动费用预留和确认窗口。Standard 文本输入/图片输入/图片输出费率显示为每百万 token $5/$8/$30，实际费用以供应商结算为准。
- 候选栏宽 48px，与大预览同高 260px，超出独立竖向滚动。图片完整显示，视频同样放左侧；操作栏在预览下方。保留候选编号、采用标记、环形等待、放大、首帧、采用/取消/备用等操作。
- 保留左右键和 Home/End，增加上下键循环切换；选中候选自动滚入视野。空候选无侧栏，不额外占宽。

## 验证

- 8 个单元/组件文件，143 项通过：供应商传输、网络型号校验、手动预留、模型切换、候选切换、环形等待和采用确认路径。新增 8 候选键盘用例验证上下键、左右键、首尾跳转、循环和焦点，不调用写入命令。
- 2 项隔离集成通过：两个 2.6 型号和原四个 2.5 型号均经过 Owner HTTP 确认、PostgreSQL 队列和真实 Worker 子进程。交替验证生成/参考图编辑、xhigh/max、task.model 与 executor.model 精确一致及 PNG 输出；工程未自动采用。供应商传输受控模拟，不使用真实密钥生成。
- 当前密钥只读 GET 模型目录返回 96 个型号，两个 2.6 ID 均存在。目录可读不等于真实付费生成验收，见 `provider-directory.json`。
- `npm run check`、`npm run build`、`npm run runtime:prepare` 通过。最后修正空预览方向文案后，重跑候选组件测试并以 Vite `emptyOutDir:false` 重建前端，保留已验证的固定后端发布物。保留现有大包提示、React 媒体组件 act 警告及 pg 查询弃用提示。
- 正式 5174 核对两款模型菜单和六档质量。1543×953、1152×790 下侧栏均为 48×260px，位于预览左侧，无页面横向溢出；5 候选 scrollHeight 为 430px，Home 滚至 0，向上循环至第 5 项滚至 170px。恢复第 4 项预览，未更改采用结果。
- 核对视频无候选空态及第二镜已有视频：侧栏 48×260px，保留“当前镜头画面 / 已采用”。关闭测试弹层，清除临时 viewport override，回到第一镜图片页。期间页面已有型号切换，最终保留 2.6 Flare；未点击生成、采用或保存。

## 日常更新与数据

新增迁移 `153-gpt-image-26-models.sql` 只扩展两个现有函数的精确型号白名单，带前置定义检查；保留队列确认、费用预留、重试、任务快照型号一致性及存储命名规则。旧迁移文件指纹全部校验通过。

迁移与重启前分别确认无 ready/running 任务和 Studio 子进程。迁移前数据库备份及原函数定义位于：

`/Users/dan/Programs/loop-control/.loop-control/local/backups/20261108-gpt-image-26/`

备份 3,741,605 字节，SHA-256 `5c879ecc04f7350a0e9d9555c60490f93238d83aacca97f61527d2c3d75c4536`，pg_restore 目录校验通过。Owner 自动备份原本关闭；迁移使用已建立的本次数据库备份，不重复媒体备份。

已应用迁移 153，日常后端由 `8fff5e88ec3c` 更新至 `5a80b0f35caa`；源差异仅 `imageGeneration.ts`、`registeredAdapters.ts`、`workspaceCallEstimate.ts` 三个文件。5174 HTTP 200，运行版本与准备产物一致，旧发布物保留。

更新前后九类表的数量及完整行 SHA-256 一致：3 个生产单、19 个素材修订、2 个音轨、11 个任务、3 个工程、26 个视觉候选、0 个音频准备、19 个连接版本、18 个密钥绑定。保留第一镜已存在的占位状态及同期已增加的候选。见 `daily-before.json`、`daily-after.json`。

未付费生成，未提交、推送或覆盖其他未提交工作。修改前本次文件保存在聊天可视化目录的 `gpt-image-26-vertical-baseline/`。

## 来源

- [Sunburst 官方模型说明](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst)
- [Flare 官方模型说明](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)
- [生成参数](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [图像生成指南](https://developers.openai.com/api/docs/guides/image-generation)

界面证据：`model-menu.jpg`、`sunburst-settings.jpg`、`flare-settings.jpg`、`vertical-rail.jpg`、`narrow.jpg`。
