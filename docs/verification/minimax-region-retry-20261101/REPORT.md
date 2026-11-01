# MiniMax 国内站与失败重试修复

日期：2026-11-01（Asia/Shanghai）。本轮修改未提交、未推送。

## 结论

新 Key 已保存为 v3，失败发生在随后连接测试。旧实现固定使用国际站 `https://api.minimax.io`；用户确认 Key 来自国内站 `https://platform.minimax.cn/console/keys`。同一 Key 查询国际站返回 HTTP 401、`authorized_error`，查询国内站官方 `https://api.minimax.cn/v2/query/video_generation?page_num=1&page_size=1` 返回 HTTP 200 且有任务列表。

错误旁的「重新读取连接」只刷新目录，不触发连接验证，组件自己的失败消息也不清除；实际点击后可访问性树没有变化。这与用户描述的「重试无反应」一致。

## 修改

- 连接测试失败提供真正的「重新测试」，调用原连接的验证流程；显示进行中与最终结果，阻止重复请求，不重复创建凭据版本。目录读取失败保留重新读取入口。
- 保存凭据后测试失败，明确显示「凭据已保存，连接测试未通过／未完成」。
- MiniMax 支持国内站与国际站。沿用百炼已有的认证包做法，将站点与 API Key 放入不可变秘密绑定；旧原始 Key 默认国际站。普通读接口只从非秘密 intent 元数据读取站点，不读取 Keychain。
- 测试、视频提交与恢复查询使用同一个站点解析结果；网络边界只新增国内站官方 API origin，生成授权规则不变。
- 只改站点时，服务端在原连接锁内读取指定当前版本的 Key，创建新版本并保留旧版本；拒绝旧版本、跨 Owner 与未登记站点。无需在浏览器重输或回显 Key。

连接版本的数据库 endpoint 继续作为已登记 Adapter 的规范标识；MiniMax 的实际站点与现有百炼 workspace 一样，由固定在该版本秘密绑定中的配置决定。页面服务地址返回对应的实际站点。

## 验证

- 修复前 UI 回归已红：失败结果仍出现刷新按钮；国内站验证及执行回归已红：请求仍发往国际站。修复后通过。
- 最终默认测试：180 个文件、1173 项通过。原有 React act 与 react-range 警告仍存在，无失败。完整输出见 `tests.log`。
- 真实 Owner HTTP／临时 PostgreSQL／loopback Provider 集成：MiniMax 区域轮换和既有连接目录两项通过；覆盖不可变 Key 保存、旧版本保留、当前版本限制、Owner 隔离、普通读取不访问秘密存储与错误站点拒绝。临时数据库及服务由夹具关闭。
- `npm run runtime:prepare` 通过，Worker 与后台 TypeScript 构建通过；`tsconfig.app.json --noEmit` 通过；`git diff --check` 通过。
- 日常服务无运行中任务时已重启，当前 PID 66892，地址 `http://127.0.0.1:5174/`。
- 正式浏览器：选中 MiniMax 国内站，留空 API Key，保存并测试；新增 v4，真实测试通过，弹窗成功收起。重新打开显示国内站地址与空 Key 字段；刷新完成后仍为已验证 v4。
- 数据库只读复核：当前版本 4、region `cn`、status `verified`、qualification `true`，旧三个版本全部保留。
- 正式界面截图见 `minimax-v4-verified.png` 和 `minimax-domestic-detail.png`。

本轮未生成视频、未充值；连接认证通过不代表生产网络额度、余额及真实生成验收通过。桌面浏览器已验证，窄窗和实际付费视频生成未执行。

## 官方依据

- [国内站任务列表](https://platform.minimax.cn/docs/api-reference/video-generation-v2-list.md)：官方 API origin 为 `https://api.minimax.cn`，GET 路径和分页参数与当前实现一致。
- [国际站任务列表](https://platform.minimax.io/docs/api-reference/video-generation-v2-list.md)：官方 API origin 为 `https://api.minimax.io`。
- [国内站前置准备](https://platform.minimax.cn/docs/guides/quickstart-preparation.md)：按量 API Key 和订阅 Key 的入口与用途。

所有诊断仅输出脱敏状态，未保存或回显真实 Key。
