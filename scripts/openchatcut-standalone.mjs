import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.OPENCHATCUT_ROOT;
const dataDir = process.env.OPENCHATCUT_DATA_DIR;
const port = Number(process.argv[2]);
if (!root || !dataDir || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("OpenChatCut 独立工作区启动配置无效。");

const { createServer } = await import(pathToFileURL(join(root, "node_modules/vite/dist/node/index.js")).href);
const server = await createServer({
  root,
  configFile: join(root, "config/vite.config.ts"),
  cacheDir: join(dataDir, "vite-cache"),
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
