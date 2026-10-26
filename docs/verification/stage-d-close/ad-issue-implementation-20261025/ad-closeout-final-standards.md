# Standards review

范围为 `bbd2987` 以来指定的工作区改动；仅审规范，不审需求覆盖。

## Critical issues

- **P1 — 失败登记会污染已接受产物。** `nativeAttemptOutput.ts:55-65` 先逐文件 `rename` 到 canonical 路径，再登记结果并提交；登记失败只回滚数据库。`publishFile` 的 `rename`（:71-80）会覆盖同任务已有文件，旧产物索引/哈希却留在库中。ADR-0008 要求结果与产物索引受同一围栏保护，迟到结果不得覆盖产物引用。现有失败测试（`nativeAttemptOutput.test.ts:114-120`）只证明新文件留在 staging，未覆盖已有 canonical 文件。最小修复：在仍持有围栏锁时保存并在失败时恢复被替换的 canonical 文件（或在登记成功前不替换）；增加“旧文件+登记失败”及多文件部分发布测试。

## Important improvements

- 除此之外未发现本范围内新增的硬规范违例：确认状态由服务端当前音频/正文/对齐版本判定，UI 仅显示同一判定；网络锁定时连接检查未读取 Keychain；原会话请求围栏仍按代次拒绝回填。

## Optional notes

- `prepareNativeAttemptOutput` 是合理的文件/DB 边界封装，未见需处理的命名、重复或过度抽象 smell。

## Verification suggestions

- 修复后仅补跑该 helper 测试和已有 Worker 产物验收；断言失败后 canonical 字节、DB 旧索引及 staging 诊断文件各自正确。
