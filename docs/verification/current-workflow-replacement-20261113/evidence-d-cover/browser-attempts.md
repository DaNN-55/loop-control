# 封面浏览器辅助脚本两次失败复盘

1. 6HXPo5 使用未受CLI支持的 find label select；实际帮助仅支持 click/fill/check/hover/text，改用既有 select CSS API，控件增加稳定 name 和关联 id。
2. VICuNH 已经选择并打开真实放大对话框，但用 wait --text 查找只有 aria-label 的图标关闭按钮导致25秒超时；源代码确认无该可见文本。改为既有buttonReady按可访问名等待和点击，不增加超时、不强制点击、不改产品事件。

两次后已检查目标、DOM命名、CLI帮助与等待边界，未放宽封面校验或按钮断言；下一次验证同一真实流程。
