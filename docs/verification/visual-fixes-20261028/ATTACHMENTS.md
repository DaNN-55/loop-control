# 历史测量附件

> 产物清理记录（2026-11-18）：本报告所链接的部分历史截图、视频、日志或导出附件已按用户要求清理；原验收事实保留，已删除附件改为文字标记。生产单、数据库、业务素材及必要测试输入未删除。


2026-11-02 目录清理：大型测量 JSON 已无损压缩为同名 `.json.gz`，解压后的字节与原文件完全一致。报告、截图和分析结果保留；`analyze-colors.py` 支持直接读取压缩文件，也兼容重新采集生成的未压缩文件。

需要独立查看 JSON 时，可在本目录运行 `gzip -dk measurements.json.gz`；此命令保留压缩文件。

保留的压缩附件：

- raw-measurements.json.gz（历史附件已清理：`raw-measurements.json.gz`）：解压后 25,932,511 字节，SHA-256 `ca29e0875d0d18e417594fc95dc8cf27c5a0c13562576f43e38711ab835995f8`。
- measurements.json.gz（历史附件已清理：`measurements.json.gz`）：解压后 22,633,054 字节，SHA-256 `e81f5aa3e44d1e7dfd7570e939d3cc60a897a29d79f799a9bd5a25acde02047f`。
