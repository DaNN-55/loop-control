import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactManifest, StoryboardManifest } from "./contracts";
import { addFrozenStoryboardBasis, refreshArtifactManifest, verifyReportedStoryboardArtifact } from "./storyboardArtifact";

const frozenInputs: ArtifactManifest[] = [
  { artifactType: "main_script", relativePath: "episodes/episode-1/main-script.md", sha256: "a".repeat(64), fileSize: 128 },
  { artifactType: "visual_brief", relativePath: "episodes/episode-1/visual-brief-v1.md", sha256: "b".repeat(64), fileSize: 128 },
];
const storyboard: StoryboardManifest = {
  version: "storyboard/v1",
  audioCues: [],
  shots: [{
    id: "shot-01",
    scriptSegment: "林砚进入古宅。",
    durationSeconds: 3,
    shotType: "a_roll",
    productionMethod: "实拍",
    inputBasis: frozenInputs.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })),
    targetSpec: "9:16，1080×1920，24fps",
  }],
};
let assetRoot = "";

describe("分镜产物一致性", () => {
  afterEach(async () => { if (assetRoot) await rm(assetRoot, { recursive: true, force: true }); assetRoot = ""; });

  it("拒绝与 Worker 回报不同的分镜文件", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "tk-workflow-storyboard-"));
    const relativePath = "episodes/episode-1/storyboard-v1.json";
    const path = join(assetRoot, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(storyboard));

    await expect(verifyReportedStoryboardArtifact({ assetRoot, frozenInputs, relativePath, storyboard })).resolves.toBeUndefined();
    await writeFile(path, JSON.stringify({ ...storyboard, shots: [{ ...storyboard.shots[0], targetSpec: "16:9，1920×1080，24fps" }] }));
    await expect(verifyReportedStoryboardArtifact({ assetRoot, frozenInputs, relativePath, storyboard })).rejects.toThrow("不一致");
  });

  it("为模型遗漏的镜头补回冻结主脚本依据", () => {
    const visualOnly = { ...storyboard, shots: [{ ...storyboard.shots[0], inputBasis: [storyboard.shots[0].inputBasis[1]] }] };

    expect(addFrozenStoryboardBasis(visualOnly, frozenInputs)).toEqual(storyboard);
  });

  it("按冻结路径修正模型抄错的 SHA", () => {
    const truncated = { ...storyboard, shots: [{ ...storyboard.shots[0], inputBasis: [storyboard.shots[0].inputBasis[0], { ...storyboard.shots[0].inputBasis[1], sha256: "b".repeat(45) }] }] };

    expect(addFrozenStoryboardBasis(truncated, frozenInputs)).toEqual(storyboard);
  });

  it("重写分镜文件后同步更新产物摘要", () => {
    const content = `${JSON.stringify(storyboard, null, 2)}\n`;

    expect(refreshArtifactManifest([{ artifactType: "storyboard", relativePath: "episodes/episode-1/storyboard-v1.json", sha256: "0".repeat(64), fileSize: 1 }], "episodes/episode-1/storyboard-v1.json", content)).toEqual([
      expect.objectContaining({ sha256: "47894e9e07ebd384d7cc35642ba0e25faba864483e12e2ecf5d47a2231896bf4", fileSize: Buffer.byteLength(content) }),
    ]);
  });
});
