import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateStoryboardManifest, type ArtifactManifest, type StoryboardManifest } from "./contracts.js";

export function addFrozenStoryboardBasis(storyboard: unknown, frozenInputs: ArtifactManifest[]): unknown {
  if (!storyboard || typeof storyboard !== "object" || Array.isArray(storyboard) || !Array.isArray((storyboard as { shots?: unknown }).shots)) return storyboard;
  const mainScript = frozenInputs.find((artifact) => artifact.artifactType === "main_script");
  if (!mainScript) return storyboard;
  const frozenByPath = new Map(frozenInputs.map((artifact) => [artifact.relativePath, { relativePath: artifact.relativePath, sha256: artifact.sha256 }]));
  const basis = { relativePath: mainScript.relativePath, sha256: mainScript.sha256 };
  return {
    ...storyboard,
    shots: (storyboard as { shots: unknown[] }).shots.map((shot) => {
      if (!shot || typeof shot !== "object" || Array.isArray(shot) || !Array.isArray((shot as { inputBasis?: unknown }).inputBasis)) return shot;
      const inputBasis = (shot as { inputBasis: unknown[] }).inputBasis.map((input) => {
        if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as { relativePath?: unknown }).relativePath !== "string") return input;
        return frozenByPath.get((input as { relativePath: string }).relativePath) ?? input;
      });
      return inputBasis.some((input) => input && typeof input === "object" && !Array.isArray(input) && (input as { relativePath?: unknown }).relativePath === mainScript.relativePath && (input as { sha256?: unknown }).sha256 === mainScript.sha256)
        ? { ...shot, inputBasis }
        : { ...shot, inputBasis: [basis, ...inputBasis] };
    }),
  };
}

export function refreshArtifactManifest(artifacts: unknown, relativePath: string, content: string): unknown {
  if (!Array.isArray(artifacts)) return artifacts;
  const bytes = Buffer.from(content);
  return artifacts.map((artifact) => artifact && typeof artifact === "object" && !Array.isArray(artifact) && (artifact as { relativePath?: unknown }).relativePath === relativePath
    ? { ...artifact, sha256: createHash("sha256").update(bytes).digest("hex"), fileSize: bytes.byteLength }
    : artifact);
}

export async function verifyReportedStoryboardArtifact(input: { assetRoot: string; frozenInputs: ArtifactManifest[]; relativePath: string; storyboard: StoryboardManifest }): Promise<void> {
  const source = await readFile(join(input.assetRoot, input.relativePath), "utf8");
  let artifactStoryboard: StoryboardManifest;
  try {
    artifactStoryboard = validateStoryboardManifest(JSON.parse(source), input.frozenInputs);
  } catch {
    throw new Error("分镜产物文件格式无效。");
  }
  const reportedStoryboard = validateStoryboardManifest(input.storyboard, input.frozenInputs);
  if (JSON.stringify(artifactStoryboard) !== JSON.stringify(reportedStoryboard)) throw new Error("分镜产物文件与 Worker 回报不一致。");
}
