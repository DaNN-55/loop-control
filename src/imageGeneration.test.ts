import {it,expect} from 'vitest';
import {imageSizes,isImageGenerationSettings,isImageBrief,imageBriefPrompt,imageRequestPrompt,emptyImageBrief} from './imageGeneration';
it('allows standard and high-resolution sizes and rejects arbitrary unsupported values',()=>{
 for(const size of imageSizes){expect(isImageGenerationSettings({size,quality:'high',count:2})).toBe(true);expect(size.split('x').every(n=>Number(n)%16===0)).toBe(true);}
 expect(isImageGenerationSettings({size:'1080x1920',quality:'high',count:1})).toBe(false);
});
it('binds reference instructions to the submitted order and rejects unselected images, duplicate or unknown fields',()=>{
 const brief={...emptyImageBrief,framing:'full' as const,captionSpace:'bottom' as const,crop:'protect' as const,references:[{materialRevisionId:'b',purpose:'subject' as const,preserve:'图案',change:'背景'}]};
 expect(isImageBrief(brief,['a','b'])).toBe(true);const prompt=imageBriefPrompt(brief,['a','b']);expect(prompt).toContain('参考图 2');expect(prompt).toContain('保留：图案');expect(prompt).toContain('允许改变：背景');expect(prompt).toContain('下方留字幕空间');expect(prompt).toContain('裁切');
 expect(isImageBrief(brief,['a'])).toBe(false);expect(isImageBrief({...brief,references:[...brief.references,...brief.references]},['b'])).toBe(false);expect(isImageBrief({...brief,seed:0},['b'])).toBe(false);expect(imageBriefPrompt(emptyImageBrief,[])).toBe('');
});

it('composes one complete image request including the reference brief, account and series rules',()=>{
 const brief={...emptyImageBrief,references:[{materialRevisionId:'ref',purpose:'product' as const,preserve:'商标',change:'背景'}]};
 expect(imageRequestPrompt(' 主提示词 ',brief,['ref'],{tone:'克制'},{style:'纪实'})).toBe('主提示词\n\n参考图 1：产品。保留：商标。允许改变：背景。\n\n账号创作规则：{"tone":"克制"}\n系列创作规则：{"style":"纪实"}');
});
