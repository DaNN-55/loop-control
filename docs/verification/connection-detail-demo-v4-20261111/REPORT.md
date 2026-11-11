# 连接与密钥固定详情隔离 Demo

仅新增 `src/local-app/connection-detail-v4.prototype.{html,tsx,css}` 和本验收目录；没有修改生产连接／密钥、后台、共享字典、数据库或运行版本，没有提交／部署。父 Agent 和其他执行 Agent 的文件保持原样。

## 打开与比较

- 推荐：[紧凑](http://127.0.0.1:5210/src/local-app/connection-detail-v4.prototype.html?variant=compact)
- [舒适紧凑](http://127.0.0.1:5210/src/local-app/connection-detail-v4.prototype.html?variant=balanced)
- [高密度](http://127.0.0.1:5210/src/local-app/connection-detail-v4.prototype.html?variant=dense)
- [直接查看连接](http://127.0.0.1:5210/src/local-app/connection-detail-v4.prototype.html?variant=compact&connection=openai)

复用已运行的5210无后台Vite，不停止或重启它。需要自行启动时：`npx vite --config docs/verification/recycle-bin-migration-20261111/browser/vite.config.mjs`。

三个候选保持同一拓扑和全部能力，仅变化行／字段间距，默认compact。顶部与底部不跟随内容移动；600px桌面设置壳减少空壳高度。切换密度通过URL，主题／语言及失败开关在同一对话框语义范围内的固定演示条，键盘可达；它不是未来产品的一部分。

## 已展示的交互

列表进入一个连接详情，不向列表追加配置。连接／模型／用量与计费／记录互斥替换同一个主体，保存／取消始终在同一底部位置，显式测试位于验证状态旁。对象标题下只显示一次服务与能力。查看和更换密钥在连接内，新建也用同一主体；切Provider同步其示例Endpoint、模型和能力。

独立密钥入口用于全局搜索、连接定位、系统运行和历史还原资料。系统运行秘密只展示元数据；合成可读秘密使用密码确认（演示密码`demo-123`），明文离开／30秒／窗口隐藏后清除。合成复制只写入`synthetic-demo-key-only`。用户不能借Demo读取真实秘密。

## 实际检查

- `check-layout.py`：3密度 × 桌面1340×953中文浅色／390×844英文深色 × 4页签＝**24场景**。`layout-result.json`证明页面与主体无横向溢出、每组4页签只有一个tabpanel、footer坐标完全一致。
- `check-interactions.py`：**9组通过**，最终日志`interactions-final.log`：换key创建v3，v2原任务引用保留；保存与显式测试分离；验证错误修正与明文清除；模拟失败保留草稿／原处重试；dirty离开保留或丢弃；新建Provider同步并回同列表；全局密钥定位连接；页签方向键不切Demo密度；超长名称不横溢。
- 初次交互脚本用`textContent`读取input而非value，导致一个错误的测试断言；改成实际input值读取后全程重跑9组通过，没有为此改产品行为。旧日志`interactions.log`保留作证据。
- 主 Agent 实看推荐方案并提出的两点已修：Demo控制条移入dialog语义树；更换密钥用KeyRound，与测试RefreshCw区分。移除详情中重复服务能力行。
- 自行实看桌面列表／认证／计费，以及移动英文深色认证。主要截图：`compact-connection-1340-zh-light.png`、`compact-models-1340-zh-light.png`、`compact-billing-1340-zh-light.png`、`compact-history-1340-zh-light.png`、`compact-connection-390-en-dark.png`。较早`connection-compact-1340.png`是移除重复字段前的中间截图，应以`compact-*`最终布局组为准。
- 目标TS诊断0错误（只检查此入口相关诊断，不代替全仓检查）。impeccable布局机械扫描`layout-detect.json`为空数组。最终稳定状态移动英文深色axe为**0违规、1待人工确认**，确切文件`a11y-settled-mobile-en-dark.json`。待确认项是遮罩后方占位背景`main > header`的对比度，非可操作设置主体；不将它写作0待确认。最初紧贴页面打开的扫描捕到主题切换期间的混合颜色，曾有1对比度违规，保留于`a11y-initial-theme-transition.json`（原名a11y-final，已更名防止误认最终结果）；未修改颜色源码，内容就绪并networkidle后重新扫描得到前述稳定0违规。
- 自己的`cd4-isolated`浏览器会话已关闭，不关闭父 Agent 或用户浏览器。未运行不相关全量测试。

## 边界

这是内存合成预览，刷新即恢复示例；所有操作没有产品API、外部Provider、数据库或文件写入。相同字段的真实权限、Keychain、版本并发、账务Adapter和原任务绑定仍须在用户确认方案后的正式迁移中接回并验收。本轮没有把演示成功当作真实生成／余额读取成功。

密度选择不改变功能。推荐compact；balanced多一点字段与行间距，dense适合经常管理较多连接但更密。窄窗改为上下字段布局，保留四页签、固定操作区和滚动内容。
