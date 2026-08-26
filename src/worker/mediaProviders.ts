export interface MediaFetcher {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface GoogleTtsVoice {
  languageCode: string;
  name: string;
  speakingRate: number;
}

export interface FreesoundPreview {
  id: number;
  title: string;
  creator: string;
  license: string;
  sourceUrl: string;
  previewUrl: string;
}

export async function generateOpenAiImage(input: { apiKey: string; fetcher: MediaFetcher; model: string; prompt: string }): Promise<Uint8Array> {
  if (!input.apiKey.trim() || !input.model.trim() || !input.prompt.trim()) throw new Error("OpenAI Images 配置或视觉提示词无效。");
  const response = await input.fetcher("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, size: "1024x1536", output_format: "png" }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`OpenAI Images 请求失败：HTTP ${response.status}。`);
  const encoded = isRecord(payload) && Array.isArray(payload.data) && isRecord(payload.data[0]) ? payload.data[0].b64_json : undefined;
  if (typeof encoded !== "string" || !encoded) throw new Error("OpenAI Images 响应缺少 PNG 数据。");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (bytes.byteLength < 8 || !bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) throw new Error("OpenAI Images 响应不是 PNG 图片。");
  return bytes;
}

export async function generateCloudflareWorkersAiImage(input: { credentials: string; fetcher: MediaFetcher; model: string; prompt: string }): Promise<Uint8Array> {
  const [accountId, apiToken] = input.credentials.split(":", 2);
  if (!accountId?.trim() || !apiToken?.trim() || !input.model.trim() || !input.prompt.trim()) throw new Error("Cloudflare Workers AI 认证材料或视觉提示词无效。请使用 Account ID:API Token。 ");
  const response = await input.fetcher(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId.trim())}/ai/run/${encodeURI(input.model.trim())}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: input.prompt, steps: 4 }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Cloudflare Workers AI 请求失败：HTTP ${response.status}。`);
  const encoded = isRecord(payload) && isRecord(payload.result) ? payload.result.image : undefined;
  if (typeof encoded !== "string" || !encoded) throw new Error("Cloudflare Workers AI 响应缺少图片数据。");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (bytes.byteLength < 3 || !bytes.slice(0, 3).every((value, index) => value === [0xff, 0xd8, 0xff][index])) throw new Error("Cloudflare Workers AI 响应不是 JPEG 图片。");
  return bytes;
}

export async function synthesizeGoogleTts(input: { apiKey: string; fetcher: MediaFetcher; text: string; voice: GoogleTtsVoice }): Promise<Uint8Array> {
  if (!input.apiKey.trim() || !input.text.trim() || !input.voice.languageCode.trim() || !input.voice.name.trim() || !Number.isFinite(input.voice.speakingRate) || input.voice.speakingRate <= 0) throw new Error("Google TTS 配置或旁白文本无效。");
  const response = await input.fetcher("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": input.apiKey },
    body: JSON.stringify({
      input: { text: input.text },
      voice: { languageCode: input.voice.languageCode, name: input.voice.name },
      audioConfig: { audioEncoding: "MP3", speakingRate: input.voice.speakingRate },
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Google TTS 请求失败：HTTP ${response.status}。`);
  if (!isRecord(payload) || typeof payload.audioContent !== "string" || !payload.audioContent) throw new Error("Google TTS 响应缺少音频内容。");
  return Uint8Array.from(Buffer.from(payload.audioContent, "base64"));
}

export async function searchPexelsVideo(input: { apiKey: string; fetcher: MediaFetcher; query: string; targetDurationSeconds: number }): Promise<{ id: number; durationSeconds: number; downloadUrl: string }> {
  if (!input.apiKey.trim() || !input.query.trim() || !Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds <= 0) throw new Error("Pexels 检索配置无效。");
  if (input.query.length > 100) throw new Error("Pexels 冻结检索词不能超过 100 个字符。");
  const query = input.query.replace(/\s+/g, " ").trim();
  const endpoint = new URL("https://api.pexels.com/videos/search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("orientation", "portrait");
  endpoint.searchParams.set("per_page", "15");
  const response = await input.fetcher(endpoint.toString(), { headers: { Authorization: input.apiKey } });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Pexels 请求失败：HTTP ${response.status}。`);
  if (!isRecord(payload) || !Array.isArray(payload.videos)) throw new Error("Pexels 响应格式无效。");
  for (const video of payload.videos) {
    if (!isRecord(video)) continue;
    const { duration, id, video_files: videoFiles } = video;
    if (typeof id !== "number" || typeof duration !== "number" || !Number.isFinite(duration) || duration < input.targetDurationSeconds || !Array.isArray(videoFiles)) continue;
    const file = videoFiles.find((candidate) => isRecord(candidate) && candidate.file_type === "video/mp4" && typeof candidate.link === "string" && candidate.link && typeof candidate.width === "number" && typeof candidate.height === "number" && candidate.height > candidate.width);
    if (file && isRecord(file)) return { id, durationSeconds: duration, downloadUrl: file.link as string };
  }
  throw new Error("Pexels 未找到符合冻结时长的竖屏视频。");
}

export async function searchFreesoundPreview(input: { apiKey: string; fetcher: MediaFetcher; query: string; targetDurationSeconds: number }): Promise<FreesoundPreview> {
  if (!input.apiKey.trim() || !input.query.trim() || !Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds <= 0) throw new Error("Freesound 检索配置无效。");
  if (input.query.length > 100) throw new Error("Freesound 冻结检索词不能超过 100 个字符。");
  const endpoint = new URL("https://freesound.org/apiv2/search/");
  endpoint.searchParams.set("token", input.apiKey);
  endpoint.searchParams.set("query", input.query.replace(/\s+/g, " ").trim());
  endpoint.searchParams.set("filter", `duration:[${input.targetDurationSeconds} TO *]`);
  endpoint.searchParams.set("sort", "duration_asc");
  endpoint.searchParams.set("fields", "id,name,username,license,duration,url,previews");
  endpoint.searchParams.set("page_size", "50");
  const response = await input.fetcher(endpoint.toString());
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Freesound 请求失败：HTTP ${response.status}。`);
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error("Freesound 响应格式无效。");
  for (const candidate of payload.results) {
    if (!isRecord(candidate) || typeof candidate.id !== "number" || !Number.isInteger(candidate.id) || candidate.id <= 0 || typeof candidate.name !== "string" || !candidate.name.trim() || typeof candidate.username !== "string" || !candidate.username.trim() || typeof candidate.license !== "string" || !candidate.license.trim() || typeof candidate.url !== "string" || !candidate.url || typeof candidate.duration !== "number" || !Number.isFinite(candidate.duration) || candidate.duration < input.targetDurationSeconds || !isRecord(candidate.previews)) continue;
    const previewUrl = candidate.previews["preview-hq-mp3"];
    if (typeof previewUrl !== "string" || !previewUrl) continue;
    return { id: candidate.id, title: candidate.name, creator: candidate.username, license: candidate.license, sourceUrl: candidate.url, previewUrl };
  }
  throw new Error("Freesound 未找到符合冻结时长的 MP3 预览。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
