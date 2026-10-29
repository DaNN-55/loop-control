# #161 复验

使用专属工作树，`node_modules` 可复用已安装依赖。以下所有夹具均创建随机数据库、媒体和端口；环境模块与已安装 Studio 仅只读。禁止指向日常数据库、调用真实付费 Provider 或读取 Keychain。

```sh
export LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/scripts/runtime/environment.mjs
export LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut
npm run check
node_modules/.bin/vitest run src/local-app/WorkspaceVisualCandidatesPanel.test.tsx src/local-app/WorkspaceAudioUpload.test.tsx src/local-app/EmbeddedStudioHost.test.tsx src/local-app/ProductionWorkspacePanel.test.tsx src/local-app/WorkspaceCandidatesPanel.test.tsx src/workspaceAudio.test.ts
npm run build
npm run runtime:prepare
LOOP_WORKSPACE_ACCEPTANCE=1 node_modules/.bin/vitest run src/local-app/workspaceVisualCandidates.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspaceAudio.integration.test.ts --no-file-parallelism --maxWorkers=1
node_modules/.bin/vite-node --config /private/tmp/t09-vite-runner.config.mjs docs/verification/issue-161-workspace-visuals/cli-evidence.ts
```

vite-node 必须使用独立 runner 配置，避免加载日常 vite.config.ts：`export default {configFile:false,cacheDir:'/private/tmp/t09-vite-runner-cache'}`。CLI 脚本使用真正准备过的 Worker 子进程和一次受控 Provider POST，并自行释放私有 APFS 卷、数据库与连接。

UI：以同一 runner 启动 `serve.ts`，再用标准 Chrome 156 独立 profile 与单个 CDP driver。夹具信息写入 `/private/tmp/t09-ui-fixture.json`（0600，合成测试会话）。在该 origin 正常 Owner 登录，进入唯一测试生产单的素材匹配/剪辑界面后运行：

```sh
node docs/verification/issue-161-workspace-visuals/ui-acceptance.mjs <Chrome-debug-port>
node docs/verification/issue-161-workspace-visuals/import-entry-acceptance.mjs <Chrome-debug-port>
node docs/verification/issue-161-workspace-visuals/audio-import-acceptance.mjs <Chrome-debug-port>
```

前者验证实际 toolbar 同名上传、Owner 注册、live pool、单实例推拉采用、保存和 1280/800 可见性；后者验证目录在 OS picker 前重定向、真实媒体 drop、键盘启动相同上传入口、声音分流和刷新恢复。目录 OS 选择器以未选择替身观察其是否被调用；不替代材料登记或原生导入业务边界。

`render-evidence.ts` 使用真实 Owner 命令产生工程，再串行调用原生渲染。执行前必须向 root 预约 `/export`；已保存的 3 份输出不因文档或 UI driver 调整而重渲染。evidence 中 JSON 是该次隔离运行证据，包含临时路径，不能作为下次运行输入。

新增镜头 local200 / AI409 与 T13 的 lineage 责任见 [CONTRACT.md](CONTRACT.md)。本票不是完整新单默认入口验收。
