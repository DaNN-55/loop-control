import type {EpisodeFileIO} from '../local-app/episodeFiles.js';
import {safeRelative,verifyNativeFile} from '../local-app/localFiles.js';
import {verifyWorkspaceManifest,workspacePublishPackageVersion,type WorkspaceDeliveryIdentity} from "./workspacePublishPackage.js";
import { createHash } from "node:crypto";
import { readFile, realpath, lstat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ArtifactManifest } from "../worker/contracts.js";
import { verifyArtifactIndex } from "../worker/mediaLibrary.js";

export const publishPackageVersion = "publish-package/v1" as const;

const requiredArtifactTypes = ["final_render", "cover", "metadata", "final_qc_report"] as const;

export interface PublishPackage {
  relativePath: string;
  sha256: string;
  fileSize: number;
}

interface PublishPackageManifest {
  version: typeof publishPackageVersion;
  episodeId: string;
  artifacts: ArtifactManifest[];
}

export async function createPublishPackage(input: { assetRoot: string; episodeId: string; artifacts: readonly ArtifactManifest[];storage?:EpisodeFileIO }): Promise<PublishPackage> {
  const selectedArtifacts = selectRequiredArtifacts(input.artifacts, "发布包");
  await verifyArtifacts(input.assetRoot, input.episodeId, selectedArtifacts,input.storage);
  await verifyQcReport(input.assetRoot, input.episodeId, selectedArtifacts[3],input.storage);

  const relativePath = `${input.storage?.relativePath??`episodes/${input.episodeId}`}/publish-package/manifest.json`;
  const existingPackage = await existingPublishPackage(input.assetRoot, input.episodeId, relativePath,input.storage);
  if (existingPackage) {
    await verifyPublishPackage({ assetRoot: input.assetRoot, episodeId: input.episodeId, publishPackage: existingPackage,storage:input.storage });
    return existingPackage;
  }
  const manifest: PublishPackageManifest = { version: publishPackageVersion, episodeId: input.episodeId, artifacts: selectedArtifacts };
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  const path = await packagePath(input.assetRoot, input.episodeId, relativePath,input.storage);
  await writeFile(path, contents);

  return { relativePath, fileSize: Buffer.byteLength(contents), sha256: createHash("sha256").update(contents).digest("hex") };
}

async function existingPublishPackage(assetRoot: string, episodeId: string, relativePath: string,storage?:EpisodeFileIO): Promise<PublishPackage | null> {
  try {
    const contents = await readFile(await assetPath(assetRoot, episodeId, relativePath,storage));
    return { relativePath, fileSize: contents.length, sha256: createHash("sha256").update(contents).digest("hex") };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function verifyPublishPackage(input: { assetRoot: string; episodeId: string; publishPackage: PublishPackage; expectedWorkspaceIdentity?:WorkspaceDeliveryIdentity;storage?:EpisodeFileIO }): Promise<void> {
  const packageFilePath = await assetPath(input.assetRoot, input.episodeId, input.publishPackage.relativePath,input.storage);
  const contents = await readFile(packageFilePath);
  if (contents.length !== input.publishPackage.fileSize) throw new Error("发布包清单文件大小不匹配。");
  if (createHash("sha256").update(contents).digest("hex") !== input.publishPackage.sha256) throw new Error("发布包清单 SHA-256 不匹配。");

  const manifest: unknown = JSON.parse(contents.toString("utf8"));
  if (isRecord(manifest)&&manifest.version===workspacePublishPackageVersion) { await verifyWorkspaceManifest(input.assetRoot,input.episodeId,manifest,input.expectedWorkspaceIdentity,input.storage); return; }
  if (!isManifest(manifest, input.episodeId)) throw new Error("发布包清单格式无效。");
  const artifacts = selectRequiredArtifacts(manifest.artifacts, "发布包清单");
  await verifyArtifacts(input.assetRoot, input.episodeId, artifacts,input.storage);
  await verifyQcReport(input.assetRoot, input.episodeId, artifacts[3],input.storage);
}

async function verifyArtifacts(assetRoot: string, episodeId: string, artifacts: readonly ArtifactManifest[],storage?:EpisodeFileIO): Promise<void> {
  if(!storage){await verifyArtifactIndex({assetRoot,episodeId,artifacts});return;}
  for(const a of artifacts)await verifyNativeFile(assetRoot,relative(assetRoot,await assetPath(assetRoot,episodeId,a.relativePath,storage)),a.sha256,a.fileSize);
}

async function verifyQcReport(assetRoot: string, episodeId: string, artifact: ArtifactManifest,storage?:EpisodeFileIO): Promise<void> {
  const contents = await readFile(await assetPath(assetRoot, episodeId, artifact.relativePath,storage), "utf8");
  const report: unknown = JSON.parse(contents);
  if (!isPassedQcReport(report)) throw new Error("QC 报告未通过。");
}

export async function assetPath(assetRoot:string,episodeId:string,reference:string,storage?:EpisodeFileIO):Promise<string>{
  await storage?.assertValid();
  if(!safeRelative(reference)||!storage&&!reference.startsWith(`episodes/${episodeId}/`))throw Error('发布包产物不属于当前生产单。');
  const canonicalRoot=await realpath(assetRoot),path=storage?await storage.resolveReference(reference):resolve(canonicalRoot,reference);
  if(!isDescendant(canonicalRoot,path)||await realpath(path)!==path)throw Error('发布包路径身份无效。');
  const stat=await lstat(path);if(!stat.isFile()||stat.nlink!==1)throw Error('发布包文件身份无效。');return path;
}
async function packagePath(assetRoot:string,episodeId:string,reference:string,storage?:EpisodeFileIO):Promise<string>{
  await storage?.assertValid();
  const prefix=storage?.relativePath??`episodes/${episodeId}`;
  if(!safeRelative(reference)||!storage&&!reference.startsWith(prefix+'/'))throw Error('发布包路径不属于当前生产单。');
  const physical=storage?relative(assetRoot,await storage.resolveReference(reference)):reference;
  const {safeAssetOutputPath}=await import('../worker/controlledMediaExecutor.js');return safeAssetOutputPath(assetRoot,physical);
}

function isManifest(value: unknown, episodeId: string): value is PublishPackageManifest {
  return isRecord(value)
    && value.version === publishPackageVersion
    && value.episodeId === episodeId
    && Array.isArray(value.artifacts)
    && value.artifacts.every(isArtifactManifest);
}

function selectRequiredArtifacts(artifacts: readonly ArtifactManifest[], label: string): ArtifactManifest[] {
  return requiredArtifactTypes.map((artifactType) => {
    const artifact = artifacts.find((candidate) => candidate.artifactType === artifactType);
    if (!artifact) throw new Error(`${label}缺少必需产物：${artifactType}`);
    return artifact;
  });
}

function isArtifactManifest(value: unknown): value is ArtifactManifest {
  return isRecord(value)
    && typeof value.artifactType === "string"
    && typeof value.relativePath === "string"
    && typeof value.sha256 === "string"
    && typeof value.fileSize === "number";
}

function isPassedQcReport(value: unknown): boolean {
  return isRecord(value)
    && value.passed === true
    && Array.isArray(value.checks)
    && value.checks.length > 0
    && value.checks.every((check) => isRecord(check) && check.passed === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDescendant(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent.length > 0 && !pathFromParent.startsWith("..") && !pathFromParent.startsWith("/");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
