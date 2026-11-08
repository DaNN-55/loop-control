// @vitest-environment node
import {it,expect} from 'vitest';
import {estimateWorkspaceCall as estimate,gptImage2OutputTokens,imagePromptTokens,imageReferenceTokens} from './workspaceCallEstimate';
import {defaultWanModelSettings} from '../wanVideoModels';
it('uses actual billable seconds, selected resolution/audio, and the selected Wan model',()=>{
 const base={kind:'video' as const,provider:'bailian',text:'',seconds:5,model:'wan2.6-i2v-flash'};
 expect(estimate(base)).toMatchObject({estimatedCents:75,suggestedCents:90});
 expect(estimate({...base,seconds:10}).suggestedCents).toBe(180);
 expect(estimate({...base,videoSettings:{...defaultWanModelSettings(base.model),resolution:'1080P',audio:true}}).suggestedCents).toBe(300);
 expect(estimate({...base,model:'wan2.6-i2v'}).suggestedCents).toBe(360);
});
it('uses model-specific Seedance rates and an explicit currency assumption for MiniMax',()=>{
 const base={kind:'video' as const,provider:'volcengine',text:'',seconds:5};
 expect(estimate({...base,model:'doubao-seedance-2-0-260128'})).toMatchObject({estimatedCents:497,suggestedCents:597});
 expect(estimate({...base,model:'doubao-seedance-2-5-260628'})).toMatchObject({estimatedCents:756,suggestedCents:908});
 expect(estimate({...base,provider:'minimax',model:'MiniMax-H3'})).toMatchObject({estimatedCents:288,suggestedCents:346});
 expect(estimate({...base,provider:'minimax',model:'MiniMax-H3',region:'cn'})).toMatchObject({conservative:false,estimatedCents:250,suggestedCents:300});
});
it('scales image estimates by count, pixels, quality and reference count without using pre-Image-2 token tables',()=>{
 const base={kind:'image' as const,provider:'openai',model:'gpt-image-2',text:'',settings:{size:'1024x1024',quality:'low',count:1}};
 const low=estimate(base),four=estimate({...base,settings:{...base.settings,count:4}}),large=estimate({...base,settings:{...base.settings,size:'1536x1536'}}),high=estimate({...base,settings:{...base.settings,quality:'high'}});
 expect(four.suggestedCents).toBeGreaterThan(low.suggestedCents);expect(large.suggestedCents).toBeGreaterThan(low.suggestedCents);expect(high.suggestedCents).toBeGreaterThan(low.suggestedCents);
 expect(estimate({...base,settings:{...base.settings,quality:'auto'}}).suggestedCents).toBe(high.suggestedCents);expect(estimate({...base,referenceImages:[{width:1024,height:1024},{width:1024,height:1536}]}).suggestedCents).toBeGreaterThan(low.suggestedCents);expect(high.conservative).toBe(true);
});
it('preserves the speech reservation floor independently from the published character tariff',()=>{
 expect(estimate({kind:'speech',provider:'volcengine_tts',model:'seed-tts-2.0',text:'中'.repeat(100)})).toMatchObject({estimatedCents:3,minimumCents:100,suggestedCents:100});
 expect(estimate({kind:'sound',provider:'freesound',text:'wind'})).toMatchObject({estimatedCents:0,suggestedCents:0,minimumCents:0,maximumCents:0});
});
it('uses the actual Kling video balance rate and preserves the unverified-model fallback',()=>{
 expect(estimate({kind:'video',provider:'kling',model:'kling-v3',text:'',seconds:5})).toMatchObject({conservative:false,estimatedCents:303,suggestedCents:363});
 expect(estimate({kind:'video',provider:'future-provider',model:'unknown',text:'',seconds:5})).toMatchObject({conservative:true,estimatedCents:500,suggestedCents:600});
});
it.each([
 [1024,1024,196,1756,7024], [1024,1536,158,1372,5488], [1536,1024,158,1372,5488],
 [864,1536,120,1078,4312], [1152,2048,157,1413,5650], [1536,784,103,923,3769], [1536,816,105,1016,3983],
])('matches official Image 2 calculator at %i x %i, including rounding ties',(w,h,low,medium,high)=>{
 expect(gptImage2OutputTokens(w,h,'low')).toBe(low);expect(gptImage2OutputTokens(w,h,'medium')).toBe(medium);expect(gptImage2OutputTokens(w,h,'high')).toBe(high);
});
it('charges the precise non-square output estimate at Standard rates, with inputs still marked conservative',()=>{
 const result=estimate({kind:'image',provider:'openai',model:'gpt-image-2',text:'',settings:{size:'1024x1536',quality:'high',count:1}});
 expect(result).toMatchObject({estimatedCents:119,suggestedCents:143,conservative:true});expect(result.imageInputs?.outputTokensPerImage).toBe(5488);expect(result.basis).toContain('$5/$8/$30');
});

it('estimates mixed-language text by code points and keeps empty input free',()=>{
 expect(imagePromptTokens('')).toBe(0);expect(imagePromptTokens('abcdefghijklmnop')).toBe(4);expect(imagePromptTokens('中文测试')).toBe(6);expect(imagePromptTokens('ABCD中文😀')).toBe(6);
 expect(imagePromptTokens('a'.repeat(1000))).toBeGreaterThan(imagePromptTokens('a'.repeat(100)));
});
it('budgets each reference from its measured original pixels with an explicit high-fidelity floor',()=>{
 expect(imageReferenceTokens(256,256)).toBe(2560);expect(imageReferenceTokens(1024,1024)).toBe(10240);expect(imageReferenceTokens(2048,2048)).toBe(34816);expect(imageReferenceTokens(400,800)).toBe(imageReferenceTokens(800,400));
});
it('returns an auditable input breakdown, scales references independently, and reserves auto like high',()=>{
 const base={kind:'image' as const,provider:'openai',model:'gpt-image-2',text:'a'.repeat(400),settings:{size:'1024x1024',quality:'high',count:1},referenceImages:[{width:256,height:256},{width:2048,height:2048}]};
 const result=estimate(base);expect(result.imageInputs).toMatchObject({textCharacters:400,textTokens:100,referenceTokens:37376,references:[{width:256,height:256,tokens:2560},{width:2048,height:2048,tokens:34816}],quality:'high'});expect(result.basis).toContain('256×256');expect(result.basis).toContain('2048×2048');expect(result.basis).toContain('本地近似');
 expect(estimate({...base,settings:{...base.settings,quality:'auto'}}).suggestedCents).toBe(result.suggestedCents);
 expect(estimate({...base,referenceImages:[{width:256,height:256}]}).suggestedCents).toBeLessThan(result.suggestedCents);
 expect(estimate({...base,referenceImages:[],text:'a'.repeat(100000)}).suggestedCents).toBeGreaterThan(estimate({...base,referenceImages:[]}).suggestedCents);
});

it.each(['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare'])('does not apply the GPT Image 2 token calculator to %s',model=>{
 const result=estimate({kind:'image',provider:'openai',model,text:'画面',settings:{size:'864x1536',quality:'max',count:4}});
 expect(result.manualReservation).toBe(true);expect(result.imageInputs).toBeUndefined();expect(result.basis).toContain('手动');expect(result.bufferPercent).toBe(0);
});
