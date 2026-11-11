# 分批 Git 交付记录

用户授权将全部已完成工作分批提交、合并并推送。业务代码沿用最终验证内容；此次只整理提交，不重载服务、不操作真实数据。

## 基线与回退

- 原 main：`dc810e1fe812e3e9c45915e181607a412fbf7219`。
- 开始交付时 origin/main：`86bc9e66f86a12c6458ab7583d796b4ec6d7182c`；远端没有领先提交。
- 保留 main 上原有两条未推送提交：`507804cb`、`dc810e1f`。
- 本轮完整工作区检查点：`codex/before-batched-delivery-20261111`，对象 `ccc071eafd2b1da1df0a22b703da4645066c92df`。通过独立索引建立，原暂存区为空且未被覆盖。检查点仅本地保留。
- 工作分支：`codex/settings-workflow-delivery-20261111`。共七批，完整路径清单见 batches.json；最后一批归档研究、设计和验证证据及本记录。

| 批次 | 范围 | 提交 |
| --- | --- | --- |
| 1 | language | `8b5a4e79ba58` |
| 2 | runtime | `cdd2118a7047` |
| 3 | product | `9da21493f7d0` |
| 4 | connections | `1960dfcc2d95` |
| 5 | tests | `aa644e882de0` |
| 6 | demos | `3dba918f6b14` |
| 7 | docs：研究、设计与验证证据 | 本记录所属提交 |

## 验证

- 交付前完整默认测试：290 文件、2104 项通过，0 失败、0 跳过。证据：`../runtime-version-legacy-20261111/default-tests-final.log`。
- TypeScript 检查通过：`../runtime-version-legacy-20261111/typecheck.log`。
- 对原 232 个变更源码、数据库和脚本路径逐一核对 SHA-256，分批提交期间内容与测试完成后的快照一致。仅 Git 操作和交付文档有后续变更，没有重复执行默认测试。
- 自定义强凭据模式扫描覆盖 740 个文本文件（包括原两条未推送提交），0 匹配。扫描范围包括常见供应商/GitHub/AWS/Google 密钥、私钥头及真实形态的会话 cookie；这不是对任意秘密的完备检测。
- 文档批次保留原始日志输出与 Markdown 换行，默认空白检查有 154 条行尾空格/文件尾空行提示；限定本次命令忽略这两类格式后检查通过，无源码格式问题。
- 48 类业务验收与真实隔离集成记录见 `../receipt-rules-implementation-20261111/REPORT.md`；此处不重复叠加有交叉的测试数量。

## 合并与推送方式

全部批次完成后核对工作区与源码指纹，将工作分支快进合并到 main，正常推送 origin/main，并对比远端 HEAD。合并与推送的实际结果以 Git 引用及最终交付回复为准，不预先记录为成功。
