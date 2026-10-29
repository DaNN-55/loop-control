# 脚本预览与视觉资料归位验收

2026-10-29；真实生产单 `92b3067d-ced9-4e85-bc44-1968fa83695a`。

## 修改

- 桌面脚本正文固定 800px，内部纵向滚动；沿用现有 850px 单列布局边界，窄屏保留 `clamp(260px,52dvh,480px)`。放大窗口依可用高度，上限 800px。编辑器高度与紧凑 Markdown 排版不变。
- 视觉参考从审核包冻结输入、原有视觉参考修订和生成图合并，按路径与 SHA-256 去重。旧生产单缺少视觉参考用途修订时，仍可读取冻结视频。
- 节点制作依据隐藏媒体组件，仅保留审核/冻结证据、资产清单与文本参考组。传统审核台默认行为保留。未修改素材、审核包或真实业务记录。

## 验证

- `npm run check` 通过。
- `ProductionNodes.test.tsx` 17 项通过；新增旧包只有冻结输入时，视频/图片/生成图统一进入参考区且制作依据无媒体的回归。
- `ReviewWorkspace.test.tsx` 68 通过、4 失败。以临时 Vite transform 将本次媒体显示条件恢复为始终显示后，仍为相同 4 项失败（镜头确认、旧镜头合同提示、删除镜头修订按钮、预渲染包显示）；未改动这些已有工作区测试或功能。JSON 对照附后。
- 前端构建输出到 `/private/tmp/loop-visual-layout-build-20261029` 通过，未覆盖运行中的后端构建；存在已有大 chunk 提示。
- 浏览器 1543×953：脚本 clientHeight=800，scrollHeight=2235，clientWidth=scrollWidth=935。390×844：height=439，scrollHeight=3371，clientWidth=scrollWidth=270；正文没有横向滚动。窄屏页面标题已有挤压问题，本次未扩展到头部重排。
- 真实视觉参考列出 11 个冻结视频；首项 a-shot-001.mov readyState=4、1080×1920、error=null。制作依据媒体数为 0，保留 11 项冻结输入摘要。截图见本目录。
- Impeccable 静态检查已执行，结果保留于 detect.json；未为本次高度/归组调整扩展全页设计规范整理。

## 证据

- [桌面脚本](script-desktop.png)
- [窄屏脚本](script-narrow.png)
- [视觉参考](visual-references.png)
- [制作依据](visual-basis.png)
- [节点回归](nodes-tests.json)、[审核台现状](review-tests.json)、[媒体显示还原对照](review-baseline.json)
