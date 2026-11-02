# 历史测量附件

2026-11-02 目录清理：大型测量 JSON 已无损压缩为同名 `.json.gz`，解压后的字节与原文件完全一致。报告、截图和分析结果保留；`analyze-colors.py` 支持直接读取压缩文件，也兼容重新采集生成的未压缩文件。

需要独立查看 JSON 时，可在本目录运行 `gzip -dk measurements.json.gz`；此命令保留压缩文件。

保留的压缩附件：

- [raw-measurements.json.gz](raw-measurements.json.gz)：解压后 25,932,511 字节，SHA-256 `ca29e0875d0d18e417594fc95dc8cf27c5a0c13562576f43e38711ab835995f8`。
- [measurements.json.gz](measurements.json.gz)：解压后 22,633,054 字节，SHA-256 `e81f5aa3e44d1e7dfd7570e939d3cc60a897a29d79f799a9bd5a25acde02047f`。
