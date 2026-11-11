# 分批提交与合并推送

以当前已验证工作区为范围，不改业务代码。原暂存区为空；建立独立检查点，正常index不受检查点写入影响。

- [x] 1. feat(i18n): add bilingual interface foundation and owner locale preferences（33个路径）
- [x] 2. feat(runtime): persist workflow recovery, request outcomes, and recycle state（70个路径）
- [x] 3. feat(ui): apply workspace language, current-task status, and recycle tools（98个路径）
- [x] 4. feat(settings): compact connections and grouped credentials in fixed detail panes（22个路径）
- [x] 5. test: exercise legacy runtime APIs and stabilize receipt read assertions（3个路径）
- [x] 6. chore(demos): retain isolated compact settings layout comparisons（6个路径）
- [x] 7. docs: record workflow rules, design decisions, and delivery acceptance（563个路径）

最后核对源码指纹与2104项全绿验证一致，快进合并到main，正常推送并核对远端提交。
