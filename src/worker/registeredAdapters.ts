import {isRetiredProvider,retiredProviderMessage} from './providerLifecycle.js';
import {wanReferenceModel,wanReferenceMode,wanVideoModel,wanVideoModels} from '../wanVideoModels.js';
import {imageSizes,openAiImageModels,openAiEnhancedImageModels,openAiImageQualities} from '../imageGeneration.js';
import type {VideoGenerationMode} from '../videoVisualInputs.js';
import {klingOmniModel,videoProviders} from "./videoProviderCatalog.js";
export const executionPathKeys = ["external", "local", "manual"] as const;

export type ExecutionPath = typeof executionPathKeys[number];
export type RegisteredExecutionPath = Exclude<ExecutionPath, "manual"> | "internal";
export type LocalAdapterReadiness = Readonly<Record<string, boolean>>;

export interface AcousticAlignmentCapabilities {
  nativeTimestamps: {
    support: "supported" | "unsupported";
    granularity?: "character" | "word" | "phrase";
    detail: string;
  };
  existingTextAudioAlignment: {
    support: "supported" | "unsupported";
    granularity?: "character" | "word" | "phrase";
    detail: string;
  };
}

export const productionCapabilityLabels = {image: '图片', video: '视频', speech: '语音', music_sound: '音乐与音效'} as const;
export type ProductionCapability = keyof typeof productionCapabilityLabels;
export type ProductionInputMode = 'text' | 'reference_images' | 'first_frame' | 'query' | 'storyboard';
export type {VideoGenerationMode,VideoVisualInputLimit,VideoVisualInputRole} from '../videoVisualInputs.js';
export function firstFrameVideoMode(limit?: ProductionServiceConstraints['firstFrame']): VideoGenerationMode {
  return {id:'first-frame',label:'首帧生成',inputs:{firstFrame:{max:1,min:1,maxBytes:limit?.maxBytes,mimeTypes:limit?.mimeTypes}}};
}
export interface ProductionServiceConstraints {
  prompt?: {maxLength: number};
  query?: {maxLength: number};
  durationSeconds?: {min: number; max: number; integer: boolean};
  firstFrame?: {required: boolean; maxBytes: number; mimeTypes: readonly string[]};
  referenceImages?: {max: number; maxBytes: number; mimeTypes: readonly string[]};
  sizes?: readonly string[];
  qualities?: readonly string[];
  counts?: readonly number[];
  resolutions?: readonly string[];
  aspectRatios?: readonly string[];
  orientation?: 'portrait';
  speakingRate?: {min: number; max: number};
}
interface ProductionServiceDeclaration {
  modelConstraints?: Readonly<Record<string, Partial<ProductionServiceConstraints>>>;
  capability: ProductionCapability;
  label: string;
  mode: 'generation' | 'search' | 'local';
  inputModes: readonly ProductionInputMode[];
  videoGenerationModes?: Readonly<Record<string, readonly VideoGenerationMode[]>>;
  constraints: ProductionServiceConstraints;
}
export interface RegisteredProductionChoice extends ProductionServiceDeclaration {
  adapter: string;
  provider: string;
  identityKey: string;
  executionPath: RegisteredExecutionPath;
  connection: RegisteredAdapterChoice['connection'];
  legacyCapabilities: readonly string[];
  models: readonly string[];
  presets: readonly string[];
  voiceCatalog?: Readonly<Record<string, readonly string[]>>;
}
/** Read compatibility only: historical connection/task declarations are never rewritten. */
export function normalizeProductionCapability(value: string): ProductionCapability | undefined {
  if (Object.hasOwn(productionCapabilityLabels, value)) return value as ProductionCapability;
  switch (value) {
    case 'static_visual_generation': return 'image';
    case 'a_roll_generation': case 'b_roll_generation': case 'video_generation': return 'video';
    case 'narration_generation': return 'speech';
    case 'soundtrack_generation': return 'music_sound';
    default: return undefined;
  }
}

export interface RegisteredAdapterCapability {
  capability: string;
  configurationFields: readonly string[];
  modelCatalog: readonly string[];
  presetCatalog: readonly string[];
  voiceCatalog?: Readonly<Record<string, readonly string[]>>;
  acousticAlignment?: AcousticAlignmentCapabilities;
}

export interface RegisteredAdapterChoice extends RegisteredAdapterCapability {
  adapter: string;
  connection: { kind: "none" } | { kind: "owner_managed"; type: string; endpoint?: string };
  execution: { kind: "codex" | "controlled_media" | "ffmpeg" | "openchatcut" | "whisperx"; safetyLimit: number };
  executionPath: RegisteredExecutionPath;
  identityKey: string;
  provider: string;
}

export type AdapterSelection = {
  adapter?: string;
  capability: string;
  executionPath?: ExecutionPath | "";
  model?: string;
  preset?: string;
  provider?: string;
};

export type AdapterResolution =
  | { kind: "manual"; capability: string }
  | { kind: "registered"; choice: RegisteredAdapterChoice }
  | { kind: "invalid"; code: "adapter_missing" | "adapter_unregistered" | "capability_unsupported" | "execution_path_mismatch" | "model_unsupported" | "preset_unsupported"; detail: string };

interface RegisteredAdapterDefinition {
  adapter: string;
  capabilities: readonly RegisteredAdapterCapability[];
  production?: readonly ProductionServiceDeclaration[];
  connection: RegisteredAdapterChoice["connection"];
  execution: RegisteredAdapterChoice["execution"];
  executionPath: RegisteredExecutionPath;
  provider: string;
}

const volcengineTtsAlignment: AcousticAlignmentCapabilities = {
  nativeTimestamps: { support: "unsupported", detail: "当前豆包 V3 SSE 实现只请求并解析音频数据，尚未验证时间戳响应字段。" },
  existingTextAudioAlignment: { support: "unsupported", detail: "自动字幕打轴是独立服务与授权，当前冻结的豆包 TTS 连接版本未声明兼容。" },
};

const officialFirstFrame={required:true,maxBytes:10*1024*1024,mimeTypes:['image/png','image/jpeg']};
const officialFrame={...firstFrameVideoMode(officialFirstFrame).inputs.firstFrame!,min:1};
const seedanceModes=Object.fromEntries(videoProviders.volcengine.models.map((model,index)=>[model,[
 firstFrameVideoMode(officialFirstFrame),
 {id:'keyframes',label:'首尾帧生成',inputs:{firstFrame:officialFrame,lastFrame:officialFrame}},
 {id:'references',label:'参考素材生成',allowAssetVideoSource:true,inputs:{
  referenceImages:{max:index===0?9:30,maxBytes:10*1024*1024,mimeTypes:officialFirstFrame.mimeTypes},
  referenceVideos:{max:index===0?3:10,maxBytes:200*1024*1024,mimeTypes:['video/mp4','video/quicktime']},
 }},
] satisfies VideoGenerationMode[]]));
const officialVideoModes:Record<string,Readonly<Record<string,readonly VideoGenerationMode[]>>> = {
 volcengine:seedanceModes,
 minimax:{'MiniMax-H3':[
  firstFrameVideoMode(officialFirstFrame),
  {id:'keyframes',label:'首尾帧生成',inputs:{firstFrame:officialFrame,lastFrame:officialFrame}},
  {id:'references',label:'参考素材生成',allowInlineMp4:true,inputs:{
   referenceImages:{max:9,maxBytes:30*1024*1024,mimeTypes:['image/png','image/jpeg','image/webp']},
   referenceVideos:{max:3,maxBytes:50*1024*1024,mimeTypes:['video/mp4','video/quicktime']},
  }},
 ]},
 kling:{'kling-v3':[
  firstFrameVideoMode(officialFirstFrame),
  {id:'keyframes',label:'首尾帧生成',inputs:{firstFrame:officialFrame,lastFrame:officialFrame}},
 ],[klingOmniModel]:[
  {id:'references',label:'参考素材生成',maxImagesWithVideo:4,videoSeconds:{min:3,max:15},inputs:{
   referenceImages:{max:7,maxBytes:10*1024*1024,mimeTypes:officialFirstFrame.mimeTypes},
   referenceVideos:{max:1,maxBytes:200*1024*1024,mimeTypes:['video/mp4','video/quicktime']},
  }},
 ]},
};
const manifest: readonly RegisteredAdapterDefinition[] = [
  ...Object.entries(videoProviders).map(([provider, definition]): RegisteredAdapterDefinition => ({
    production: [{capability: 'video', label: definition.label, mode: 'generation', inputModes: ['text', 'first_frame'], constraints: {prompt: {maxLength: 1500}, durationSeconds: {min: definition.minDuration, max: definition.maxDuration, integer: true}, firstFrame: officialFirstFrame, ...(provider==='kling'?{}:{resolutions: [provider === 'minimax' ? '768P' : '720p'], aspectRatios: ['adaptive']})}, videoGenerationModes:officialVideoModes[provider]}],
    provider, adapter: definition.adapter, executionPath: "external", connection: {kind: "owner_managed", type: provider+"_video_api", endpoint: definition.endpoint}, execution: {kind: "controlled_media", safetyLimit: 1},
    capabilities: ["a_roll_generation", "b_roll_generation"].map(capability => ({capability, configurationFields: ["credential_ref", "max_attempts"], modelCatalog: definition.models, presetCatalog: ["official-video-v1"]})),
  })),
  { production: [{capability: 'video', label: '百炼万相视频', mode: 'generation', inputModes: ['text', 'first_frame'], constraints: {prompt: {maxLength: 1500}, durationSeconds: {min: 2, max: 15, integer: true}, firstFrame: {required: true, maxBytes: 20*1024*1024, mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']}, resolutions: ['720P','1080P'], aspectRatios: ['adaptive']}}], provider: "bailian", adapter: "wan_video", executionPath: "external", connection: { kind: "owner_managed", type: "bailian_video_api", endpoint: "https://dashscope.aliyuncs.com" }, execution: { kind: "controlled_media", safetyLimit: 1 }, capabilities: [
    { capability: "a_roll_generation", configurationFields: ["credential_ref", "max_attempts"], modelCatalog: Object.keys(wanVideoModels), presetCatalog: ["wan-video-v1"] },
    { capability: "b_roll_generation", configurationFields: ["credential_ref", "max_attempts"], modelCatalog: Object.keys(wanVideoModels), presetCatalog: ["wan-video-v1"] },
  ] },
  { provider: "codex", adapter: "codex", executionPath: "internal", connection: { kind: "none" }, execution: { kind: "codex", safetyLimit: 1 }, capabilities: [
    { capability: "script_writing", configurationFields: ["model"], modelCatalog: [], presetCatalog: [] },
    { capability: "visual_planning", configurationFields: ["model"], modelCatalog: [], presetCatalog: [] },
    { capability: "storyboard_planning", configurationFields: ["model", "prompt_harness"], modelCatalog: [], presetCatalog: [] },
  ] },
  { production: [{capability: 'image', label: 'OpenAI Images', mode: 'generation', modelConstraints: Object.fromEntries(openAiEnhancedImageModels.map(model=>[model,{qualities:openAiImageQualities(model)}])), inputModes: ['text', 'reference_images'], constraints: {sizes: imageSizes, qualities: ['auto','low','medium','high'], counts: [1,2,4], referenceImages: {max: 16, maxBytes: 20*1024*1024, mimeTypes: ['image/png','image/jpeg','image/webp']}}}], provider: "openai", adapter: "openai_images", executionPath: "external", connection: { kind: "owner_managed", type: "openai_api", endpoint: "https://api.openai.com/v1" }, execution: { kind: "controlled_media", safetyLimit: 1 }, capabilities: [
    { capability: "static_visual_generation", configurationFields: ["model", "credential_ref", "max_attempts"], modelCatalog: openAiImageModels, presetCatalog: ["static-visual-v1"] },
  ] },
  { production: [{capability: 'video', label: 'Pexels 素材检索', mode: 'search', inputModes: ['query'], constraints: {query: {maxLength: 100}, orientation: 'portrait'}}], provider: "pexels", adapter: "pexels_video", executionPath: "external", connection: { kind: "owner_managed", type: "pexels_api", endpoint: "https://api.pexels.com" }, execution: { kind: "controlled_media", safetyLimit: 3 }, capabilities: [
    { capability: "b_roll_generation", configurationFields: ["max_attempts"], modelCatalog: ["pexels-video-v1"], presetCatalog: ["b-roll-v1"] },
  ] },
  { production: [{capability: 'speech', label: '豆包语音 V3', mode: 'generation', inputModes: ['text'], constraints: {speakingRate: {min: 0.5, max: 2}}}], provider: "volcengine_tts", adapter: "volcengine_tts", executionPath: "external", connection: { kind: "owner_managed", type: "volcengine_tts_api", endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse" }, execution: { kind: "controlled_media", safetyLimit: 2 }, capabilities: [
    { capability: "narration_generation", configurationFields: ["credential_ref", "max_attempts"], modelCatalog: ["seed-tts-2.0"], presetCatalog: ["narration-v1"], voiceCatalog: { "zh-CN": ["zh_female_vv_uranus_bigtts", "zh_male_m191_uranus_bigtts", "zh_male_taocheng_uranus_bigtts", "zh_female_xiaohe_uranus_bigtts", "zh_female_qingxinnvsheng_uranus_bigtts", "zh_male_huolixiaoge_uranus_bigtts", "zh_male_baqiqingshu_uranus_bigtts", "zh_female_mizai_uranus_bigtts", "ICL_uranus_zh_male_paoxiaoxiaoge_tob", "zh_male_xionger_uranus_bigtts"], "en-US": ["zh_female_vv_uranus_bigtts"], "ja-JP": ["zh_female_vv_uranus_bigtts"], "es-ES": ["zh_female_vv_uranus_bigtts"] }, acousticAlignment: volcengineTtsAlignment },
  ] },
  { production: [{capability: 'music_sound', label: 'Freesound 配乐 / 音效', mode: 'search', inputModes: ['query'], constraints: {query: {maxLength: 100}}}], provider: "freesound", adapter: "freesound_preview", executionPath: "external", connection: { kind: "owner_managed", type: "freesound_api", endpoint: "https://freesound.org/apiv2" }, execution: { kind: "controlled_media", safetyLimit: 1 }, capabilities: [
    { capability: "soundtrack_generation", configurationFields: ["credential_ref", "max_attempts"], modelCatalog: ["freesound-preview-v1"], presetCatalog: ["soundtrack-v1"] },
  ] },
  { provider: "ffmpeg", adapter: "ffmpeg_extract_audio", executionPath: "internal", connection: { kind: "none" }, execution: { kind: "ffmpeg", safetyLimit: 1 }, capabilities: [
    { capability: "embedded_audio_extraction", configurationFields: [], modelCatalog: [], presetCatalog: [] },
  ] },
  { provider: "ffmpeg", adapter: "ffmpeg_trim_video", executionPath: "internal", connection: { kind: "none" }, execution: { kind: "ffmpeg", safetyLimit: 1 }, capabilities: [
    { capability: "shot_clip_preparation", configurationFields: [], modelCatalog: [], presetCatalog: [] },
  ] },
  { provider: "whisperx", adapter: "whisperx_local", executionPath: "local", connection: { kind: "none" }, execution: { kind: "whisperx", safetyLimit: 1 }, capabilities: [
    { capability: "acoustic_alignment", configurationFields: [], modelCatalog: ["large-v3", "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"], presetCatalog: ["whisperx-alignment-v1"] },
  ] },
  { production: [{capability: 'video', label: 'OpenChatCut 卡片视频', mode: 'local', inputModes: ['storyboard'], constraints: {}}], provider: "openchatcut", adapter: "openchatcut_card_video", executionPath: "local", connection: { kind: "none" }, execution: { kind: "openchatcut", safetyLimit: 1 }, capabilities: [
    { capability: "a_roll_generation", configurationFields: ["max_attempts"], modelCatalog: ["openchatcut@0.2.14"], presetCatalog: ["card-video-v1"] },
    { capability: "b_roll_generation", configurationFields: ["max_attempts"], modelCatalog: ["openchatcut@0.2.14"], presetCatalog: ["card-video-v1"] },
  ] },
  { provider: "openchatcut", adapter: "openchatcut", executionPath: "internal", connection: { kind: "none" }, execution: { kind: "openchatcut", safetyLimit: 1 }, capabilities: [
    { capability: "review_rendering", configurationFields: [], modelCatalog: ["openchatcut@0.2.14"], presetCatalog: ["review-render-v1", "review-render-v4"] },
    { capability: "final_rendering", configurationFields: [], modelCatalog: ["openchatcut@0.2.14"], presetCatalog: ["final-render-v1"] },
  ] },
] as const;

function identityKey(provider: string, adapter: string): string {
  return `${provider}:${adapter}`;
}

function validateManifest(definitions: readonly RegisteredAdapterDefinition[]): void {
  const identities = new Set<string>();
  for (const definition of definitions) {
    const identity = identityKey(definition.provider, definition.adapter);
    if (!definition.provider || !definition.adapter || definition.capabilities.length === 0) throw new Error("Adapter manifest 存在空身份或空能力声明。");
    if (identities.has(identity)) throw new Error(`重复的 Adapter 身份：${identity}`);
    if (!Number.isInteger(definition.execution.safetyLimit) || definition.execution.safetyLimit < 1) throw new Error(`Adapter ${identity} 的安全并发上限无效。`);
    if ((definition.executionPath === "external") !== (definition.connection.kind === "owner_managed")) throw new Error(`Adapter ${identity} 的执行路径与连接要求不一致。`);
    const capabilities = new Set<string>();
    for (const declaration of definition.capabilities) {
      if (capabilities.has(declaration.capability)) throw new Error(`Adapter ${identity} 重复声明能力 ${declaration.capability}。`);
      capabilities.add(declaration.capability);
    }
    for (const production of definition.production??[]) {
      if (!definition.capabilities.some(declaration=>normalizeProductionCapability(declaration.capability)===production.capability)) throw new Error(`Adapter ${identity} 未声明制作功能 ${production.capability}。`);
    }
    identities.add(identity);
  }
}

validateManifest(manifest);

function choicesFor({ capability, executionPath }: { capability: string; executionPath?: RegisteredExecutionPath }): readonly RegisteredAdapterChoice[] {
  return manifest.flatMap((definition) => {
    if (executionPath && definition.executionPath !== executionPath) return [];
    const declaration = definition.capabilities.find((candidate) => candidate.capability === capability);
    return declaration ? [{ ...declaration, adapter: definition.adapter, connection: definition.connection, execution: definition.execution, executionPath: definition.executionPath, identityKey: identityKey(definition.provider, definition.adapter), provider: definition.provider }] : [];
  });
}

function resolve(selection: AdapterSelection): AdapterResolution {
  if (selection.executionPath === "manual") return { kind: "manual", capability: selection.capability };
  const provider = selection.provider?.trim() ?? "";
  let adapter = selection.adapter?.trim() ?? "";
  if (!adapter && provider === "openchatcut" && (selection.capability === "review_rendering" || selection.capability === "final_rendering")) adapter = "openchatcut";
  if(isRetiredProvider(provider))return{kind:"invalid",code:"adapter_unregistered",detail:retiredProviderMessage};
  if (!provider || !adapter) return { kind: "invalid", code: "adapter_missing", detail: `能力 ${selection.capability} 缺少 Provider 或 Adapter。` };
  const definition = manifest.find((candidate) => candidate.provider === provider && candidate.adapter === adapter);
  if (!definition) return { kind: "invalid", code: "adapter_unregistered", detail: `未注册 Adapter ${provider}/${adapter}。` };
  const declaration = definition.capabilities.find((candidate) => candidate.capability === selection.capability);
  if (!declaration) return { kind: "invalid", code: "capability_unsupported", detail: `Adapter ${provider}/${adapter} 不支持能力 ${selection.capability}。` };
  if (selection.executionPath && selection.executionPath !== definition.executionPath) return { kind: "invalid", code: "execution_path_mismatch", detail: `Adapter ${provider}/${adapter} 不属于 ${selection.executionPath} 执行路径。` };
  if (selection.model && declaration.modelCatalog.length && !declaration.modelCatalog.includes(selection.model)) return { kind: "invalid", code: "model_unsupported", detail: `Adapter ${provider}/${adapter} 不支持模型 ${selection.model}。` };
  if (selection.preset && declaration.presetCatalog.length && !declaration.presetCatalog.includes(selection.preset)) return { kind: "invalid", code: "preset_unsupported", detail: `Adapter ${provider}/${adapter} 不支持预设 ${selection.preset}。` };
  return { kind: "registered", choice: { ...declaration, adapter, connection: definition.connection, execution: definition.execution, executionPath: definition.executionPath, identityKey: identityKey(provider, adapter), provider } };
}

function productionChoices(): readonly RegisteredProductionChoice[] {
  return manifest.flatMap(definition => (definition.production??[]).map(production => {
    const declarations = definition.capabilities.filter(declaration => normalizeProductionCapability(declaration.capability) === production.capability);
    const models = production.mode === 'search' ? [] : [...new Set(declarations.flatMap(declaration => declaration.modelCatalog))];
    const firstFrame = production.constraints.firstFrame;
    const videoGenerationModes = production.capability==='video'&&production.mode==='generation'&&firstFrame
      ? production.videoGenerationModes??Object.fromEntries(models.map(model=>{
        const maxBytes = definition.provider==='bailian'?wanVideoModel(model)?.maxBytes:undefined;
        if(definition.provider==='bailian'&&model===wanReferenceModel)return [model,[wanReferenceMode]];
        return [model,[firstFrameVideoMode({...firstFrame,maxBytes:maxBytes??firstFrame.maxBytes})]];
      }))
      : production.videoGenerationModes;
    return {...production, ...(videoGenerationModes?{videoGenerationModes}:{}), provider: definition.provider, adapter: definition.adapter, identityKey: identityKey(definition.provider, definition.adapter), executionPath: definition.executionPath, connection: definition.connection, legacyCapabilities: declarations.map(declaration => declaration.capability), models, presets: [...new Set(declarations.flatMap(declaration => declaration.presetCatalog))], ...(declarations[0]?.voiceCatalog ? {voiceCatalog: declarations[0].voiceCatalog} : {})};
  }));
}
export const registeredAdapters = Object.freeze({ choicesFor, resolve, productionChoices });
