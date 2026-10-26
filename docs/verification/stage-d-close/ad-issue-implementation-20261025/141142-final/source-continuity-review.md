# C11 同一版本/同一生产单：源码连续性预审（只读）

## 结论

不能、也不应声称“整条成功链从头到尾运行在同一完整源码 SHA”。041 已在两次真实 CLI 前应用；此后又有 142 本地 clip classifier 修复、TTS opt-in 时序变更，且 042 尚在独立准备。**但 C11 可采用 C18 允许的‘差异核对 + 必要联合验证’路径闭环**，不需要重新花未批准的 CLI/Provider 额度，前提是以下证据全部落地。

## 已可继承的同单证据

- 同一 Episode `5eb48e39…` 的 visual 与 storyboard 都是实际 CLI（78.950s/59.512s），产物相互引用、任务 UUID namespace 和冻结输入 SHA 连续；041 的 trigger 已注册，旧 rows/budget/failure 未改。
- Pexels search/download 与 Volc verify/generate 是该单已接受的真实 200；真实 MP3 已由 Owner 听取并接受。transport、narration adapter 与 Provider ledger 路径若逐文件 SHA 未变，可继承其“已发请求/已接纳音频”事实，不能重发。
- clip 的两次失败必须保留；其根因是 local clip 被 `credentialRef` 误判为外部执行。142 把分类改为已注册 executor 的 connection kind，故 clip 是受影响路径，必须在最终源码重验。

## 必要、非宽松的最终联合验证

1. **先冻结最终源码清单。** 将 041/040/042、`localWorkerCli`、`mediaWorker`、`narrationWorker`、Provider transport、registered adapter、alignment/preview/Studio/package 的 SHA 与每个旧任务的执行时 SHA 作显式 diff 分类。041 已在 planning 前；042 若应用，须证明仅 future INSERT，旧 task/run/artifact/ledger 无变更。
2. **逐模块继承而非整链冒充。** Provider transport/narration adapter byte-identical 才可复用四个 200 与 MP3；TTS opt-in 必须证明只作用未来新 namespace/task，不重写已接受音频/正文/connection/version。任何不相同或无法证明不影响的模块，不能借旧绿。
3. **最终源码正常重启同单。** Owner readback 核对旧 visual/storyboard、Pexels artifact、MP3、连接引用、输入版本、task/run 与 ledger；不得创建新的 online task/request。
4. **最终源码跑受影响的本地后半链。** 在同一 Episode 以既有真实 Provider 产物完成 classifier 修复后的 clip，再实际 alignment、文本确认、preview、Studio、QC/final、package；每一步保存输入/产物 SHA、Owner 操作和重启后读回。失败即保留，不回填或重建前段。
5. 最终报告表述为“同一生产单在最终源码下的可追溯连续验收；前段真实外部调用由未变模块和冻结记录继承”，绝不称全程同 SHA。

## 关闭前的硬证据缺口

当前尚未看到第 1 项的最终 SHA/diff manifest，或第 3–4 项的 final-source restart/readback 与后半链结果；因此 C11 现在不能关闭。它们是本地验证，不构成重新执行 CLI/Pexels/Volc 的授权。C18 也仍须逐票确认后续变更与公开/私有索引。
