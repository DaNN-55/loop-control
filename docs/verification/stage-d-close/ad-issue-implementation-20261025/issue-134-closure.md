本票在本轮限定范围内验收完成。

复用现有 Worker 运行检查和连接资格权威入口，区分缺配置、缺模型、缺资格与锁网；同时出现的资格/网络阻塞均保留。闭网检查只查元数据，不读取 Provider 秘密，也不调用 Provider。配置保存仍不等于实际生产就绪。

通过正常 `npm start -- --deployment … --offline-test`、真实隔离 PostgreSQL、媒体挂载与 Chrome 账号页面验收。可用离线执行器、缺字段、缺模型、不可用连接及锁网分别核验；修订冲突 409、不可见对象 404、未登录 401、错误 Origin/CSRF 403 均保持。检查没有新建 Episode 或 Task。

真实服务返回的 HTTP 200 被暂缓投递至页面后，分别切换账号，以及在同一页面退出并重新登录；旧响应没有覆盖新账号或结束新会话的检查。退出 pending 时点击刷新没有发起目录请求。新增回归还覆盖修订变化和旧注销回调；原客户端围栏未修改。

最初夹具尝试绑定未验证连接被原数据库规则拒绝；其次辅助断言对错误原因文案判断不准。两份失败都保留，未绕过约束。

本地报告与结果：`docs/verification/stage-d-close/ad-issue-implementation-20261025/`；源码 SHA 见 `accepted-source-before-040.json`，证据路径、大小和 SHA 见 `docs/verification/stage-d-close/evidence-index.json`。这些是当前工作区的未提交、未推送证据，远端暂不含对应文件。

最终标准入口为 111 文件、874/874，默认 5000ms；Node legacy 为 2 pass、1 个原有 skip。原 1221 项公开、1954 项私有证据，以及 20 个有哈希的无关基线文件均逐项核对不变。历史失败和其他未验收门禁保留，Owner 批准跳过的不可用 Provider 测试不记成通过。#144 必要前向迁移另行实施，#146/#147 继续暂缓；没有新增 Provider 请求，没有进入 E/F。
