import { describe, expect, it, vi } from "vitest";
import { generateCloudflareWorkersAiImage, generateOpenAiImage,generateOpenAiImages, searchFreesoundPreview, searchPexelsVideo, synthesizeGoogleTts, synthesizeVolcengineTts } from "./mediaProviders";

describe("受控媒体供应商", () => {
  it("使用 OpenAI Images 的 base64 PNG 响应", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }));

    await expect(generateOpenAiImage({ apiKey: "openai-key", fetcher, model: "gpt-image-2", prompt: "雨夜的古城门" })).resolves.toEqual(new Uint8Array(png));
    expect(fetcher).toHaveBeenCalledWith("https://api.openai.com/v1/images/generations", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer openai-key" }) }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: "gpt-image-2", prompt: "雨夜的古城门", n: 1, size: "1024x1536", output_format: "png" });
  });
  it.each([
    [{ data: [] }, "缺少 PNG"],
    [{ data: [{ b64_json: Buffer.from("not a PNG").toString("base64") }] }, "不是 PNG"],
  ])("拒绝无效图片响应，不将其登记为 PNG", async (payload, message) => {
    await expect(generateOpenAiImage({ apiKey: "synthetic", model: "gpt-image-2", prompt: "test", fetcher: async () => Response.json(payload) })).rejects.toThrow(message);
  });
  it("停用 Cloudflare 和 Google TTS 的旧执行入口，且不发出网络请求", async () => {
    const fetcher=vi.fn();
    await expect(generateCloudflareWorkersAiImage({credentials:'synthetic',fetcher,model:'legacy',prompt:'test'})).rejects.toThrow('已停用');
    await expect(synthesizeGoogleTts({apiKey:'synthetic',fetcher,text:'test',voice:{languageCode:'zh-CN',name:'legacy',speakingRate:1}})).rejects.toThrow('已停用');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("使用豆包语音 V3 SSE 合并 MP3 音频分片", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ code: 0, data: Buffer.from("audio-").toString("base64") })}`,
      `data: ${JSON.stringify({ code: 20000000, data: Buffer.from("bytes").toString("base64") })}`,
    ].join("\n"), { status: 200 }));

    await expect(synthesizeVolcengineTts({ apiKey: "volc-key", fetcher, model: "seed-tts-2.0", text: "冻结旁白。", voice: { languageCode: "zh-CN", name: "zh_female_vv_uranus_bigtts", speakingRate: 1 } })).resolves.toEqual(new Uint8Array(Buffer.from("audio-bytes")));
    expect(fetcher).toHaveBeenCalledWith("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", expect.objectContaining({ headers: expect.objectContaining({ "X-Api-Key": "volc-key", "X-Api-Resource-Id": "seed-tts-2.0" }) }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      req_params: { text: "冻结旁白。", speaker: "zh_female_vv_uranus_bigtts", audio_params: { speech_rate: 0 } },
    });
  });

  it("为豆包语音 1.0 音色发送匹配的资源 ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ code: 0, data: Buffer.from("audio").toString("base64") })}`, { status: 200 }));

    await synthesizeVolcengineTts({ apiKey: "volc-key", fetcher, model: "seed-tts-2.0", text: "试听。", voice: { languageCode: "zh-CN", name: "zh_male_sunwukong_mars_bigtts", speakingRate: 1 } });

    expect(fetcher).toHaveBeenCalledWith("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", expect.objectContaining({ headers: expect.objectContaining({ "X-Api-Resource-Id": "seed-tts-1.0" }) }));
  });

  it("只返回 Pexels 响应中与冻结检索词匹配的竖屏视频下载地址", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      videos: [{
        id: 88,
        duration: 6,
        video_files: [
          { link: "https://cdn.pexels.test/landscape.mp4", width: 1920, height: 1080, quality: "hd", file_type: "video/mp4" },
          { link: "https://cdn.pexels.test/portrait.mp4", width: 1080, height: 1920, quality: "hd", file_type: "video/mp4" },
        ],
      }],
    }), { status: 200 }));

    await expect(searchPexelsVideo({ apiKey: "pexels-key", fetcher, query: "雨夜铜铃", targetDurationSeconds: 5 })).resolves.toEqual({ id: 88, durationSeconds: 6, downloadUrl: "https://cdn.pexels.test/portrait.mp4" });
    expect(fetcher).toHaveBeenCalledWith("https://api.pexels.com/v1/videos/search?query=%E9%9B%A8%E5%A4%9C%E9%93%9C%E9%93%83&orientation=portrait&per_page=15", { headers: { Authorization: "pexels-key" } });
  });

  it("在 Pexels 请求边界将冻结检索词的换行规范为空格", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ videos: [] }), { status: 200 }));
    await expect(searchPexelsVideo({ apiKey: "pexels-key", fetcher, query: "雨夜\n铜铃", targetDurationSeconds: 5 })).rejects.toThrow("竖屏视频");
    expect(fetcher.mock.calls[0][0]).toContain("query=%E9%9B%A8%E5%A4%9C+%E9%93%9C%E9%93%83");
  });

  it("仅返回满足冻结时长的 Freesound MP3 预览，并保留来源元数据", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { id: 1, name: "too short", username: "creator", license: "Creative Commons 0", duration: 2, url: "https://freesound.org/s/1/", previews: { "preview-hq-mp3": "https://cdn.test/1.mp3" } },
        { id: 2, name: "rain bell", username: "creator-2", license: "Attribution", duration: 6, url: "https://freesound.org/s/2/", previews: { "preview-hq-mp3": "https://cdn.test/2.mp3" } },
      ],
    }), { status: 200 }));

    await expect(searchFreesoundPreview({ apiKey: "freesound-key", fetcher, query: "雨夜\n铜铃", targetDurationSeconds: 5 })).resolves.toEqual({ id: 2, title: "rain bell", creator: "creator-2", license: "Attribution", sourceUrl: "https://freesound.org/s/2/", previewUrl: "https://cdn.test/2.mp3" });
    expect(fetcher.mock.calls[0][0]).toContain("query=%E9%9B%A8%E5%A4%9C+%E9%93%9C%E9%93%83");
    expect(fetcher.mock.calls[0][0]).toContain("filter=duration%3A%5B5+TO+*%5D");
    expect(fetcher.mock.calls[0][0]).toContain("sort=duration_asc");
  });

  it("拒绝停用的音频 Provider 和无法使用的 Pexels 视频", async () => {
    await expect(synthesizeGoogleTts({ apiKey: "google-key", fetcher: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })), text: "旁白", voice: { languageCode: "cmn-CN", name: "cmn-CN-Standard-A", speakingRate: 1 } })).rejects.toThrow("已停用");
    await expect(searchPexelsVideo({ apiKey: "pexels-key", fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ videos: [] }), { status: 200 })), query: "雨夜", targetDurationSeconds: 5 })).rejects.toThrow("竖屏视频");
    await expect(searchPexelsVideo({ apiKey: "pexels-key", fetcher: vi.fn(), query: "雨".repeat(101), targetDurationSeconds: 5 })).rejects.toThrow("100");
  });
});

it.each(['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare'])('sends the exact %s model and enhanced quality through generation and editing',async model=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,1]);
 for(const quality of ['xhigh','max'] as const){
  const fetcher=vi.fn(async(_url:string|URL,_init?:RequestInit)=>Response.json({data:[{b64_json:png.toString('base64')}]}));
  await generateOpenAiImages({apiKey:'synthetic',fetcher,model,prompt:'保留主体',settings:{size:'864x1536',quality,count:1},...(quality==='max'?{references:[{mimeType:'image/png',bytes:png}]}:{})});
  expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/'+(quality==='max'?'edits':'generations'));
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({model,quality,n:1,output_format:'png'});
 }
 const fetcher=vi.fn();await expect(generateOpenAiImages({apiKey:'synthetic',fetcher,model:'gpt-image-2',prompt:'test',settings:{size:'864x1536',quality:'max',count:1}})).rejects.toThrow('参数无效');expect(fetcher).not.toHaveBeenCalled();
});
