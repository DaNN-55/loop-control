# 连接配置与密钥管理嵌入验收

日期：2026-11-11。此目录的夹具只使用合成连接、合成密码和合成密钥，拦截全部数据请求，不读取真实账户、Keychain 或供应商服务。

## 完成行为

- 连接配置和密钥管理支持 `embedded`，在共享设置窗口内不再创建 backdrop、第二个 dialog 或独立焦点陷阱；默认独立模式保留。
- 连接列表保留能力、模型、验证状态、最近验证和在途任务。可直接“更换密钥”，详情和编辑表单在原区域切换；返回列表恢复键盘焦点。
- 详情提供“在密钥管理中查看”；密钥详情提供“前往连接更换密钥”，跳转前先清除敏感输入/明文并中止未完成读取。
- 密钥验证继续使用真实生产表单及原请求处理，支持当前登录密码校验、过期隐藏、复制、分类、分页、历史、系统控制仅用途。明文展示倒计时取自服务返回的实际过期时间。
- 凭据保存与连接测试保持两个结果：合成浏览器操作确认 rotate 后再 verify；测试失败仍显示“凭据已保存，连接测试未通过”，输入密钥被清空。

## 自动检查

以下 4 个测试文件共 42 条通过（包含新增的 4 条嵌入与跨页回归）：

```sh
npx vitest run src/connections/ConnectionWorkspace.test.tsx src/local-app/LocalConnectionsPanel.test.tsx src/local-app/LocalConnectionsPanel.reading.test.tsx src/local-app/LocalSecretAdministration.test.tsx --reporter=dot
```

局部严格 TypeScript 检查通过：

```sh
npx tsc --noEmit --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --lib es2022,dom,dom.iterable --types vite/client,node --skipLibCheck --allowSyntheticDefaultImports --strict --noUnusedLocals --noUnusedParameters src/local-app/ConnectionsSettingsDialog.tsx src/local-app/LocalSecretAdministration.tsx docs/verification/owner-credentials-embedded-20261111/fixture.tsx
```

未执行全仓 build，避免清理现有 dist。

## 浏览器检查

使用独立 agent-browser session `lc-credentials-embedded`、独立 Vite 端口 5208，检查实际组件：

- 1440 × 1000：连接列表、内联编辑、保存后测试失败、返回列表。
- 375 × 812：连接列表、密钥显示、连接详情及按钮换行。
- 320 × 812 暗色：连接列表、密钥密码校验错误。页面及内容均无横向溢出。
- 共享宿主始终仅一个 `role=dialog`；“更换密钥”聚焦真实密码输入，返回列表聚焦“连接列表”区域。
- 密钥查看输入错误合成密码后显示错误、不展示值；输入正确合成密码后显示合成值。跨页后明文消失，并定位合成连接详情。
- 浏览器 errors 输出为空。

截图保存在本目录，文件名记录宽度与主题。

## 复现

```sh
npx vite --config docs/verification/owner-credentials-embedded-20261111/vite.config.mjs
```

打开 `http://127.0.0.1:5208/docs/verification/owner-credentials-embedded-20261111/index.html`。合成查看密码为 `synthetic-password-only`。夹具页面顶部导航仅用于独立验收，不属于产品界面。

## 验证边界

本次未发起真实 Keychain 读取、密钥轮换、供应商连接测试或内容生成。整体七页设置壳的集成、权限和离开守卫由主任务继续验收；模型、账务和撤销保护弹窗保留原行为。

## 子窗保护补充（审查后）

- `ConnectionWorkspace` 汇总模型与账务子窗状态到设置壳。模型保存/同步期间、账务保存/刷新/断开期间报告 busy；只读加载不锁外层导航。子窗关闭/卸载复位上抬状态。
- 模型勾选继续由已有 WorkspaceDraft 守卫处理，不额外报告 dirty，避免重复确认。
- 账务认证字段未保存时报告 dirty，复用设置壳的导航确认；账务子窗自身关闭也需继续/放弃确认，不提供保留凭据。
- 3 个针对文件共 31 条测试通过，涵盖实际子窗写入上抬、保存关闭后的解锁、账务三种写入和认证输入确认/清除；3 个生产模块局部严格 TypeScript 与 diff whitespace 检查通过。
- 新增账务关闭确认测试在 React Aria/JSDOM 路径仍有非失败的 act 提示，断言均通过；未为此修改生产逻辑或屏蔽日志。
