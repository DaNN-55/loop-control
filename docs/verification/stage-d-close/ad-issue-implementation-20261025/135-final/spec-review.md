# #135 / C04 票内关闭复核（只读）

## 结论

**C04 可关闭（同机独立冷初始化范围）**。不是新硬件/跨平台安装通过，也不推断生产切换或其他 D 阶段门禁完成。

## 核对结果

- 独立性：空目标记录 `oldVenvBorrowed=false`、`oldModelCacheBorrowed=false`；新 CPython 3.11 venv、用户/site packages 禁用、新模型目录及新 app home/orchestration。首次 probe 记录 `priorModelLoads=0`，Python audit 是该新 prefix、cache-only、OS 网络隔离。
- 下载与身份：102 个固定运行包、103 个新 wheel/sdist，固定 revision/三份 WhisperX 源码及完整模型 SHA 相符；官方受限代理累计 `1,547,345,115 / 3,000,000,000` TLS 入站字节，旧 cache 未复制，准备完成后代理停止。截断响应、CDN 白名单、零字节归档和 range 恢复失败/纠正均保留。
- 时间与失败：首次依赖初始化 `79.214s`（原 120s），首次有效模型 probe `6.114s`（原 `30000ms`，无 override）；缺依赖、真实 pip 中断和未 sealed 准备均明确拒绝且可恢复。未把后续正常入口 probe 冒充首次 probe。
- 正常入口：`npm run local:prepare-offline -- --deployment <cold>` 后，以正常 `npm start` 的显式 `--offline-test` 保护启动；新 Owner 新 Account/Episode 经正常队列产生新的 `local_whisperx` 对齐，而非历史回放，HTTP 产物 SHA `05f4…f1e5`。停止/重启后不同 PID 的两次读取与该 SHA 一致。
- 清理与保留：所有本轮 app/model/proxy PID 已退出，55189 空闲；默认指针、下载 ledger 未变，Provider 请求 0；历史失败和未验收门禁仍保留。

## 边界

`--offline-test` 是本票“推理期禁止联网”的显式正常启动保护；它不证明无该保护的在线/生产入口。Owner 是导入身份，不是新 UUID；受控规划只造测试输入，不构成 AI 规划质量验收。SQL、Provider、E/F 和新硬件安装继续不在关闭宣称中。
