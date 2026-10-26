import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { startLocalWorkerService } from "./src/local-control-plane/workerService";
import { createLocalControlPlaneMiddleware } from "./src/local-control-plane";

function localControlPlanePlugin(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined, workerEnabled: boolean): Plugin {
  let worker: Awaited<ReturnType<typeof startLocalWorkerService>>;
  const middleware = createLocalControlPlaneMiddleware({ supabasePublishableKey, supabaseUrl });
  return {
    name: "local-control-plane",
    async closeBundle() { await worker?.stop(); },
    async configureServer(server) {
      worker = workerEnabled ? await startLocalWorkerService(supabaseUrl) : undefined;
      server.httpServer?.once("close", () => { void worker?.stop(); });
      server.middlewares.use(middleware);
    },
    async configurePreviewServer(server) {
      worker = workerEnabled ? await startLocalWorkerService(supabaseUrl) : undefined;
      server.httpServer.once("close", () => { void worker?.stop(); });
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), localControlPlanePlugin(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, mode !== "test" && !process.env.VITEST)],
    server: { watch: { ignored: ["**/n8n/runtime/**", "**/outputs/**"] } },
    test: {
      environment: "jsdom",
      globals: true,
      // Leave CPU headroom for React/jsdom while keeping the default test timeout.
      maxWorkers: "50%",
    },
  };
});
