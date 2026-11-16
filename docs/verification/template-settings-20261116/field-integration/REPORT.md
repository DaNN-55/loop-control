# 模板剩余字段接入与日常验收

2026-11-16。接入本次授权的全部预填/引用字段，保留人工修改；v2 当前写入退役，历史读取保留。没有提交或推送。

## 行为

- 画面提示 → 图片提示词；视频提示词 → 视频输入，省略时回落画面提示。已有人工草稿，包括主动清空，优先于模板。
- 旁白音色、语言、语速按整片→镜头继承预填；已保存设置优先。模型不兼容时明确提示，不静默替换音色或截断语速。
- 素材名称、配乐、音效、封面按当前生产单最新素材名称/别名解析，唯一匹配预选；缺失或同名不同内容提示人工选择。不自动采用、不跨生产单猜测。
- 费用预留只预填视频调用确认弹窗，人工最终金额优先，仍执行模型金额范围校验。
- 封面预选后需点击使用；提交交付再次核验同一候选 revision/SHA 和原文件。
- 当前新建/修订脚本仅接受 v3；v3 旧专用字段连空值/默认也拒绝。历史 v2 解析、已保存计划与旧工程/交付保留，不批量改写。

完整逐项状态见 [FIELD-STATUS](../FIELD-STATUS.md)，格式边界见 [FORMAT](../FORMAT.md)。备注、必须/禁止出现仍不自动拼入生成请求；LUT/特效等不在本次范围。

## 日常服务实际验收

独立验收生产单：`77aef7b5-090e-499d-ba2b-20238fc03bf0`，工作区 `472035e9-d4fd-497e-b1ff-5a14cf26dec6`。全部使用用户登录后的正常 HTTP/UI，未读取或保存登录凭据。

1. 图片、视频提示词分别预填；两者人工修改后完整刷新仍保留，见 `daily-ui-checks.json`、`ui-prompt-preserved.png`。
2. 首镜语速从模板 1.1 预填，手改 1.25，保存后刷新仍为 1.25；语言与音色预填。见 `daily-speech-prefill.json`、`ui-speech-preserved.png`。未调用 TTS。
3. 按名称准备并采用图片、配乐和首镜音效；剩余镜头用正常命令采用已有本地素材。没有供应商请求。见 `daily-ui-adopted.json`、`daily-before-export.json`。
4. 真实视频生成确认弹窗预填 2.50 元，人工改为 3.21 元后取消，**未提交付费调用**。见 `daily-budget-ui.json`、`ui-budget-prefill.png`。最终金额冻结另外通过真实 PostgreSQL/HTTP 受控集成验证，供应商提交文件为空。
5. v2 修订实际返回 400，工作区工程 SHA 与脚本 revision 不变。见 `daily-v2-retirement.json`。
6. 原生导出 [template-fields.mp4](template-fields.mp4)：1080×1920、30 fps、12 秒。对编码后的 MP4 独立测量 880 Hz 音效：0.00 / 4.76 / 8.76 秒，长度 0.40 / 0.41 / 0.41 秒；符合 30 fps 量化后 0 / 4.766667 / 8.766667 秒及 10 ms 测量分辨率。见 `encoded-media-checks.json`。
7. 实帧检查首镜 2×14 字、次镜 1×10 字、末镜字幕关闭；原生工程检查镜头起点 0/120/240 帧、次镜慢推、12 帧叠化、末镜动画/转场关闭。见 `frame-*.png`、`native-project.json`、`native-checks.json`。
8. 封面初始预选“模板封面.png”；人工清空刷新保留，再明确恢复并使用，可见预览。见 `daily-cover-prefill.json`、`daily-cover-preserved.json`、`ui-cover.png`。

实际验收与最终复核补出了三个关键边界，均保留失败日志并修根因：

- 视频费用标记在标准化确认 payload 后丢失，导致二次描述不一致；现在初始/标准化请求均稳定识别模板预留，人工最终金额仍优先。
- 封面页面候选已加入模板，但交付端原来只读取旧候选来源；已补用同一冻结模板读取合同。新真实集成先复现 409，再验证正确模板封面可入交付、错误 SHA 仍拒绝。见 `cover-delivery-red.log` / `cover-delivery-green.log`。

- 最终切镜回归发现未保存口播草稿跟随下一镜，按模板镜头隔离组件与存储草稿；切回恢复原人工输入，未写入保存设置时下一镜仍使用自身模板值。日常独立新单 `66897185-b2c1-43cd-b2e7-6d54370455ab` 实际结果为首镜 1.1→手改 1.3→次镜 0.9→返回首镜 1.3。见 `speech-switch-red.log`、`affected-final.log`、`daily-speech-switch.json`。

日常封面交付最终 `completed / verified: true`，交付封面 SHA 与原模板指定素材一致，元数据记录准确 coverSource；最终视频沿用已确认的同一导出。见 `daily-delivery.json`、`delivery-checks.json`、`delivery-cover.png`、`ui-delivery-verified.png`。390×844 页面宽度 390、无横向溢出或错误提示，见 `ui-mobile-final.json` / `ui-mobile-verified.png`。

日常运行包最终为 `271e6372ca94d5da256e9337202915e4caa303e1019aa30c5e31cbf4ff222de6`，后端、Worker、prepared 三者一致，状态 current；Worker 健康、无运行/排队任务。完整性核验与实际登录会话状态见 `final-runtime.json` / `final-system-status.json`。最后口播切镜修正只涉及前端组件，已再次核验后端运行包仍为 current。

## 检查与保护

- 全量单元：316 文件、2297 项通过（`unit-final.log`）。之后素材按钮显示修正再跑 13 项定向检查通过；封面交付补丁再跑真实集成 3 项通过；最终口播切镜修正后 6 文件、117 项受影响检查通过（`affected-final.log`）。
- 原集成批次：5 文件、11 项通过、2 项条件场景未由该命令执行。此处没有把 skipped 计为通过；本轮真实日常 UI 与 MP4 导出另有上述证据。
- 类型检查与构建日志保留；最后类型检查为 `check-final-verified.log`；封面补丁的类型/构建分别为 `check-post-cover.log`、`build-post-cover.log`。
- 切换前保存完整数据库备份 `.scratch/template-settings-daily-switch-20261116/field-before.dump` 与受保护记录快照，私有权限保留。旧运行包保留。
- 原有 4 个生产单/工作区、116 个工程版本、7 个导出、2 个交付记录，以及 1571 个文件（502344089 字节）逐项比对不变，见 `preservation.json`。
- 相同旧验收单连续读取：切换前热请求约 80–87 ms，接入后约 104–106 ms，响应 57922→58565 字节；额外开销约 24 ms，新增只读脚本校验与素材查询。样本仅本机 5 次，不是负载测试。见 `read-before.json` / `read-after.json`。

没有执行真实付费图片/视频/TTS 生成；提示词与金额的实际冻结通过受控真实 HTTP/数据库集成验证，日常服务只打开并取消费用确认。原生本地导出与交付文件验证是真实执行。
