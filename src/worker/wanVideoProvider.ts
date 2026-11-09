import {videoVisualInputProblem,type VideoOutputRatio,type VideoVisualInputSelection} from '../videoVisualInputs.js';
import {isWanGenerationSettings,type WanGenerationSettings} from '../videoGenerationSettings.js';
import {defaultWanModel,defaultWanModelSettings,wanReferenceMode,wanReferenceModel,wanVideoModel,wanVideoParameters} from '../wanVideoModels.js';
import {executeVideoTask,type VideoTaskPorts} from './videoTaskExecution.js';
export type {VideoTaskReservation as WanReservation,VideoGenerationPhase} from './videoTaskExecution.js';

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

export interface WanVideoInput extends VideoTaskPorts {
  model?:string;
  settings?: WanGenerationSettings;
  credentials: string;
  image?: Uint8Array;
  imageMime?: string;
  visualInputs?: readonly VideoVisualInputSelection[];
  referenceRatio?: VideoOutputRatio;
  prompt: string;
  durationSeconds: number;
}

export function wanVideoCostCents(durationSeconds: number): number {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 2 || durationSeconds > 15) throw new Error("万相镜头时长须为 2～15 的整数秒。");
  return durationSeconds * 15;
}

export async function generateWanVideo(input: WanVideoInput): Promise<Uint8Array> {
  const model=input.model??defaultWanModel,profile=wanVideoModel(model),settings=input.settings??defaultWanModelSettings(model);
  const parameters=wanVideoParameters(model,input.durationSeconds,settings,input.referenceRatio);
  if(input.settings&&!isWanGenerationSettings(input.settings))throw Error('视频生成设置无效。');
  if(!input.prompt.trim()||input.prompt.length>1500)throw Error('万相提示词无效。');
  let media: {reference_urls:string[]}|{img_url:string};
  if(model===wanReferenceModel){
    const entries=input.visualInputs??[],problem=videoVisualInputProblem(wanReferenceMode,entries);
    if(problem)throw Error(problem);
    media={reference_urls:entries.map(entry=>entry.source!)};
  }else{
    if(!input.image?.byteLength||input.image.byteLength>profile!.maxBytes||!input.imageMime||!['image/png','image/jpeg','image/webp','image/bmp'].includes(input.imageMime))throw Error('万相首帧无效。');
    media={img_url:`data:${input.imageMime};base64,${Buffer.from(input.image).toString('base64')}`};
  }
  // Input validation precedes the reservation and every paid request.
  const { apiKey, origin } = bailianCredential(input.credentials);
  return executeVideoTask(input,{
    submit:async()=>{
      const response=await input.fetcher(`${origin}/api/v1/services/aigc/video-generation/video-synthesis`,{
        method:'POST',signal:AbortSignal.timeout(30_000),
        headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','X-DashScope-Async':'enable'},
        body:JSON.stringify({model,input:{prompt:input.prompt.trim(),...(settings.negativePrompt?{negative_prompt:settings.negativePrompt}:{}),...media},parameters}),
      });
      return (await supplierJson(response)).task_id;
    },
    query:async taskId=>{
      const data=await supplierJson(await input.fetcher(`${origin}/api/v1/tasks/${encodeURIComponent(taskId)}`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(30_000)}));
      if(data.task_status==='SUCCEEDED'){
        if(typeof data.video_url!=='string')throw Error('万相任务成功但缺少视频地址；请按原任务恢复下载。');
        return{url:data.video_url};
      }
      if(!['PENDING','RUNNING'].includes(String(data.task_status)))throw Error(`万相任务状态 ${String(data.task_status)}；费用预留已保留，重做前请核对。`);
      return{phase:data.task_status==='PENDING'?'queued':'processing'};
    },
    pollDelayMs:attempt=>Math.min(5_000+attempt*1_000,10_000),
    download:{validateUrl:officialVideoUrl,invalidResponse:'万相视频下载失败或响应不是有效 MP4。',tooLarge:'万相视频超过本机 100MB 单镜头限制。',empty:'万相下载视频为空。',redirectLimit:'万相结果地址重定向次数过多。'},
    errors:{unknownSubmission:'上次万相提交结果未知，已停止重复提交；请核对供应商记录。',invalidSubmittedId:'万相未返回有效任务 ID；已保留费用预留，禁止自动重提。',invalidSavedId:'已保存的万相任务 ID 无效。',pollLimit:'万相仍在处理中；供应商任务 ID 已保存，可恢复查询，不要重新生成。'},
  });
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
