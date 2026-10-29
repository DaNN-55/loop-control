# Provider 停用与连接测试反馈核验

日期：2026-10-27。当前主程序原地修改，保留其他会话改动；未提交、推送或创建备份。

## 结论

- 原通用错误不能证明 API Key 无效。原生产策略在北京时间 01:17 过期，11/11 次额度已用完，授权 Provider 也不包含百炼和 Freesound。此前测试没有向这两家发出请求。
- 本次获准的独立只读策略仅允许百炼模型目录和 Freesound 检索，各最多 2 次、有效 30 分钟、零费用；实际各使用 1 次，均 HTTP 200。未调用生成或下载接口，未延长原生产授权。临时策略已于北京时间 17:24:32 到期；刷新后的页面禁用重测，明确提示授权过期。
- 手动重测和更新 Key 后自动测试均显示等待动画、禁用重复操作、返回明确结果；修复同 Provider 多连接时可能测错连接的问题。

## 修改位置

- `src/connections/ConnectionTestButton.tsx`、`ConnectionWorkspace.tsx`、`src/styles.css`：等待状态、结果提示、防重复、选中连接绑定与窄屏布局；减少动态效果时停用旋转动画。
- `src/local-app/providerNetwork.ts`、`providerProbe.ts`、`src/worker/localConnection.ts`：区分授权阻断、Keychain 失败、认证拒绝、网络错误与成功，只记录安全的结果和 HTTP 状态，不记录凭据或响应正文。
- `src/worker/providerLifecycle.ts`、适配器目录、媒体执行器、旁白及运行探针：停用 Cloudflare 与 Google TTS；旧序列化标识和仅抛错的兼容函数保留，防止破坏历史读取。
- `db/local/066-retire-cloudflare-google-tts.sql`：前向迁移阻止新配置启用退役 Provider，并允许准确移除当前策略中的退役能力、保留原有生产单冻结策略。未改已应用迁移。

## 实际清理

- 删除 3 个无引用连接、4 个专用 Keychain 条目、5 个索引名称/别名，移除 4 条绑定。
- Google 的 1 条连接仍被 4 份旧蓝图、14 个已完成任务引用，因此保留撤销后的元数据，不保留可执行绑定或凭据。
- 测试账号当前蓝图移除 Google 旁白能力；既有生产单冻结策略保持相同内容。
- 删除前扫描 6916 份历史文本及别名链，无上述凭据的实际历史引用。前后 199 份历史原文还原 SHA 一致，保护映射、其他凭据、身份与认证数据一致。
- 清理后活动退役连接、绑定、当前能力均为 0。首页 HTTP 200，无残留隔离测试数据库。

`cleanup-result.json` 中 `committed` 表示数据库清理事务已提交，并非 Git 提交。原生产策略摘要与 11/11 额度不变，见 `network-result.json`。

## 验证

- 聚焦回归 123 项、共享适配器相关回归 80 项，共 203 项通过；包含真实隔离 PostgreSQL 迁移、冻结策略保留、授权过期无请求、只读次数限制、禁止生成、错误结果脱敏、手动与自动反馈、多连接选择。
- TypeScript 检查、Node 本地应用类型检查、临时目录构建、`git diff --check` 通过。构建原有大 chunk 提示保留。
- 实际浏览器完成百炼和 Freesound 各一次授权只读验证；检查最终列表无退役 Provider、新建选项无退役 Provider、两条连接均已验证。390px 合成组件验证等待动画、禁用和恢复，无真实 Key 或网络调用。
- 减少动态效果规则经过源码检查，未修改系统偏好进行实机验证。其他 Provider 本次没有额外在线调用；付费生成能力未验证。

## 图像证据

- `final-connections.png`：最终实际页面，万相已验证，临时授权到期后重测禁用。
- `verification-result.png`：清理前实际只读验证成功反馈，当时仍有待清理条目。
- `narrow-testing.png`：390px 合成等待状态，不代表实际 Provider 调用。

所有记录与截图均不含秘密值。
