import {isWanGenerationSettings,type WanGenerationSettings} from '../videoGenerationSettings.js';
import type { MediaFetcher } from "./mediaProviders.js";

export function bailianCredential(secret: string): { apiKey: string; origin: string } {
  let apiKey = secret.trim();
  let workspaceId = "";
  if (apiKey.startsWith("{")) {
    let value: unknown;
    try { value = JSON.parse(apiKey); } catch { throw new Error("百炼认证材料格式无效。"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("百炼认证材料格式无效。");
    const input = value as Record<string, unknown>;
    apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  }
  if (workspaceId.startsWith("https://")) {
    const url = new URL(workspaceId);
    const match = /^(ws-[a-z0-9]{8,64})\.cn-beijing\.maas\.aliyuncs\.com$/.exec(url.hostname);
    if (!match || url.username || url.password || url.port) throw new Error("请填写北京业务空间 ID 或阿里云百炼 Base URL。");
    workspaceId = match[1];
  }
  if (!apiKey || /[\r\n]/.test(apiKey) || (workspaceId && !/^ws-[a-z0-9]{8,64}$/.test(workspaceId))) throw new Error("百炼 API Key 或业务空间 ID 无效。");
  return { apiKey, origin: workspaceId ? `https://${workspaceId}.cn-beijing.maas.aliyuncs.com` : "https://dashscope.aliyuncs.com" };
}

export interface WanReservation { new: boolean; provider_task_id?: string | null; }
export interface WanVideoInput {
  settings?: WanGenerationSettings;
  credentials: string;
  fetcher: MediaFetcher;
  image: Uint8Array;
  imageMime: string;
  prompt: string;
  durationSeconds: number;
  reserve: () => Promise<WanReservation>;
  recordSubmission: (taskId: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  maxPolls?: number;
}

export function wanVideoCostCents(durationSeconds: number): number {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 2 || durationSeconds > 15) throw new Error("万相镜头时长须为 2～15 的整数秒。");
  return durationSeconds * 15;
}

export async function generateWanVideo(input: WanVideoInput): Promise<Uint8Array> {
  wanVideoCostCents(input.durationSeconds);
  if(input.settings&&!isWanGenerationSettings(input.settings))throw Error('视频生成设置无效。');
  if (!input.prompt.trim() || input.prompt.length > 1500 || input.image.byteLength === 0 || input.image.byteLength > 20 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(input.imageMime)) throw new Error("万相首帧或提示词无效。");
  // Input validation precedes the reservation and every paid request.
  const { apiKey, origin } = bailianCredential(input.credentials);
  const reservation = await input.reserve();
  let taskId = reservation.provider_task_id ?? "";
  if (!reservation.new && !taskId) throw new Error("上次万相提交结果未知，已停止重复提交；请核对供应商记录。");
  if (!taskId) {
    const response = await input.fetcher(`${origin}/api/v1/services/aigc/video-generation/video-synthesis`, {
      method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: "wan2.6-i2v-flash", input: { prompt: input.prompt.trim(), ...(input.settings?.negativePrompt?{negative_prompt:input.settings.negativePrompt}:{}),img_url: `data:${input.imageMime};base64,${Buffer.from(input.image).toString("base64")}` }, parameters: { resolution: "720P", duration: input.durationSeconds, audio: false, prompt_extend: false, watermark: false,...(input.settings?{resolution:input.settings.resolution,audio:input.settings.audio,prompt_extend:input.settings.promptExtend,watermark:input.settings.watermark,...(input.settings.promptExtend?{shot_type:input.settings.shotType}:{}),...(input.settings.seed!==undefined?{seed:input.settings.seed}:{})}:{}) } }),
    });
    const data = await supplierJson(response);
    taskId = typeof data.task_id === "string" ? data.task_id : "";
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("万相未返回有效任务 ID；已保留费用预留，禁止自动重提。");
    await input.recordSubmission(taskId);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("已保存的万相任务 ID 无效。");
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < (input.maxPolls ?? 60); attempt += 1) {
    const data = await supplierJson(await input.fetcher(`${origin}/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) }));
    if (data.task_status === "SUCCEEDED") {
      if (typeof data.video_url !== "string") throw new Error("万相任务成功但缺少视频地址；请按原任务恢复下载。");
      return downloadWanVideo(input.fetcher, data.video_url);
    }
    if (!["PENDING", "RUNNING"].includes(String(data.task_status))) throw new Error(`万相任务状态 ${String(data.task_status)}；费用预留已保留，重做前请核对。`);
    await sleep(Math.min(5_000 + attempt * 1_000, 10_000));
  }
  throw new Error("万相仍在处理中；供应商任务 ID 已保存，可恢复查询，不要重新生成。");
}

async function supplierJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`百炼万相请求失败：HTTP ${response.status}。`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !((data as Record<string, unknown>).output) || typeof (data as Record<string, unknown>).output !== "object") throw new Error("百炼万相响应缺少 output。");
  return (data as { output: Record<string, unknown> }).output;
}

function officialVideoUrl(value: string): URL {
  const url = new URL(value);
  // This exact accelerated bucket is documented by Alibaba and was returned by
  // the authenticated task API. Keep redirect and credential checks unchanged.
  const allowedHost = url.hostname === "dashscope-a717.oss-accelerate.aliyuncs.com" || /^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHost) throw new Error("万相视频地址不属于官方结果存储域名。");
  return url;
}

async function downloadWanVideo(fetcher: MediaFetcher, value: string): Promise<Uint8Array> {
  let url = officialVideoUrl(value);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    // Never send the API key to a result URL or redirect destination.
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = officialVideoUrl(new URL(response.headers.get("location") ?? "", url).href); continue; }
    const limit = 100 * 1024 * 1024;
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("video/mp4") || Number(response.headers.get("content-length")) > limit || !response.body) throw new Error("万相视频下载失败或响应不是有效 MP4。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) throw new Error("万相视频超过本机 100MB 单镜头限制。"); chunks.push(chunk.value); }
    } finally { await reader.cancel().catch(() => {}); }
    if (!size) throw new Error("万相下载视频为空。");
    return Uint8Array.from(Buffer.concat(chunks));
  }
  throw new Error("万相结果地址重定向次数过多。");
}
