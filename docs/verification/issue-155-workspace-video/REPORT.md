# #155 / T03 验证记录

2026-10-29，在独立工作树 `codex/t03-workspace-video-152` 实现。视频准备现支持一源多引用、一镜多来源、稳定实例 ID、精确源帧区间、锁长及 ±1 帧；删除引用不删除原片。只改指定初稿镜头，原生人工编辑后不允许旧准备表单覆写。

## 证据

- TDD 首个 Owner HTTP 测试先返回 400（命令尚不存在），实现后通过；锁长 helper 与组件接缝先因模块缺失失败，实现后通过。
- 真实 Owner HTTP、随机独立 PostgreSQL、真实本地材料注册、OpenChatCut 启动/读取/保存、原生 `/export` MP4。所有 DDL/DML/Worker 资源只属于隔离夹具；只读借用已安装运行时，没有日常数据库写入、Keychain 或付费调用。
- `evidence/landscape.mp4` / `portrait.mp4`：0.5s 红色、1.5s 绿色、2.5s 蓝色，分别对应横版原片 `[0,30)`、竖版原片 `[30,60)`、同一横版原片 `[60,90)`。640×360 和 360×640；各 JSON 记录实际像素、source SHA、item ID 和帧值。
- 源横版 SHA 保持 `7328eafc62fad1f3537bc91fccb097bcb19698427e7bee0badae74334bc64ba6`；竖版 SHA 保持 `97b1552e7f98b3819d89e303bddd8f4b4d24f479f008a8b54f63a119457008be`。删除引用后源字节仍在，另一镜头完整 item 未变化。
- `evidence/one-frame.mp4` / `.json`：锁长起点 59→60，输出首帧从红区间进入蓝区间，视频流恰为 30 帧/1 秒。MP4 的 AAC 尾填充使容器时长约 1.045s，锁长以真实视频帧验证。
- Owner/CSRF/Origin、失效 revision、跨镜 clip ID、错误材料类型、越界/非整数/零帧、重复引用、材料篡改及活动 Studio 均验证拒绝。模拟原生 store 已持久化的人工作品后，真实 Owner 保存使准备入口 409，其他镜头 transform.x=17 保留。
- 实际浏览器通过上传控件注册原片、锁长、起点 +1、保存、刷新恢复；`preparation-1280.png` / `preparation-800.png`。800 宽 `documentElement.scrollWidth=800`，帧字段实际宽 66px。准备页视觉已实看；本票没有宣称 iframe 中人工编辑操作已由浏览器完成，整合原生 bridge 的实际交互由 root/T10 最终验收。

## 检查与取舍

本票复用现有不可变快照/绑定/版本表，不引入无用途的 085 表或依赖。锁长为控件动作语义，不禁止原生手动裁切。最终交付 readiness 与音频/构图不由本票放宽。

单次 Impeccable detector 对现有 CSS 的旧颜色/10px 字号给出 advisory，没有本票新增的阻塞。检测到 DESIGN.md 的旧 sidecar 已过时，未扩展本票更新设计系统。

最终合并基线、完整回归及构建结果见后续补录。
