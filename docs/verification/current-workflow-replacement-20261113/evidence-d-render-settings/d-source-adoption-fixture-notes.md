# 原声反例夹具诊断

qOrO6a：两条数组反例稳定返回200（预期409），真实校验问题已红。原声用例脚本误写“现有素材”，原协议拒绝400。
8nOVtR：改为支持的“已有素材”后到达准备入口，但选了未配置mediaReady的普通formal fixture，503；不是产品回归。
连续两次原声反馈未到目标症状，重新核对已通过的productionSoundScope首例，采用其受控formal fixture（mediaReady仅执行环境边界，真实FFmpeg Worker仍实际执行），保留原守卫。后续固定corrected fixture再做红绿，不能把前两次当原声缺陷复现。
