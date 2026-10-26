# T06 默认预算与真实浏览器补验

2026-10-23；只补验 T06，T07 未开始。B=`474b0d3aa20d6bacf1f34cd16661da56552a1957`，T06=`8da46edf31236a6e4dd7a06d2a6220bb64c3e405`。未修改业务代码、测试断言或超时，未操作生产。Owner 已认可补验结论，授权仅将本目录报告、回归日志、脱敏证据与索引提交到当前分支；不推送或合并，默认 5 秒门禁仍未通过。

## 明确结论

- **“默认 5 秒失败是否为 T06 新增失败”的归因缺口可以关闭。** 同机、同环境、同配置和命令的 B→T06→T06→B 四轮，均仅同一个旧审核台用例超时，B 也可重复失败；未发现 T06 独有失败。不能据此证明 T06 对所有时序完全没有影响，也不能把宿主负载断言为唯一根因。
- **“默认 5 秒完整回归全绿”不能关闭。** 四轮退出码均为 1；本轮没有使用更大测试预算。先前 15 秒通过不能替代默认预算门禁。
- **本次要求的真实浏览器提交、状态展示及刷新缺口可以关闭。** 真实 Chrome 点击表单，两次 RPC200→dispatch202；排队在整页刷新后保留；一次受控唤醒丢失后恢复同一任务，另一次不暂停领取便自动完成；最终整页刷新后仍为新版、单镜头、已完成。两个修订各一条真实执行和一件产物，磁盘哈希匹配，没有刷新重复执行。

## 默认 5000ms 对照

源代码由 `git archive` 依次展开到同一个私有目录，不切换当前 checkout，不创建分支或 Git 工作树。四轮共享同一依赖安装、同一 `cleanEnvironment` 隔离环境，原 `vite.config.ts`、`package.json`、锁文件摘要逐轮一致。Node v24.20.0、Vitest 3.2.7；maxWorkers=1；没有 testTimeout 覆盖。完成四轮之后才启动浏览器/媒体验证，未自造并行验证负载。

每轮执行同一命令（路径及完整参数见 [manifest](comparison/manifest.json)）：

```text
node <同一快照目录>/node_modules/vitest/vitest.mjs run --maxWorkers=1 --exclude n8n/import-workflows.test.mjs --exclude '**/*.integration.test.ts'
```

| 顺序 | 版本 | 文件 | 用例 | 失败用例计时 | 退出码 |
| --- | --- | --- | --- | --- | --- |
| 1 | B | 69通过 / 1失败 | 674通过 / 1失败 | 5232ms | 1 |
| 2 | T06 | 69通过 / 1失败 | 673通过 / 1失败 | 5065ms | 1 |
| 3 | T06 | 69通过 / 1失败 | 673通过 / 1失败 | 5088ms | 1 |
| 4 | B | 69通过 / 1失败 | 674通过 / 1失败 | 5045ms | 1 |

四轮唯一失败均为 `src/reviews/ReviewWorkspace.test.tsx` 的“分镜批准后按整期 BGM、TTS、逐镜头声音的顺序显示并保存独立音效选择”，默认 5000ms 超时。上述计时是被超时截断的时长，不能比较完成性能；两版总数差异来自 T06 既有测试替换，不是本轮少跑测试。原始 stdout/stderr 原样复制为 [1-B](comparison/1-B.txt)、[2-T06](comparison/2-T06.txt)、[3-T06](comparison/3-T06.txt)、[4-B](comparison/4-B.txt)，SHA-256 已核对，宿主信息、负载和环境摘要均在 manifest。

## 真实 Chrome 验证

仅用 verified 隔离目标：console55176 / API55461 / DB55462。使用独立 Chrome 会话 `t06-verified-followup` 和实际 Owner 登录。测试 Episode `6dd2ba66-a0a5-47b9-9d8b-1017cd707f81` 为新追加的合成已批准基线，含真实磁盘输入与两个镜头；它不是完整 Owner 审批链或在线 Provider 验证。

验证临时配置只转发业务已有的 `/_episode-dispatch`、`/_local-artifact`；其他本机工具503。没有修改这两个 handler、Worker 或前端。结束已恢复原 verified 控制台配置并关闭自己的 Chrome。旧任务在执行期间用行锁保护，结束前后完整行摘要相同。

1. 页面展开 s2 → 更多操作 → 删除镜头 → 填修订原因 → 提交分镜结构修订。真实 RPC200，任务 `76f57578-c0e0-44b4-a66c-0c5c39ba57b4`，dispatch202/queued。数据库为 ready/attempt0；[页面排队](browser-queued.txt)。
2. 为观察队列先暂停 claim；整页刷新后重新打开生产单，仍显示“已排队，等待 Worker 领取”和“正在后台应用删除镜头”，仍两个旧镜头；[刷新后快照](browser-queued-refresh.txt)、[截图](browser-queued-refresh.png)。没有再次提交表单。
3. 暂停时间超过既有 DB statement timeout，首次即时唤醒报错；该故障由验证门闩造成，日志保留。释放门闩后通过既有单任务 dispatcher 消费同一 taskId，无新建任务，完成 v2（只留 s1）。页面显示已完成；[快照](browser-completed.txt)。这是丢失唤醒恢复场景，不冒称首次唤醒自动成功。
4. 第二次通过实际页面将 s1 从 A-roll 改为 B-roll，不暂停领取、不再手工派发。真实 RPC200→dispatch202，任务 `adc0bba0-0add-4619-a84a-a34a8c9dccfe` 由普通 HTTP 唤醒自动完成，v3 只有 s1/B-roll。界面自动显示已完成与新类型；[快照](browser-automatic-completed.txt)、[截图](browser-automatic-completed.png)。
5. 再整页刷新并重新打开生产单：[早一帧快照](browser-completed-refresh.txt)记录“已完成”及“正在读取分镜工作台”；随后[截图](browser-completed-refresh.png)已加载并显示保留镜头 s1/B-roll。不能把早一帧文字快照称为已加载完成的镜头证据。最终 DB 只有两条新修订，各 completed/attempt1、一个 completed run（attempt0）和一个新 storyboard artifact；三个版本磁盘哈希全部匹配。

[脱敏数据库/网络/恢复摘要](browser-summary.json) 保留实际任务、版本、产物和请求状态。HAR 的 POST 记录含同源 Referer，但该采集器遗漏 Origin；两次真实 POST202 通过了最终未改代码的严格 Origin 检查，不能将推断的 Origin 写成直接采集值。实际页面使用已有 Supabase 快照轮询更新，不声称浏览器调用了 statusUrl GET。

原始 HAR、完整 DB 行、helper 和 console 日志保留在忽略的私有目录 `.loop-control/stage-b/verified/state/t06-followup/`，模式600；HAR 含会话头，不复制到版本化报告。[私有原始证据索引](private-evidence-index.json) 记录绝对路径、大小与 SHA-256。

## 验证过程中的保留失败

临时 Vite 配置首启依赖导入错误，仅修正私有 helper 导入后启动；首次登录后 series 读取401，点击页面“重试”后正常，未绕过鉴权。恢复 CLI 首次缺 LOOP_PROJECT_ROOT，补齐其既有配置要求后成功。浏览器文字等待 `s1 B-roll` 超时是因为两段可见文本换行，随后真实 snapshot 已确认相同按钮的 accessible name、新类型和完成状态；没有调整业务超时。以上原始失败与后续成功均保留，未改写旧证据。

本次没有诊断或修复默认测试时序根因。未开展 T07、未调整容量/超时、未测在线 Provider 或完整审批链，也未进行生产操作。
