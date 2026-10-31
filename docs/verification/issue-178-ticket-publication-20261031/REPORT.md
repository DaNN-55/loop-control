# Issue 178 拆票发布回执

父规格：[账号工作区重组与统一媒体根 #178](https://github.com/DaNN-55/loop-control/issues/178)。

所有者已确认 17 票的粒度、内容和依赖；本轮仅发布任务票，未实现功能、提交或推送代码，未操作日常数据库、服务和媒体目录。

已通过 GitHub 原生接口逐票回读核对：17 张开放子票、17 条父子关联、22 条原生阻塞关系、96 条验收项；每票正文与本次发布内容一致，均仅有 ready-for-agent 标签。父规格标题、正文与状态保持不变，未追加父规格评论。

核对时间（UTC）：2026-10-31T07:36:13.995380+00:00。正文指纹、实际票号及依赖保存在同目录的 issues.json。

| 任务 | GitHub Issue | 直接阻塞 |
|---|---|---|
| T01 | [[账号目录 T01] 兼容新旧生产单位置](https://github.com/DaNN-55/loop-control/issues/179) | 无 |
| T02 | [[账号目录 T02] 重组账号工作区](https://github.com/DaNN-55/loop-control/issues/180) | 无 |
| T03 | [[账号目录 T03] 全局媒体根设置与初始化](https://github.com/DaNN-55/loop-control/issues/181) | #179 |
| T04 | [[账号目录 T04] 创建账号自动建立专属目录](https://github.com/DaNN-55/loop-control/issues/182) | #180、#181 |
| T05 | [[账号目录 T05] 创建系列自动建立目录](https://github.com/DaNN-55/loop-control/issues/183) | #182 |
| T06 | [[账号目录 T06] 脚本与导入素材兼容新位置](https://github.com/DaNN-55/loop-control/issues/184) | #179 |
| T07 | [[账号目录 T07] 图片与视频制作兼容新位置](https://github.com/DaNN-55/loop-control/issues/185) | #179 |
| T08 | [[账号目录 T08] 音频与字幕制作兼容新位置](https://github.com/DaNN-55/loop-control/issues/186) | #179 |
| T09 | [[账号目录 T09] 剪辑工程与交付兼容新位置](https://github.com/DaNN-55/loop-control/issues/187) | #184、#185、#186 |
| T10 | [[账号目录 T10] 归档与删除适配新层级](https://github.com/DaNN-55/loop-control/issues/188) | #183 |
| T11 | [[账号目录 T11] 新层级的真实备份与恢复](https://github.com/DaNN-55/loop-control/issues/189) | #183、#187 |
| T12 | [[账号目录 T12] 正式启用新生产单目录层级](https://github.com/DaNN-55/loop-control/issues/190) | #187、#188、#189 |
| T13 | [[账号目录 T13] 旧账号与生产单受控纳管](https://github.com/DaNN-55/loop-control/issues/191) | #190 |
| T14 | [[账号目录 T14] 同账号跨系列收纳调整](https://github.com/DaNN-55/loop-control/issues/192) | #190 |
| T15 | [[账号目录 T15] 全局媒体根迁移盘点](https://github.com/DaNN-55/loop-control/issues/193) | #191 |
| T16 | [[账号目录 T16] 全局媒体根迁移与中断恢复](https://github.com/DaNN-55/loop-control/issues/194) | #193 |
| T17 | [[账号目录 T17] 完整验收与兼容收尾](https://github.com/DaNN-55/loop-control/issues/195) | #192、#194 |

初始可执行入口：T01／#179 与 T02／#180。其他任务等待其全部直接阻塞票完成。

依赖状态以 GitHub 原生关系及实时 Issue 状态为准；本回执只证明发布时的内容与关系，不代表实现或功能验收通过。

后续实现继续遵守父规格已确认的正式页面 → Owner HTTP → 隔离真实数据库与文件 → 原生工程／系统打开边界；不调用付费服务，不迁移或删除日常数据。
