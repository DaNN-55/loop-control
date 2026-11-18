# D 封面来源与交付边界子批

> 产物清理记录（2026-11-18）：本报告所链接的部分历史截图、视频、日志或导出附件已按用户要求清理；原验收事实保留，已删除附件改为文字标记。生产单、数据库、业务素材及必要测试输入未删除。


日期：2026-11-14。状态：本子批完成，完整 D／A–G 仍在实施。固定末轮源：`/Volumes/Ebuget 1T/loop-workflow-private-backup-20261114-5bk8z1hx/export-runs/loop-story-e2e-C7BO5x/source`。不操作日常、不调用真实 Provider 或视频 API、不提交、不推送。

## 行为

保存计划中的封面在接入边界转换为 `workspace-cover-source/v1`，固定当前同单 material ID 与 SHA；登记的历史 cover artifact 也作为当前可选项。读取只列候选和登记状态，不自动选择、不把登记当作文件已核验、不继承原连接／费用授权。原计划及 source evidence 不写回。

页面选择下拉框只改变选择，点击「使用已选封面」后经 Owner 文件接口读取及检查；交付明确提交准确 kind／ID／SHA，服务端重新核对同单候选和真实文件。合法图片才被复制为本次交付的不可变文件，metadata 记录来源。手工上传仍走原校验；两种输入同时提交被拒绝。当前人工选择优先，旧下载迟到不能把它换回原封面。

封面放大预览原先被嵌套在替换封面按钮里。公开 DOM／交互测试先复现嵌套原生按钮，再将放大与替换改为并列控件，保留已有预览对话框和文件选择行为；没有修改全局 ImagePreview 或增加依赖。可见下拉标签与控件使用 id／htmlFor 关联。

## 验证

- 最终同源 2 项真实 Owner HTTP／PG／文件／SDK／浏览器／Worker／下载集成通过，分别使用 material 和 artifact 封面；同文件另外 11 项由名称过滤未执行，不计通过。
- 两种来源分别验证错 SHA、未知 ID、另一生产单实际登记 ID、畸形 UUID、数组 kind、宿主 root 字段、引用与字节混用、错误 Owner、同长度文件翻转字节和缺失文件；拒绝后无交付入队，原素材记录和原计划保持。原文件在自有测试夹具中恢复后，明确选择仍可正常交付。
- 两条实际浏览器流程均验证选择不提交、明确使用、放大与关闭、无嵌套按钮、桌面和 390px 宽无横向溢出、双击只创建一笔交付。隔离 Worker 完成，Owner 下载逐项 SHA 校验，metadata 的来源等于所选封面。当前截图为末个 artifact 分支，未宣称所有历史来源恢复都完成。
- 最终 2 文件、53 项单元／组件通过，0 跳过，包括人工上传、迟到下载不覆盖人工文件、导出作用域变化、草稿恢复、预览 URL 清理、错误图片和原交付重试。封面控件修复有真实 red→green，不靠重复运行消除失败。
- Worker／backend 构建与完整 TypeScript 检查通过；没有运行默认完整套件，仍留到最终 G。
- Standards 与 Spec 两轴独立只读审查均 0 开放。Spec 提出的证据限制已落实：负向随所选来源参数化，真实跨单来源也分两种；篡改保持文件长度，单独证明 SHA 校验，而非只证明大小检查。

早期浏览器辅助脚本两次失败分别为 CLI 不支持 `find label select`，以及用可见文本等待只有 aria-label 的关闭图标；检查实际 CLI 帮助与 DOM 后改为既有 select 和可访问名按钮就绪机制。未增加超时、强制点击或改变产品校验，复盘和原日志保留。

## 保持与范围

本子批未增加 SQL 迁移，有效 schema 仍至 197。原脚本、草稿、音轨、冻结证据、原生文件和原包均保持；13117 个开始时已有文件中，差异限本子批源码／测试和进度文档。最后源与当前 src／scripts／db／public 对账无差异，HEAD／物理索引保持，SDK 2,782 文件与既有参考一致。9 次自有隔离运行均终态、数据库容器均已删除并按名称复查无残留。本子批没有访问日常数据库，不能据此声称日常迁移或采集状态已重新核对。

D 原声意图、全部接入来源 DB＋文件／逐项／不同来源 Owner 恢复仍未完成，随后是 B1／C2 剩余覆盖、E1／E2、F1／F2 与最终 G。当前 artifact 文件名可能是原文件哈希名，可读名称归 F1 处理，不改原路径或 SHA。棋盘格仍是独立 Proposed 问题，共享 SDK 未修改。

证据：[末轮结果](evidence-d-cover/vitest.json)、material 回执（历史附件已清理：`evidence-d-cover/material-cover-receipt.json`）、artifact 回执（历史附件已清理：`evidence-d-cover/artifact-cover-receipt.json`）、组件结果（历史附件已清理：`evidence-d-cover/cover-units-final.json`）、保持及运行清单（历史附件已清理：`evidence-d-cover/verification-final.json`）。

现代网页指南本批使用 `accessibility`：我将替换与放大保持为不同名称、原生键盘可操作的并列控件，且不因选择来源自动提交（“Don't reuse an accessible name across controls with different effects in the same view”）。沿用既有 React Aria 预览对话框，本次没有另造模态框实现。
