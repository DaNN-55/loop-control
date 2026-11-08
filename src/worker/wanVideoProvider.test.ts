import { describe, expect, it, vi } from "vitest";
import { bailianCredential, generateWanVideo, wanVideoCostCents } from "./wanVideoProvider";

const output = (value: unknown) => new Response(JSON.stringify({ output: value }), { status: 200, headers: { "Content-Type": "application/json" } });
const base = () => ({ credentials: "test-only-key", image: new Uint8Array([1, 2]), imageMime: "image/png", prompt: "男子轻微转身", durationSeconds: 5, reserve: vi.fn().mockResolvedValue({ new: true }), recordSubmission: vi.fn().mockResolvedValue(undefined), sleep: vi.fn().mockResolvedValue(undefined), maxPolls: 2 });
describe("Bailian video provider", () => {
  it("接受北京空间ID和控制台完整Base URL，拒绝任意主机", () => {
    expect(bailianCredential(JSON.stringify({ apiKey: "key", workspaceId: "https://ws-abcdefgh12345678.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" }))).toEqual({ apiKey: "key", origin: "https://ws-abcdefgh12345678.cn-beijing.maas.aliyuncs.com" });
    expect(() => bailianCredential(JSON.stringify({ apiKey: "key", workspaceId: "https://evil.test/" }))).toThrow();
    expect(wanVideoCostCents(5)).toBe(75);
    expect(() => wanVideoCostCents(1)).toThrow();
  });
  it("先预留预算，固定720P无声，先保存供应商ID再查询，下载不带Key", async () => {
    const input = base();
    const fetcher = vi.fn().mockResolvedValueOnce(output({ task_id: "wan-task-1", task_status: "PENDING" })).mockResolvedValueOnce(output({ task_status: "RUNNING" })).mockResolvedValueOnce(output({ task_status: "SUCCEEDED", video_url: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/video.mp4?signature=x" })).mockResolvedValueOnce(new Response(new Uint8Array([4, 5]), { headers: { "Content-Type": "video/mp4" } }));
    const bytes = await generateWanVideo({ ...input, fetcher });
    expect(Array.from(bytes)).toEqual([4, 5]);
    expect(input.reserve.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
    expect(input.recordSubmission).toHaveBeenCalledWith("wan-task-1");
    expect(input.recordSubmission.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[1]);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.parameters).toMatchObject({ resolution: "720P", audio: false, duration: 5 });
    expect(body.input.img_url).toBe("data:image/png;base64,AQI=");
    expect(fetcher.mock.calls[3][1].headers).toBeUndefined();
  });
  it("预算不足时不发HTTP请求", async () => {
    const fetcher = vi.fn();
    await expect(generateWanVideo({ ...base(), fetcher, reserve: vi.fn().mockRejectedValue(new Error("预算不足")) })).rejects.toThrow("预算不足");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("未知POST结果的持久预留阻止重复收费", async () => {
    const fetcher = vi.fn();
    await expect(generateWanVideo({ ...base(), fetcher, reserve: vi.fn().mockResolvedValue({ new: false, provider_task_id: null }) })).rejects.toThrow("提交结果未知");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("恢复已保存ID只GET，不重新POST", async () => {
    const fetcher = vi.fn().mockImplementation(async () => output({ task_status: "RUNNING" }));
    await expect(generateWanVideo({ ...base(), fetcher, reserve: vi.fn().mockResolvedValue({ new: false, provider_task_id: "existing" }) })).rejects.toThrow("仍在处理中");
    expect(fetcher.mock.calls.every((call) => call[0].endsWith("/tasks/existing") && call[1].method !== "POST")).toBe(true);
  });
  it("可从真实返回的官方加速桶恢复下载，不重提视频", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(output({ task_status: "SUCCEEDED", video_url: "https://dashscope-a717.oss-accelerate.aliyuncs.com/result.mp4?signature=test" })).mockResolvedValueOnce(new Response(new Uint8Array([4, 5]), { headers: { "Content-Type": "video/mp4" } }));
    const bytes = await generateWanVideo({ ...base(), fetcher, reserve: vi.fn().mockResolvedValue({ new: false, provider_task_id: "existing" }) });
    expect(Array.from(bytes)).toEqual([4, 5]);
    expect(fetcher.mock.calls[0][0]).toContain("/tasks/existing");
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
    expect(fetcher.mock.calls.every((call) => call[1].method !== "POST")).toBe(true);
  });
  it("拒绝供应商成功响应中的非官方地址，避免发送Key和SSRF", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(output({ task_id: "id" })).mockResolvedValueOnce(output({ task_status: "SUCCEEDED", video_url: "http://127.0.0.1/private" }));
    await expect(generateWanVideo({ ...base(), fetcher })).rejects.toThrow("官方结果存储");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

it('sends explicit Wan settings in the paid request and rejects incompatible multi-shot settings before reserving',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(output({task_id:'settings-task'})).mockResolvedValueOnce(output({task_status:'SUCCEEDED',video_url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/video.mp4'})).mockResolvedValueOnce(new Response(new Uint8Array([4,5]),{headers:{'Content-Type':'video/mp4'}}));
 const settings={resolution:'1080P' as const,audio:true,promptExtend:true,shotType:'multi' as const,watermark:true,negativePrompt:'画面闪烁',seed:123};await generateWanVideo({...base(),fetcher,settings});expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({input:{negative_prompt:'画面闪烁'},parameters:{resolution:'1080P',audio:true,prompt_extend:true,shot_type:'multi',watermark:true,seed:123}});
 const input=base();await expect(generateWanVideo({...input,fetcher:vi.fn(),settings:{...settings,promptExtend:false}})).rejects.toThrow('设置无效');expect(input.reserve).not.toHaveBeenCalled();
});

it.each(['wan2.6-i2v','wan2.5-i2v-preview','wan2.2-i2v-flash','wan2.2-i2v-plus','wanx2.1-i2v-plus','wanx2.1-i2v-turbo'])('submits the frozen %s model without substituting flash or incompatible audio fields',async model=>{
 const fetcher=vi.fn().mockResolvedValueOnce(output({task_id:'chosen-task'})).mockResolvedValueOnce(output({task_status:'SUCCEEDED',video_url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/video.mp4'})).mockResolvedValueOnce(new Response(new Uint8Array([4,5]),{headers:{'Content-Type':'video/mp4'}}));
 await generateWanVideo({...base(),model,fetcher});const sent=JSON.parse(fetcher.mock.calls[0][1].body);expect(sent.model).toBe(model);expect(sent.parameters.audio).toBeUndefined();expect(sent.parameters.duration).toBe(['wan2.2-i2v-flash','wan2.2-i2v-plus','wanx2.1-i2v-plus'].includes(model)?undefined:5);
});

it('keeps polling a saved Wan task beyond the former total wait and reports provider milestones',async()=>{
 const input=base(),onProgress=vi.fn(async()=>{});
 let polls=0;
 const fetcher=vi.fn(async(url:string|URL)=>{
  if(String(url).includes('/api/v1/tasks/')){
   polls++;
   if(polls<=61)return output({task_status:polls===1?'PENDING':'RUNNING'});
   return output({task_status:'SUCCEEDED',video_url:'https://dashscope-a717.oss-accelerate.aliyuncs.com/output.mp4'});
  }
  return new Response(Uint8Array.of(1),{headers:{'content-type':'video/mp4'}});
 });
 const bytes=await generateWanVideo({...input,maxPolls:undefined,reserve:async()=>({new:false,provider_task_id:'existing'}),fetcher,onProgress});
 expect(bytes).toEqual(Uint8Array.of(1));
 expect(polls).toBe(62);
 expect(input.recordSubmission).not.toHaveBeenCalled();
 expect(onProgress.mock.calls.at(0)).toEqual(['queued']);
 expect(onProgress.mock.calls.at(1)).toEqual(['processing']);
 expect(onProgress.mock.calls.at(-1)).toEqual(['saving']);
});
