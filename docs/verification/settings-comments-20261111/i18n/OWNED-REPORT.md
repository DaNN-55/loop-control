# 连接、任务状态与画面词条英文支持

本子任务修改正式连接组件、系统状态展示、任务进度和 Worker 阻塞卡片的界面文案；另交付主任务画面相关词条。连接、模型、状态与重试协议没有改变。所有者切换语言后由主应用订阅触发重绘，模块级中文状态和选项映射在显示处转换，日期使用当前 UI locale。

## 词条

| 文件 | 导出 | 精确键数 |
| --- | --- | --- |
| `src/i18n/en/visual.ts` | `visualMessages` | 475 |
| `src/i18n/en/visualExtra.ts` | `visualExtraMessages` | 160 |
| `src/i18n/en/connections.ts` | `connectionsMessages` | 332 |
| `src/i18n/en/observability.ts` | `observabilityMessages` | 338 |

共 1305 个键，保留原始空白和占位符；全部 `{valueN}` 集合逐项检查一致。主任务维护 `index.ts` 聚合。`visualExtra` 的 `[aria-label="关闭预览"]` 是机器选择器，按原样保留，不将整条选择器翻译为文案。

正式连接页补齐状态、能力、Provider 显示名、模型类型、MiniMax 站点、账务说明和默认模型目录说明。带模型数量的已知产品说明按确定模板转换，模型 ID 与能力筛选值不变。系统状态中 `Supabase 迁移`、`Codex 模型 · ` 继续用原始值匹配协议字段，只翻译展示文字。Worker 阻塞卡片的静态标题、建议和解决步骤可切换；供应商原始错误、任务 ID、用户连接名、描述和密钥不翻译。

## 验证

- 12 个连接与可观测性测试文件，99 条通过，见 `connections-observability-tests.log`。其中包含新增英文集成测试；集合不能与后续结果直接累加。
- 最后补齐模型目录与 Provider 文案后，重跑模型、列表和语言测试 3 文件 33 条通过，见 `owned-final-targeted.log`。
- 新增 `ConnectionLocale.test.tsx` 的 4 条检查真实组件：中英切换与中文用户名称保留；模型 ID 与中文能力原值不变；Supabase / Codex 身份匹配不受英文影响；阻塞指导为英文而技术原文保留。
- 局部严格 TypeScript（含未使用变量和参数）通过，见 `owned-typecheck.log`；本次源码 diff whitespace 检查通过。
- 通过隔离 5210 的真实 `ConnectionWorkspace` 和统一设置壳实际打开英文连接列表及编辑表单，1348×953 与 375×812 无横向溢出。英文编辑页 axe 扫描 0 违规，见 `english-connections-a11y.json`，截图位于 `../demo/english-*.png`。

英文浏览器夹具 `../demo/english.html` 只使用合成连接和内存回调；没有业务 API、真实密钥、供应商测试或真实偏好保存。中文布局 Demo 的验收另见 `../demo/REPORT.md`。本子任务未执行全项目生产构建或默认全量套件，由主任务统一验证；没有提交或重启日常服务。既有账务关闭路径的 React Aria act 提示保留在日志中，测试通过，没有屏蔽。
