# T19 双轴只读复核

基准 `af4856a8683d0a61f2f01911ccfe00077b4c9cc1`，只审查本次工作区差异和新增源文件，排除无关根 PLAN/规划文件。使用 code-review 技能要求的两个独立只读审查者；不访问在线票单、秘密或生产。

## Standards

初次发现媒体不可用时返回裸 503，缺少 ADR-0006 的结构化预检。现已返回 `worker-preflight/v2`、`local_adapter_readiness/unavailable`、`scope=worker`、`action=contact_environment_admin`；真实撤销 Worker 函数权限的 HTTP 503 检查已通过。前向迁移、Owner 事务和 JSONB 编码补正未发现新增必修问题。

最终开放必修静态问题：0。此结论不替代测试门禁。

## Spec

初次发现图片连接解析缺少明确的本地视觉授权标记。017 增加默认 false 的 `visual_media_enabled`，仅 Owner `start` 按冻结图片选择显式启用，连接解析强制复核。分镜后媒体仍由独立 `media_enabled` 控制，当前已批准包围栏限制重试。

补审确认卡片文字映射 `V1/video` 直接修复现有渲染器忽略 caption 轨文字的根因，预览入口复用既有 ArtifactPreview，不增加文件访问路径、Provider 算法或 T20 范围。最终开放必修静态问题：0。

## 运行证据的界限

七类 HTTP/PG/CLI、逐族真实 Chrome 预览及卡片文字目视通过；默认 5000ms 最终完整回归仍 739/740，门禁未通过。受控资格、合成秘密和 SecretStore 替身不证明 live Provider 或 Keychain。详见主报告和原始日志。
