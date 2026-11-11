# 人工口播、音频来源与焦点一致性

2026-11-11。按用户浏览器评论和两次补充，由三名子 Agent 分工完成，主 Agent 统一验证。基线 `504aea3a`，源码提交 `7d41cf87`、`f2f536e9`，当前 main 本地交付、不推送。范围见 [SPEC](SPEC.md)，审查见 [REVIEW](REVIEW.md)。

## 完成结果

| 请求 | 实现 |
| --- | --- |
| 人工口播与 TTS 一致 | 移除素材下拉、清除选择与「加入候选」。从素材栏放入或上传 MP3 后，逐条保存并确认登记，下方复用 TTS 候选行、原生试听、采用与确认采用。人工候选显示文件名，完整正文留在 title；历史人工录音和时长影响核对保留。 |
| 导入失败／部分成功 | 局部队列保留已导入 ID、冻结命令、save／confirm 阶段；登记失败不重新上传，确认失败只补确认。切换镜头或卸载停止后续旧操作。 |
| 音频来源一致 | 复用 WorkspaceModelPicker 的扁平菜单、图标、搜索、选择后关闭。音频始终显示连接名称／版本／不可用原因，禁用来源不能选择。保留清空，按补充删除刷新与设为本期默认整行；既存默认读取和独立配乐配置保存保持。 |
| 复合输入焦点 | 图片／视频／Pexels、TTS／字幕、音频正文由外层负责激活边框，移除内层 textarea 的重复边框、outline 和阴影。独立字段、搜索框与按钮仍保留键盘焦点，错误由外层红边表达。 |
| 分段与顶对齐 | 音效／整期配乐沿用前面切换的选中表面色与阴影；音频和口播／字幕行的左侧切换与开关根元素顶对齐，保留 40 px 行高和 Toggle 点击区域。 |

主 Agent 另外通过真实父组件复现：上传成功回执被父素材列表确认并清理后，人工口播可能拿不到返回 ID，导致只导入而未登记。现改为上传执行期间直接收集本次成功 ID 并返回，不依赖可能已消费的队列。失败回归见 [parent-upload-red.log](parent-upload-red.log)，修复后父上传、关闭重开及详情上传 3 文件、4 条通过：[parent-upload-green.log](parent-upload-green.log)。不延长成功回执或 File 生命周期。

## 行为与浏览器验证

使用真实公开组件、真实 localCommand 与受控 HTTP／原生文件播放。夹具仅监听 loopback，不代理日常服务，不连数据库或供应商。文件为本轮 ffmpeg 合成 MP3，没有实际生产数据写入。[browser-fixture.tsx](browser-fixture.tsx)、[serve.mjs](serve.mjs)、[browser-check.mjs](browser-check.mjs) 可复用；启动 `node docs/verification/workflow-audio-consistency-20261111/serve.mjs` 后运行 `node docs/verification/workflow-audio-consistency-20261111/browser-check.mjs`，完成后关闭该进程及指定浏览器会话。

[browser-results.json](browser-results.json) 与 [browser-final-passed.log](browser-final-passed.log) 记录最终通过：

- 先选素材再放入、HTML5 DataTransfer 拖入、真实 MP3 试听、批量上传都形成独立候选。采用前命令数为 0；点击采用只核对，确认后才有 1 次采用。最终 5 个候选、3 次文件导入、1 次明确采用。
- 确认登记注入 503 后，重试不增加导入或 save 次数，继续原 confirm 数据；各成功阶段推进下一个 revision。人工素材下拉及「加入候选」不再显示。
- 音频搜索筛选、选择后关闭、清空后关闭、底部两按钮不存在；唯一不可用来源直接显示连接名／v2／原因且保持禁用。
- 五类正文在 1543 px 浅色与 390 px 深色共 10 组检查：内层 border 0、outline none、shadow none；外层 2 px solid；没有横向溢出。另检查独立字段焦点仍可见、错误改变外层颜色。
- 1100 px 检查两行头部：切换和开关根元素 top 均为 20 px，行高 40 px；选中表面色及阴影相同。这里测量实际 Toggle 根，不把隐藏 checkbox 的几何当作可见开关。

实际查看的截图包括 [人工候选](manual-candidates-wide.png)、[确认采用](manual-confirm-wide.png)、[窄屏深色](manual-candidates-mobile-dark.png)、[音频来源](audio-source-wide.png)、[唯一不可用来源](audio-single-unavailable.png)、[字幕外层焦点](captions-focus-1543-light.png)、[字幕窄屏深色](captions-focus-390-dark.png)。夹具按实际入口顺序加载 foundation、production、surface-polish 和 refinements，避免漏掉最终覆盖规则。

浏览器初轮存在夹具／工具问题：相对路径上传没有派发文件事件，改用绝对路径；鼠标 drag 未送达时改用明确的 HTML5 DataTransfer；选择器匹配隐藏字幕区、重启夹具沿用旧 tab 草稿、以及隐藏 checkbox 的几何误判，分别改为当前可见区、显式夹具初态和 Toggle 根元素后通过。这些不作为产品失败处理；旧日志保留，单一来源截图补拍时等待进入动效结束。

## 自动检查及交付

- 8 个受影响测试文件、105 条定向通过：[targeted-final.log](targeted-final.log)。其中旧父页面测试已按自动登记交互替换「加入候选」点击，保留素材用途限制及不自动采用断言。
- 独立审查修复后，音频 29 条通过：[audio-targeted-final.log](audio-targeted-final.log)；类型通过：[check-final.log](check-final.log)。失败回归还包括 [人工口播](manual-red.log)、[音频菜单](audio-picker-red.log)、[禁用](audio-disabled-red.log)、[空来源](audio-empty-red.log)、[删除 footer](audio-footer-red.log)。
- 最终前端、Worker、后端顺序构建通过：[build-final.log](build-final.log)、[worker-build-final.log](worker-build-final.log)、[backend-build-final.log](backend-build-final.log)。保留现有大 chunk 提示和测试中的 jsdom 媒体／React act 提示。
- 最终全量 262 文件通过、1962 条通过、1 条跳过：[full-tests-final.log](full-tests-final.log)。默认排除数据库集成文件，不将其描述成真实数据库或生成供应商验收。
- 首轮全量曾有 7 条运行工厂失败：前端构建清空了测试依赖的编译后端，补齐顺序构建后解决；另有 1 条未修改的图片上传恢复等待失败，单文件 [10 条复跑](visual-upload-isolated.log) 与最终全量均通过，未修改该测试或对应业务。保留首轮限制，没有把失败算作通过。
- 两路只读审查的同一项身份／原因问题已修复并复核，无遗留。用户的两个追加评论均写入 SPEC 并纳入验收。

本轮 5198、独立浏览器及专属 `.scratch/workflow-audio-consistency-20261111` 已清理；日常 5174、其他会话的 5199 日志预览及浏览器保持。本轮没有推送。两份研究、日志 Demo 文件及它们的 PLAN 段不纳入提交；收尾仅暂存本轮 PLAN 段，保留并行工作区内容。保护与清理核对见 [cleanup.json](cleanup.json)。

2026-11-11 后续清理：移除被最终结果替代的初次构建、定向回归、全量和中途浏览器日志，以及临时服务输出。首轮全量的失败与限制保留在上文；浏览器曾因等待区域或候选列表超时中止。最终结果、首次有效产品失败证据与复跑脚本保留。标题为 browser-check-final.log 的中途对齐断言失败未删除，最终通过以 browser-results.json 与 browser-final-passed.log 为准。本报告的「不推送」为当时交付状态；上述优化后来已获授权，随 `86bc9e66` 推送。清理前版本可从该提交恢复。
