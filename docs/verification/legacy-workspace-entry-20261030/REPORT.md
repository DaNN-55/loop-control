# 旧生产单四步入口兼容修复

2026-10-30，本地服务已更新；源码未提交、未推送。

## 原因与修复

实际登录页面显示日照金山单据标题与四步导航，但准备素材操作返回 404「本地生产单不可见」。数据库中的 6 张单据均存在，均未登记 `local_identity.input_episodes`，也未标记为历史只读。既有旧单调查记录已经说明这些单据没有新版执行标记，本次没有发现数据被删除的证据。

命令入口原先将本地执行标记当作单据可见性的必要条件；脚本检查接口也有同类限制。修复如下：

- 仅在明确提交 `prepareWorkspace`、`reconfirmScript`、`importMaterial` 或 `start` 时，锁定属于当前 Owner 的非历史单据，并在同一事务登记执行身份。归档或已完成单据拒绝登记；命令失败时登记随事务回滚。其他命令不自动登记。
- 登记沿用所有执行能力默认关闭的状态。读取页面不登记，不授权生成，不重排旧任务。
- 脚本检查接口按真实 Owner 归属读取，不要求预先登记执行标记；跨账号和 Worker 成员仍返回 404。
- 允许 `qc_passed` 旧单在明确操作后以已有有效分镜建立工作空间；已完成单据继续只读，旧工程保留或封存选择继续生效。

## 验证

新增 `legacyWorkspaceEntry.integration.test.ts`，先在临时数据库复现 404，再验证修复。用例通过真实 Owner 会话、CSRF、HTTP、PostgreSQL 和文件边界，覆盖：旧单读取不登记、明确准备成功、版本错误回滚、脚本修订成功、非法上传回滚、未开放命令拒绝、跨账号拒绝、Worker 成员拒绝、归档/已完成/历史只读拒绝，以及旧单任务、阶段和批准记录不变。

已通过：

- 3 项新增旧单集成用例。
- 7 项既有集成用例：1 项工作空间保存/恢复，6 项正式四步工作流，包含旧 Studio 编辑保留、旧任务延迟完成、受控生成与普通脚本规划。
- 9 项脚本与制作面板界面回归。
- `npm run build`、最终 `npm run check` 和 `npm run runtime:prepare`。保留既有构建 chunk 大小提示。

首轮补充验收中，新增修订样本缺少必需的 Markdown 标题，普通脚本规划用例缺少 `LOOP_TEST_CONTEXT_MODULE`。分别修正样本和补齐运行参数后，失败用例均通过；没有修改产品校验或跳过失败断言。

复验命令：

```sh
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs \
LOOP_LEGACY_WORKSPACE_ACCEPTANCE=1 LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FORMAL_ACCEPTANCE=1 \
npx vitest run src/local-app/legacyWorkspaceEntry.integration.test.ts \
  src/local-app/productionWorkspace.integration.test.ts \
  src/local-app/formalWorkflow.integration.test.ts
```

## 本地交付

重启前确认没有运行中或有效待执行任务，随后通过 `npm stop` 和 `npm start` 正常更新服务。使用应用角色只读验证全部 6 张单据的详情和脚本检查；现有 2 名 Owner 对应的 12 个单据归属组合均可读取。

实际登录浏览器验证：生产单列表显示 6 张单据；日照金山详情显示四步流程与素材匹配入口，无原来的 404 提示。保留原标签，另开核验页面，未替 Owner 在真实单据上提交制作转换。

更新前后完整记录指纹相同：

| 数据 | MD5 |
| --- | --- |
| 生产单 | `a047aee3e840f2d400d9984feb543363` |
| 任务 | `7b58c8cab239df6f388953ef879fbaa2` |
| 材料 | `5b1e10af539c2e2cf553fd7eb6857862` |
| 产物 | `ab94c2ba79964f4fd5790fc4caedf666` |
| 审核包 | `0835ffe4250f8074e3ad4a9b783eded6` |
| 批准 | `e012d118fc5c993cedddf3fa3be84beb` |

日常数据库的执行标记和工作空间均保持 0 行。未应用迁移，未调用付费 Provider，未修改真实单据、生成授权、材料或旧工程。写入路径的验证在临时数据库中完成。
