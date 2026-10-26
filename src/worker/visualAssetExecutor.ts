import {createHash} from 'node:crypto';
import type{ArtifactManifest,VisualAssetRequest,WorkerTaskPackage}from'./contracts.js';
import{parseCodexOutput}from'./codexRunner.js';
import{generateCloudflareWorkersAiImage,generateOpenAiImage,type MediaFetcher}from'./mediaProviders.js';
import{writeSafeAssetFile}from'./controlledMediaExecutor.js';
export async function generateVisualAssets(taskPackage: WorkerTaskPackage, output: string, resolveConnectionSecret:(ref:string|undefined,provider:string,adapter:string,accountId:string)=>Promise<string|undefined>, fetcher:MediaFetcher,outputDirectory=`episodes/${taskPackage.episode.id}/visuals`): Promise<string> {
  const candidate = parseCodexOutput(output, 0);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("视觉资产准备结果格式无效。");
  const result = candidate as Record<string, unknown>;
  if (result.status !== "completed") return output;
  const requests = visualAssetRequests(result.visualAssetRequests);
  if (!requests.length) return output;
  const imageGeneration = taskPackage.visualAssetPreparation?.imageGeneration;
  if (!imageGeneration) throw new Error("视觉资产存在缺失项，但没有冻结的图片 Adapter。" );
  if ((imageGeneration.provider !== "openai" || imageGeneration.adapter !== "openai_images") && (imageGeneration.provider !== "cloudflare" || imageGeneration.adapter !== "workers_ai_images")) throw new Error("冻结的图片 Adapter 没有可用执行路径。" );
  const apiKey = await resolveConnectionSecret(imageGeneration.credentialRef, imageGeneration.provider, imageGeneration.adapter, taskPackage.accountId);
  if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY 未配置，无法生成冻结视觉资产。" );
  const generated: ArtifactManifest[] = [];
  for (const request of requests) {
    const bytes = imageGeneration.provider === "cloudflare"
      ? await generateCloudflareWorkersAiImage({ credentials: apiKey, fetcher, model: imageGeneration.model, prompt: request.prompt })
      : await generateOpenAiImage({ apiKey, fetcher, model: imageGeneration.model, prompt: request.prompt });
    const relativePath = `${outputDirectory}/${request.id}.${imageGeneration.provider === "cloudflare" ? "jpg" : "png"}`;
    await writeSafeAssetFile(taskPackage.assets.allowedRoot, relativePath, bytes);
    generated.push({ artifactType: "static_visual", relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), fileSize: bytes.byteLength });
  }
  if (!Array.isArray(result.artifacts)) throw new Error("视觉资产准备结果缺少产物清单。" );
  result.artifacts = [...result.artifacts, ...generated];
  return JSON.stringify(result);
}

function visualAssetRequests(value: unknown): VisualAssetRequest[] {
  if (!Array.isArray(value)) throw new Error("视觉资产准备缺少图片生成需求。" );
  return value.map((request) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("视觉图片生成需求格式无效。" );
    const value = request as Record<string, unknown>;
    if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) || typeof value.prompt !== "string" || !value.prompt.trim()) throw new Error("视觉图片生成需求格式无效。" );
    return { id: value.id, prompt: value.prompt, inputBasis: [] };
  });
}
