# GPT／DeepSeek 主脚本格式兜底验证

日期：2026-11-17。范围：独立大语言模型连接、格式识别、预览采用、请求回执和本地日常部署。不做事实纠错、内容审核或脚本创作。

## 实际行为

- 连接配置新增 OpenAI 大语言模型与 DeepSeek 大语言模型，分别验证模型资格；原有图片连接和 8 个日常连接保留。默认 GPT 为 `gpt-5.6-luna`，DeepSeek 为 `deepseek-flash`，可显式启用 `deepseek-v4-pro`。
- 只有本地脚本解析失败才出现入口。点击生成前提示文本会发往所选服务并产生 API 费用。建议独立预览；采用只更新草稿，仍须确认脚本修订。
- 结果经结构、格式及内容值校验；口播改写被拒绝。基准变化、跨 Owner、CSRF 错误、归档和图片／文本连接混用被阻止。
- 相同请求和不同客户端标识的相同输入均复用回执。并发、网络结果未知、响应流中断、回执写入失败均不自动重发。持久快照包含模型、输入、系统提示、Schema 和参数，不含 API Key。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 全量单测 | 322 文件，2328 项通过 |
| 类型及前端构建 | `npm run build` 通过；保留既有大包提示 |
| Worker／后台固定运行包 | `npm run runtime:prepare` 通过 |
| PostgreSQL／HTTP 集成 | 7 项通过，覆盖两家验证、生成、回执、模型设置、权限、并发、失效及真实写回故障 |
| 浏览器持有夹具 | 上述 7 项加浏览器夹具，共 8 项通过；采用前后生产单、脚本版本、任务及运行记录摘要相同 |
| 实际浏览器 | 独立 Chrome 会话，1440×1000 与 390×844；GPT／DeepSeek 切换、预览与采用通过，窄屏文档宽度 390；无页面 JS 错误 |
| 内容保护变异实验 | 临时去掉内容保护后，口播改写用例失败；恢复源码后通过 |
| 非空数据库迁移 | 日常私有备份恢复到独立 PostgreSQL，迁移回滚与提交演练通过；133 张现有表逐行保持 |
| 日常部署 | 迁移 207、Schema 校验和新运行包生效；日常页面显示两家文本连接与 DeepSeek 官方地址，系统状态正常 |

浏览器使用合成脚本，服务端通过真实 localhost HTTP 返回受控 Responses 回包；认证与 CSRF、连接版本、数据库和脚本草稿流程均走正式代码。最初浏览器夹具缺少 `/_local-artifact` 代理，导致读取旧脚本返回 HTML；已补全代理并重跑，原脚本读取及后续流程通过。夹具显示系统不可用是未启动制作运行时的预期状态，不能据此宣称生产运行时检查通过。

日常启动与迁移后的最终摘要核对衔接过早，首次核对捕获 `media_root_binding.updated_at` 的正常启动更新。随后将私有备份再次恢复，统一逐行排序核对全部 133 表：132 表逐行相同，仅媒体根绑定的 `updated_at` 更新；所有原有内容、路径、统计次数和金额相同。SQL 聚合排序造成的另外六项摘要差异也经逐行核对排除。首次部署核验时新请求表为 0 行，没有调用真实模型、创建新连接或复用现有图片密钥。

私有证据保留于 `.scratch/script-format-fallback-20261117/`：`unit-final.log`、`integration-final.log`、`ui-fixture.log`、`ui-fixture.json.result.json`、`mutation.log`、`stream-red.log`、`build.log`、`runtime-build.log`、`rehearsal.json`、`daily-applied.json`、`preview-gpt.png`、`preview-deepseek-narrow.png`。数据库备份为权限 0600 的 `daily-before.dump`，不纳入 Git。

## 限制与接续

OpenAI 已在下述补充测试中使用真实连接生成一次建议；DeepSeek 真实生成仍未验证。单次 OpenAI 成功不能证明其他输入、配额、延迟或账单均正常。模型目录验证不等于生成成功。文本保护是保守规则，可能拒绝可用建议，也不能替代人工判断原意。

本轮未运行整个 Docker clean-schema E2E；已覆盖独立原生 PostgreSQL 的当前基线、候选迁移、非空日常备份恢复、回滚和升级。未做 Safari／Firefox 验证。已有前端包体积提示未在本次扩展为包拆分改造。

协议与官方来源见 [ADR-0070](../../adr/0070-main-script-format-fallback.md)。本次提交只包含该能力，不推送远端。

## 用户观看的真实 OpenAI 测试（2026-11-17 12:24，Asia/Shanghai）

用户明确批准调用 OpenAI，在当前日常脚本页面观看测试。先备份空草稿及修订原因；只改编辑草稿，不确认保存或启动制作。

1. 正确输入：`# 雨后的街角`、`## 正文` 加两段合成正文。本地识别为 2 个镜头，无模型请求。
2. 错误输入：只将 `## 正文` 改成 `## 旁白脚本`。本地显示缺少正文，随后通过右侧已验证的 OpenAI 连接调用 `gpt-5.6-luna`。真实回执 `completed`，输入 457／输出 86 tokens；建议仅规范标题，完整建议与正确输入逐字相同。左侧错误稿保持不变，右侧保留建议供用户查看，没有点击采用。

测试新增 1 条 OpenAI 请求。前后生产单、脚本版本、任务和任务运行四表摘要一致。未推算金额。私有回执 `live-openai-result.json`、备份 `live-recognition-draft-backup.json`、截图 `live-correct.jpg`／`live-openai-suggestion.jpg` 位于上述 `.scratch` 目录。
