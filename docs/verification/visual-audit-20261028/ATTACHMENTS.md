# 历史测量附件

2026-11-02 目录清理：大型测量 JSON 已无损压缩为同名 `.json.gz`，解压后的字节与原文件完全一致。报告、截图和分析结果保留；`analyze-colors.py` 支持直接读取压缩文件，也兼容重新采集生成的未压缩文件。

需要独立查看 JSON 时，可在本目录运行 `gzip -dk measurements.json.gz`；此命令保留压缩文件。

保留的压缩附件：

- [measurements.json.gz](measurements.json.gz)：解压后 13,149,480 字节，SHA-256 `860d51d4e6d87e0c7821f8e58d71b50d8d4fe1c2a9a0eed6a22c57af0a0a297b`。
