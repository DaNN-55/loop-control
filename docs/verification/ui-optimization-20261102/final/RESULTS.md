# 最终统一验收

最终产品快照为 `6421a779ce1be462bda3c4e04157fecabeb5f627`。完整源码与已安装的干净 OpenChatCut 0.2.17 分别通过 `git archive` 流式建立隔离副本，再编译 Backend／Worker。迁移、SDK、测试诊断覆盖与运行时指纹见 [清单](6421a779/source-sdk-migration-manifest.json)。没有日常 5174 写入、迁移、重启、真实凭据或付费供应商调用。

[83 项映射](83-id-mapping.md)逐项引用工单证据；U44 由04／05共同完成，只计一次。[最终场景记录](6421a779/T01-T08.json)区分实际补测、原工单证据与未执行项，不将协调器的8个标记当作全部通过。

|场景|实际结果与证据|
|---|---|
|T01 状态与恢复|[5项真实HTTP／Worker验收](6421a779/generation-release/vitest.json)与[原生未知口播](6421a779/native-speech-unknown.json)通过；原任务、远端ID、发布证明与供应商POST次数受保护。[只读记录2项](6421a779/readonly-release/vitest.json)通过。|
|T02 原生与交付|正式main物理拖动字幕时间和画面位置，保存后正常重开SHA一致；[内置音效2项](6421a779/sound-release/vitest.json)通过，包含实际MP4波形及ZIP字节核对；[Pexels6项](6421a779/pexels-release/vitest.json)通过。两处口播采用均先显示真实影响，再次确认后采用。|
|T03 尺寸与缩放|正式main390／640／900／1366无页面横溢；[真实浏览器200%](6421a779/formal-main-browser-200.json)：`getZoom=2`、DPR2、CSSzoom1，保存和原生画面可达。|
|T04 主题与对比度|[正式main六皮肤](6421a779/formal-six-skins.json)必要文字采样均≥4.5，目标属性／对比度violation0；仍保留moderate主地标／H1结构建议和axe incomplete。|
|T05 键盘与草稿|[正常iframe菜单键盘](6421a779/formal-native-keyboard-menu.json)通过；[旧tab放弃不擦新草稿](6421a779/two-tab-draft-and-validation.json)通过，确认框初始取消焦点与Tab圈实际验证。附带字段错误观察被后续导航中断，未计手工通过。|
|T06 规模|OwnerHTTP创建101单，首屏20项／6页；[51镜头](6421a779/scale-51-shots.json)使用49份独立MP4及2PNG，占位0、缺失0、历史50；[实际播放](6421a779/scale-main-playback.json)readyState4、解码18帧、DOM3898。实际受控目录120个模型，正式Dialog121行，搜索末项仅剩1行。|
|T07 故障|[真实进程与APFS](6421a779/process-disk-recovery.json)停启／卸载409／同设备身份重挂后200，版本与SHA保持；[GET503和会话过期](6421a779/http-session-recovery.json)恢复正确上下文。较早dev变化拒绝是ADR0019的预期保护，未重绑或放宽检查。|
|T08 输入与并发|[混合上传](6421a779/mixed-upload.json)2成功3失败，登记仅+2；100MB+1拒绝且无新增；[服务端媒体4项](6421a779/material-release/vitest.json)通过。[正常双编辑器并发](ccb9470/normal-editor-concurrency.json)实际Owner409且保护另一窗口SHA；此项在ccb测得，相关Host／Bridge／持久化代码到642未变，清单明确记录差异，不冒充642新实测。|

根Agent在同一642快照完成 `check`、`runtime:prepare`、233个默认测试文件／1557项通过、`build`，均exit0；1项历史测试skip未计通过。原始结果见 [默认测试](6421a779/root-default-vitest.json)。本工单新增的生产选择测试维护已由根Agent纳入提交，保留prepare／confirm幂等、冲突、未知提交与冻结事实断言。

早期音效503和Pexels120秒超时在两轮串行完整链中未复现，保留SDK输出和HTTP错误，不推断为负载原因。未运行VoiceOver、真实移动设备、全部第三方效果参数或高码率规模压力；内存数据是合成规模的单次样本。资源清理见 [cleanup.json](cleanup.json)。
