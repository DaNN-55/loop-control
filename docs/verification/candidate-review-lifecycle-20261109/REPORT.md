# 候选核对生命周期统一验收

日期：2026-11-09。基线：`main / 7d1837a01b3156068284d438c5b39727b10aa674`。对应 ADR-0030。

## 改动与边界

画面与口播共用现有 `useWorkspaceCandidateReview` module 中的生命周期：归属、请求序号、pending、取消失效、同步确认锁、确认前重新读取／SHA 校验及结果发布。画面保留裁切、运动、时长及替换命令；备用图片显式走 `image-backup`／`retainWorkspaceImageCandidate`。口播保留 `use-candidate`、确认成功后恢复正文、独立字幕、人工无候选回退及原有折叠／模式边界。

准备读取可建立新的 SHA 基准；同 SHA 的 revision 更新不取消核对，确认使用最新 revision。采用自身产生的新 SHA 不吞成功回调。取消可阻止未发送的采用；已经发出的命令无法靠本地取消撤回，仍存活归属发布权威结果、抑制已取消的局部成功回调。切换归属／卸载不向新归属发布旧结果。

未修改后端命令、数据库、CAS／事务锁、`adoptionId` 或生成授权；未调用真实付费供应商、修改日常业务数据、重启日常服务或推送远端。

## 回归

- 新增生命周期与界面输入回归 15 项。取消后迟到准备、外部 SHA 更新、捕获的旧确认回调以及确认读取期间再次准备，均先取得失败断言，再验证修复。另在待提交版本保留的旧原生入口中增加 1 项取消回归，证明原生编辑返回前取消不会再发采用命令。
- 最终工作区定向回归：6 文件、63 项通过，包括画面采用／读取、口播及读取、共享 hook 和真实 React 输入。
- 暂存源码单独展开验证：类型检查通过；第一轮 5 文件、56 项通过；审查修复后 3 文件、24 项通过，覆盖旧原生 bridge、新增取消回归和全部共享生命周期／输入回归。暂存版本使用独立 TypeScript build info 再次检查通过。
- 隔离 Owner HTTP／PostgreSQL／真实 OpenChatCut SDK：5 文件、35 项通过，涵盖视觉影响、原生采用重开、SHA／素材变化拒绝、人工口播与字幕保留、原生保存最终状态及失败回滚。临时数据库容器已销毁。
- `agent-browser` 隔离真实组件＋受控 HTTP：旧视觉响应不复现、明确取消／确认、同 SHA 新 revision、备用图片不带伪造采用 ID、Escape 返回焦点、恢复历史正文和独立字幕保留均通过。该浏览器夹具使用受控响应；服务端正确性由上一项真实数据库测试验证。浏览器前两次定位器不兼容及一次菜单关闭后的定位失败均已调整夹具，未据此修改产品代码。
- `npm run check`、`npm run build`、`npm run runtime:prepare` 通过。构建仍有既有的大 chunk 提示；jsdom 仍输出媒体 pause 未实现及部分 act 警告，不影响上述断言。
- 默认完整回归首轮：241 文件，1,742 项通过、1 项导航测试等待 5 秒超时、1 项既有跳过。超时用例为 `LocalCatalogApp.navigation.test.tsx` 的 browser Back／旧 catalog 响应场景；第四项任务也记录过同类超时，未归因为本次改动。审查后确认锁发生变更，因此补跑最终完整回归，结果见下方。

最终完整回归：241 文件全部通过，1,744 项通过、1 项既有跳过；首轮超时导航用例本轮通过。未延长超时、跳过用例或修改该导航测试。

## Standards

初审指出保留的原生 adapter 在取消后、采用 POST 前缺少取消序号校验，已补上并以新增失败／通过回归验证。关于 `expanded` 的文档歧义已澄清为沿用既有关闭归属行为，未改变已批准交互。只读复核：Critical 0、Important 0、Optional 0；未发现需报告的 Fowler smell。`git diff --cached --check` 通过。

## Spec

初审指出确认读取期间仍可发起新准备，已将 `confirm-read` 与 `adopting` 均纳入同步互斥，并验证命令序列只能 prepare → adopt。原生取消边界一并复核。最终只读复核：Critical 0、Important 0、Optional 0。

## 既有改动与提交隔离

开始前保存完整 dirty patch、状态与原文件。22 个无关 dirty 路径哈希／删除状态保持不变。重叠的画面 CSS 导入、口播精简签名及旧原生入口／bridge 清理继续留在工作区；待提交版本保留原入口兼容，并单独做类型和回归验证。共享生命周期核心在工作区与暂存版本保持一致。`PLAN.md` 仅暂存本次前缀，不纳入已有工作区计划修改。

原始证据目录：`/var/folders/6c/wzgq_5_n40lfd6c48djmqwf40000gn/T/loop-candidate-lifecycle-20261109-aufq3pr8`。隔离集成：`/private/tmp/loop-candidate-review-e2e-8h6PlL/evidence`。新回归源码已随任务保存；临时夹具与截图位于原始证据目录。
