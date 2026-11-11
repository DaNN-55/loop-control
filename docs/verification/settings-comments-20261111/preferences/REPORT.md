# 设置注释 1—4 与英文基础接入

日期：2026-11-11。正式修改个人偏好、存储位置和语言基础；按主 Agent 分配扩展账户、系列、规则配置、新建生产单及所有者设置导航、密钥和文件清理的英文文案。未提交，不触碰真实偏好、头像、目录、密钥或生产数据。

## 修改结果

- 界面语言改为可保存的「简体中文 / English」选择，语言控件与选项不放语境图标。`OwnerPreferences.language` 和 API 边界解析接受 `zh-CN`、`en-US`，其他语言仍拒绝。
- 外观控件当前值与三个选项分别使用 Sun、Moon、Monitor。共享 `NativeSelect` 增加可选 `optionIcons`，弹层名称、空选项等基础无障碍文案也支持英文；其他控件默认交互不变。
- 桌面个人资料采用左右两栏，显示名称在左、头像与上传操作在右；窄窗回到纵向顺序。
- 设置窗口的素材目录始终展示输入框，提供「选择素材文件夹」「检查迁移计划」「打开文件夹」。选择目录只修改表单，检查计划不复制文件；仍需计划可执行、目标未变化且明确勾选确认，才可开始迁移。独立素材位置窗口保留原有折叠编辑行为。
- 英文窄窗底部按钮使用等宽双列并允许文案换行，恢复默认说明明确作用于个人资料和界面，存储位置单独设置。

## 英文机制与边界

新增 `src/i18n/ui.ts`：`uiText(source, values?)` 只翻译显式调用的产品文案，支持命名占位；`useUiLocale` 使用外部 store 订阅，`setUiLocale` 切换语言。主 Agent 将根订阅接入整个产品；本任务不使用 DOM 文本替换，不引入翻译依赖。

语言类型单独位于 `src/i18n/types.ts`，避免服务端偏好校验依赖 React。本任务字典为 `en/preferences.ts`、`en/accounts.ts`，并按主 Agent 提供的操作辅助文案清单补齐 `en/workflow.ts` 的 106 个词条（106/106，缺失 0）；聚合由主 Agent 拥有。顶层标签表保留原中文，在渲染时翻译，避免语言切换后缓存旧值。协议比较、状态类型、命令、API、模型、凭据值均不翻译。账户名称、系列名称、工作标题、路径、脚本和创作规则内容保持原值。

日常后台使用已准备运行版本；主 Agent 需准备并重载后台后，才能在真实偏好 API 保存 `en-US`。本任务未重启日常服务，也未实际保存用户的英文偏好。

## 验证

- 偏好、素材位置、语言存储和英文公共表面：8 个文件 39 条测试通过，见 `tests-final.log`。
- 分配的账户、规则、创建生产单、导航、密钥和清理路径：16 个文件 98 条测试通过，见 `assigned-tests.log`。两组有交叠，不相加。
- 两组依赖树的局部严格 TypeScript 通过，见 `typecheck.log`、`assigned-typecheck.log`。
- 隔离合成浏览器：中英 × 亮暗 × 1348/375/320px × 个人/存储两个分区，共 24 场景无横向溢出，宽屏名称与头像两栏，见 `browser-results.json` 及截图。
- 8 次中英宽窄页面 axe 检查为 0 违规，见 `a11y-results.json`。英文 320×640 底栏优化后再次检查为 0 违规，见 `a11y-narrow-final.json`；实测内容区可滚动。
- Impeccable layout detector 最终未报告问题，见 `layout-detector.json`。人工查看桌面资料、三个外观选项、存储页面及英文窄窗截图。

英文测试确认：英文账户表单实际提交的中文账户名称不变，创作规则标签转英文但中文内容不变；保存语言通过真实偏好解析；素材目录只执行 choose/planMigration，不自动执行迁移。

## 复跑

在仓库根运行 `node docs/verification/settings-comments-20261111/preferences/serve.mjs`，打开 `http://127.0.0.1:5212/__preferences`。`?language=en&theme=dark` 可启动英文深色合成夹具。`verify-browser.py` 与 `verify-a11y.py` 使用独立 agent-browser 会话。

仅本轮 5212 合成预览、浏览器会话及 `.scratch/preferences-comments-preview` 缓存在收尾时关闭和清理。日常 5174、原始 5201 预览及其他 Agent 服务不操作。
