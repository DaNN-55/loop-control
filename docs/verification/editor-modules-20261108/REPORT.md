# 剪辑台模块加载失败修复

2026-11-08。用户入口：当前生产单的剪辑工作台。

## 复现和根因

实际点击“重试打开剪辑工作台”，宿主停在连接中；iframe 错误边界显示 Failed to fetch dynamically imported module: /src/Editor.tsx。直接请求该文件为 200，但从它沿真实依赖进入 /@id/__x00__loop-control-candidates 时 HTTP 500：Failed to resolve import ./shotCaptions.js from null-byte loop-control-candidates。

候选模块新增字幕校验引用后，scripts/openchatcut-embedded.mjs 的虚拟模块适配器只为字幕模块映射 shotCaptions.js，没有覆盖候选模块。缺少一个模块会使整个懒加载编辑器失败，宿主不能收到连接握手。不是工程或素材损坏，也不是 Freesound 配置问题。

## 修复和回归

仅将同一 shotCaptions.js 映射的 importer 条件扩展到候选模块，沿用现有虚拟模块与加载器，不改 SDK 安装目录。新增 openchatcutStudio.modules.integration.test.ts，启动真实嵌入 Vite、创建隔离原生工程，从 Editor.tsx/useEditorController.tsx 递归请求所有 Loop Control 虚拟依赖，并断言 HTTP 200。修复前该测试稳定 500，修复后通过；覆盖的是真实导入边界，不是静态字符串断言。

24 项音频/嵌入桥接组件回归、npm run check 通过。类型检查另发现前次新增音频测试 mock 使用了过窄的参数类型，已改为接收 unknown 后按测试输入读取；无产品行为改变。npm run runtime:prepare 和发布物完整性通过；此适配器运行时从源码脚本加载，后端发布物 ID 仍为 11651d9347870b55a02992b36cf634b8d9d0b706b91f44c7880d294112d1d092，无需重启日常 5174。

## 实际恢复和数据核对

初次排查时没有已运行剪辑进程。本次测试打开的失败子进程始终未连接，原生 iframe inert，无法编辑；已保存工程基线后仅结束该失败子进程（未删缓存/SQLite/素材），随后从原入口打开修复后的会话。验证页连接成功后关闭验证页，再在用户原来的失败页面重载并重连，避免两个窗口争抢编辑器。用户原页保存按钮已启用，预览、字幕和时间线已显示；editor.png 是用户原页面最终截图，保留该页面和剪辑服务供继续使用。

业务工程 revision/project SHA/配乐默认连接前后完全一致。原生文档完整深比较仅 selectedId/selectedIds 改为当前镜头，排除选中状态后对象深比较及排序后的内容 SHA 一致，详见 preservation.json。原始 JSON 序列化 SHA 不同也受键顺序影响，因此不将字节 SHA 差异误判为业务编辑。

没有生成、检索、导入、采用、重剪、删除或修改现有时间线/字幕/音量。未提交推送。

过程记录：初始 zsh 通配符无匹配后改用显式路径；内部重载受宿主 inert 与连接遮罩阻断两次，停止重复操作并改用实际 HTTP 依赖图；初始发布物脚本误读取 void 返回值，改用 readPreparedRuntimeRelease；无秘密或请求鉴权信息写入报告。
