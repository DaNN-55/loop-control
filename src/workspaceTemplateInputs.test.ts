import {it,expect} from 'vitest';
import {parseProductionScript} from './reviews/productionScript';
import {productionTemplateInputs,resolveTemplateMaterial} from './workspaceTemplateInputs';
const text='# 预填\n## 制作设置\n- 模板版本：3\n- 旁白音色：voice-a\n- 旁白语速：0.9\n- 旁白语言：zh-CN\n- 背景音乐素材：背景\n- 封面素材：产品.png\n- 视频费用预留（分/镜头）：250\n## 正文\n### 段落 01\n- 口播：第一镜\n- 画面来源：图片\n- 画面提示：静态构图\n- 视频提示词：镜头缓缓移动\n- 素材名称：产品\n- 音效素材：轻响\n- 旁白语速：1.1\n### 段落 02\n- 口播：第二镜\n- 画面来源：视频\n- 画面提示：夜色\n- 音效素材：无\n';
const material=(id:string,name:string,type='image',purpose='visual_reference',sha256=id)=>({id,name,type,purpose,sha256,relativePath:'media/'+name,fileSize:100});
it('keeps separate prompts and inherited speech, named sources and per-shot reservations',()=>{
 const result=productionTemplateInputs(parseProductionScript(text)!,[material('image','产品.png'),material('music','背景.mp3','audio','background_music'),material('sound','轻响.mp3','audio','sound_effect')]);
 expect(result?.narration).toEqual({voice:'voice-a',speakingRate:.9,languageCode:'zh-CN'});
 expect(result?.shots[0]).toMatchObject({shotId:'shot-01',imagePrompt:'静态构图',videoPrompt:'镜头缓缓移动',narration:{voice:'voice-a',speakingRate:1.1,languageCode:'zh-CN'},videoReservationCents:250,visual:{status:'bound',material:{id:'image'}},sfx:{status:'bound',material:{id:'sound'}}});
 expect(result?.shots[1]).toMatchObject({videoPrompt:'夜色',sfx:{status:'none'}});
 expect(result?.bgm).toMatchObject({status:'bound',material:{id:'music'}});expect(result?.cover).toMatchObject({status:'bound',material:{id:'image'}});
});
it('does not guess ambiguous, missing or wrong-purpose sources and collapses identical bytes',()=>{
 const files=[material('a','产品.png'),material('b','产品.jpg'),material('c','轻响.mp3','audio','narration')];
 expect(resolveTemplateMaterial('产品','visual',files)?.status).toBe('ambiguous');
 expect(resolveTemplateMaterial('轻响','sfx',files)?.status).toBe('missing');
 expect(resolveTemplateMaterial('missing','cover',files)?.status).toBe('missing');
 expect(resolveTemplateMaterial(undefined,'bgm',files)).toBeUndefined();expect(resolveTemplateMaterial('none','bgm',files)?.status).toBe('none');
 expect(resolveTemplateMaterial('产品','visual',[files[0],{...files[1],sha256:'a'}])?.material?.id).toBe('a');
});
it('keeps legacy scripts out of current template prefills',()=>{
 const legacy=parseProductionScript('# 历史\n## 制作设置\n- 模板版本：2\n## 正文\n### 段落 01\n- 口播：保留\n- 首帧素材：无\n- 视频生成提示词：历史提示\n')!;
 expect(productionTemplateInputs(legacy,[])).toBeUndefined();
});
