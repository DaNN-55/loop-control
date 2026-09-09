import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOpenChatCutRuntime } from "./openchatcut-render.mjs";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "openchatcut-render.mjs");
const temporaryRoots = [];

async function openChatCutFixture({ name = "openchatcut", includeEntry = true, includeConfig = true, includeDependencies = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "loop-control-openchatcut-"));
  temporaryRoots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name, version: "0.2.14", scripts: { "dev:shared": "vite --config config/vite.config.ts" } }));
  if (includeEntry) {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "index.html"), "<div id=\"root\"></div>");
    await writeFile(join(root, "src", "main.tsx"), "export {};\n");
  }
  if (includeConfig) {
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "vite.config.ts"), "export default {};\n");
  }
  if (includeDependencies) {
    await mkdir(join(root, "node_modules", "vite", "bin"), { recursive: true });
    await mkdir(join(root, "node_modules", "@vitejs", "plugin-react"), { recursive: true });
    await mkdir(join(root, "node_modules", "dotenv"), { recursive: true });
    await writeFile(join(root, "node_modules", "vite", "bin", "vite.js"), "console.log('vite/7.0.0');\n");
    await writeFile(join(root, "node_modules", "@vitejs", "plugin-react", "package.json"), "{}");
    await writeFile(join(root, "node_modules", "dotenv", "package.json"), "{}");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenChatCut 渲染运行时", () => {
  it("--version 走真实前置检查，而非硬编码成功", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--version"], { encoding: "utf8", env: { PATH: process.env.PATH || "" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("缺少 OPENCHATCUT_ROOT");
  });

  it("逐项指出 Node、工程入口、配置和依赖缺项", async () => {
    const root = await openChatCutFixture({ includeEntry: false, includeConfig: false, includeDependencies: false });
    expect(() => assertOpenChatCutRuntime({ root, nodeVersion: "v22.0.0" })).toThrow("OPENCHATCUT_NODE 必须指向 Node 24");
    try {
      assertOpenChatCutRuntime({ root, nodeVersion: "v24.0.0" });
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error.message).toContain("渲染 HTML 入口 index.html");
      expect(error.message).toContain("渲染应用入口 src/main.tsx");
      expect(error.message).toContain("Vite 配置 config/vite.config.ts");
      expect(error.message).toContain("已安装的 Vite 可执行文件");
      expect(error.message).toContain("已安装的 @vitejs/plugin-react 依赖");
      expect(error.message).toContain("已安装的 dotenv 依赖");
    }
  });

  it("拒绝只有 Vite 文件、但不是真实 OpenChatCut 工程的目录", async () => {
    const root = await openChatCutFixture({ name: "another-project", includeEntry: false });
    expect(() => assertOpenChatCutRuntime({ root, nodeVersion: "v24.0.0" })).toThrow("package.json 的 name 必须为 openchatcut");
  });

  it("在完整工程前置条件下输出实际 package 版本", async () => {
    const root = await openChatCutFixture();
    const result = spawnSync(process.execPath, [scriptPath, "--version"], { encoding: "utf8", env: { PATH: process.env.PATH || "", OPENCHATCUT_ROOT: root } });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("openchatcut@0.2.14");
  });
});
