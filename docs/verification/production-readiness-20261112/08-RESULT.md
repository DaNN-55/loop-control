# 8. 连接显示、目录与浏览器门控

修复旧MiniMax连接缺少站点元信息时误显示国际站的问题。后端以不可变连接版本为缓存单位，从现有Keychain认证材料核对一次并仅缓存非秘密站点；缺失或不可读的材料保持未知，不猜国际站。两个现存连接界面均保留未知占位，更换密钥时必须显式选站点，单纯重命名不要求重填凭据。

验证：旧连接真实HTTP/数据库集成1项、原连接组织单测14项、当前紧凑连接界面17项通过；实际隔离应用显示国内站 `api.minimax.cn`，1280与390宽度截图保存，390宽度无横向溢出。未将真实密钥写进证据。

旧连接目录集成断言已按当前注册的7个OpenAI图片模型更新；修正受控探测夹具的执行就绪口径后，完整目录/轮换/撤销/越权/不支持模型检查通过。该验证使用真实Owner HTTP/PG与本机受控探测，不是实际OpenAI生成。

字幕浏览器门控实际启用并通过1项（5项不在本次选择内）。设置20%底部安全区和1.25秒结束时间，1280及380宽度重读一致；空时间输入不持久化。截图已查看，380宽度为380 scrollWidth，表头/操作均可见。见 `captions-browser/`。

前端依据 modern-web-guidance 的 `select-menu-interaction`/`forms`："The first option should have `value=\"\"` and ideally be disabled/hidden to force a valid choice."；"DON'T auto-submit a form when a user changes `<select>`, radio buttons, or checkbox without an explicit submit action." 本次未知站点使用禁选空选项，仍通过显式“保存”提交。

最终源码：类型检查、生产构建、Worker/编排运行包准备通过。含发布围栏轮询修复后的完整默认回归为289文件、2120项全部通过。其余真实集成与线上调用逐项见对应结果，未把门控跳过计为通过。
