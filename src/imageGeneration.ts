import {creativeMediaPrompt} from './creativeAccountRules.js';
export const imageSizePresets = [
  {ratio:'9:16', label:'竖屏 9:16', standard:'864x1536', high:'1152x2048'},
  {ratio:'16:9', label:'横屏 16:9', standard:'1536x864', high:'2048x1152'},
  {ratio:'1:1', label:'方形 1:1', standard:'1024x1024', high:'1536x1536'},
  {ratio:'2:3', label:'竖图 2:3', standard:'1024x1536', high:'1280x1920'},
  {ratio:'3:2', label:'横图 3:2', standard:'1536x1024', high:'1920x1280'},
] as const;
export const imageSizes = imageSizePresets.flatMap(p=>[p.standard,p.high]);
export const openAiImage25Models = ['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08'] as const;
export const openAiImage26Models = ['gpt-image-2.6-sunburst','gpt-image-2.6-flare'] as const;
export const openAiEnhancedImageModels:readonly string[] = [...openAiImage25Models,...openAiImage26Models];
export const openAiImageModels:readonly string[] = ['gpt-image-2',...openAiEnhancedImageModels];
export const imageQualityLabels = {auto:'自动',low:'低',medium:'中',high:'高',xhigh:'超高',max:'最高'} as const;
export function openAiImageQualities(model?:string):readonly (keyof typeof imageQualityLabels)[]{
 return openAiEnhancedImageModels.some(id=>id===model)?['auto','low','medium','high','xhigh','max']:['auto','low','medium','high'];
}
export interface ImageGenerationSettings {
  size: typeof imageSizes[number];
  quality: keyof typeof imageQualityLabels;
  count: 1 | 2 | 4;
}

export const referencePurposeLabels={subject:'主体',character:'人物',product:'产品',style:'风格',composition:'构图'} as const;
export const framingLabels={auto:'由提示词决定',full:'完整展示主体',close:'主体特写'} as const;
export const captionSpaceLabels={none:'不额外留白',bottom:'下方留字幕空间',top:'上方留字幕空间'} as const;
export interface ImageBrief {
  references:Array<{materialRevisionId:string;purpose:keyof typeof referencePurposeLabels;preserve:string;change:string}>;
  framing:keyof typeof framingLabels;
  captionSpace:keyof typeof captionSpaceLabels;
  crop:'allow'|'protect';
}
export const emptyImageBrief:ImageBrief={references:[],framing:'auto',captionSpace:'none',crop:'allow'};
export function isImageBrief(value:unknown,ids:unknown[]):value is ImageBrief {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const b=value as ImageBrief;
  return Object.keys(b).every(k=>['references','framing','captionSpace','crop'].includes(k))&&
    Object.hasOwn(framingLabels,b.framing)&&Object.hasOwn(captionSpaceLabels,b.captionSpace)&&['allow','protect'].includes(b.crop)&&
    Array.isArray(b.references)&&b.references.length<=16&&new Set(b.references.map(r=>r?.materialRevisionId)).size===b.references.length&&
    b.references.every(r=>r&&Object.keys(r).every(k=>['materialRevisionId','purpose','preserve','change'].includes(k))&&ids.includes(r.materialRevisionId)&&Object.hasOwn(referencePurposeLabels,r.purpose)&&typeof r.preserve==='string'&&r.preserve.length<=160&&typeof r.change==='string'&&r.change.length<=160);
}
/** These are prompt instructions, never provider fidelity or weighting parameters. */
export function imageBriefPrompt(brief:ImageBrief,ids:string[]):string {
  return [
    ...brief.references.map(r=>`参考图 ${ids.indexOf(r.materialRevisionId)+1}：${referencePurposeLabels[r.purpose]}。${r.preserve.trim()?`保留：${r.preserve.trim()}。`:''}${r.change.trim()?`允许改变：${r.change.trim()}。`:''}`),
    ...(brief.framing==='auto'?[]:[`构图：${framingLabels[brief.framing]}。`]),
    ...(brief.captionSpace==='none'?[]:[`构图：${captionSpaceLabels[brief.captionSpace]}，该区域避免放置重要主体细节；不要绘制字幕或文字。`]),
    ...(brief.crop==='protect'?['主体关键部位和产品边缘完整入画，避免贴近画面边缘，为后续裁切留出空间。']:[]),
  ].join('\n');
}
export function isImageGenerationSettings(value: unknown): value is ImageGenerationSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as ImageGenerationSettings;
  return imageSizes.includes(s.size) && Object.hasOwn(imageQualityLabels,s.quality) && [1, 2, 4].includes(s.count);
}

/** One exact request text shared by call estimation and queued image generation. */
export function imageRequestPrompt(prompt:string,brief:ImageBrief,ids:string[],accountRules:Record<string,unknown>,seriesRules:unknown){
 const composed=[prompt.trim(),imageBriefPrompt(brief,ids)].filter(Boolean).join('\n\n');
 return creativeMediaPrompt(composed,accountRules,seriesRules);
}
