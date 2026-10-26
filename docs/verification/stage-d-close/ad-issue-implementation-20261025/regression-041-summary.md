# 041 整合后的联合检查

在 #141 的三文件必要修复合并后，裸 `npm test` 为 **112 文件、889/889**，保持默认 5000ms 与既有并发设置；`npm run build` 通过，包含 TypeScript 检查。均未发 Provider 请求。真实规划、正常队列和交付链另按专项证据验收，不能由本结果替代。

| 仍保留的检查信息 | 影响与本轮处理 |
| --- | --- |
| 两条 `TextArtifactContent` 未包在 `act(...)` 的提示 | 出现在审核台的两个 React 测试，指向异步文本加载的测试时序边界。测试断言全部通过，提示仍完整保留；没有屏蔽 stderr、删除断言或放宽超时。本轮真实页面和 HTTP 的独立验收不以这两条测试替代。 |
| legacy `n8n` 检查：2 pass、1 skip | 原有条件为本机未安装 `n8n/node24/node_modules/@n8n/workflow-sdk`。前两项静态导入/透传合同检查通过，第三项节点 SDK 校验没有执行。原生入口使用本地自动化；本轮不安装已保留的 legacy 依赖，也不声称 legacy 节点配置经过完整校验。 |
| Vite 大于 500 kB 的 bundle 提示 | 主 JS 为 590.47 kB，gzip 177.93 kB；构建成功。提示说明加载资源体积，不能单凭构建结果证明性能或容量。本轮未调高阈值、隐藏提示或增加无关分包改造；没有执行 E/F 性能验收。 |

原始日志和 JSON 回执分别为 `integrated-041.log`、`integrated-041-result.json`、`integrated-041-build-private.log` 与 `integrated-041-build-result.json`，封存于本轮私有运行目录并由证据索引记录。这里没有把未执行项改为通过，历史失败与未验收门禁仍保留。
