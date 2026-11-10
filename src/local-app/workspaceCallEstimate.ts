import {minimaxVideoModels,minimaxVideoResolution} from '../worker/videoProviderCatalog.js';
import {openAiEnhancedImageModels} from '../imageGeneration.js';
import {gptImage2EstimateRates,type WorkspaceCallEstimate} from '../workspaceCall.js';
import {defaultWanModelSettings,wanReferenceModel} from '../wanVideoModels.js';
import type {WanGenerationSettings} from '../videoGenerationSettings.js';

// Public list prices checked 2026-11-02. Discounts, balances and free quotas are
// deliberately excluded. USD conversion is a planning assumption, not a live FX quote.
const {textInput,imageInput,imageOutput,usdCny}=gptImage2EstimateRates,buffer=1.2;
const wanRates:Record<string,Record<string,number>>={
 'wan2.6-i2v-flash':{'720P':.15,'1080P':.25,'720P-audio':.3,'1080P-audio':.5},
 [wanReferenceModel]:{'720P-audio':.6,'1080P-audio':1},
 'wan2.6-i2v':{'720P-audio':.6,'1080P-audio':1},
 'wan2.5-i2v-preview':{'720P-audio':.6,'1080P-audio':1},
 'wan2.2-i2v-flash':{'720P':.2,'1080P':.48},
 'wan2.2-i2v-plus':{'1080P':.7},
 'wanx2.1-i2v-plus':{'720P':.7},
 'wanx2.1-i2v-turbo':{'720P':.24},
};
/** Matches the official GPT Image 2 output calculator (not the legacy token table).
 * The short-side grid uses ties-to-even rounding. Input tokens are separate. */
export function gptImage2OutputTokens(width:number,height:number,quality:'low'|'medium'|'high'){
 const longGrid={low:16,medium:48,high:96}[quality],shortExact=longGrid*Math.min(width,height)/Math.max(width,height),floor=Math.floor(shortExact);
 const shortGrid=shortExact-floor===.5?(floor%2===0?floor:floor+1):Math.round(shortExact);
 return Math.ceil(longGrid*shortGrid*(2000000+width*height)/4000000);
}
/** Local token budget, not a published GPT Image 2 tokenizer. */
export function imagePromptTokens(text:string){
 let ascii=0,cjk=0,other=0;const encoder=new TextEncoder();
 for(const character of text){
  if(character.codePointAt(0)!<=127)ascii++;
  else if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character))cjk++;
  else other+=Math.ceil(encoder.encode(character).length/2);
 }
 return Math.ceil(ascii/4+cjk*1.5+other);
}
/** Local high-fidelity allowance plus original pixel area; no undocumented resize. */
export function imageReferenceTokens(width:number,height:number){return 2048+Math.ceil(width*height/128);}
export function estimateWorkspaceCall(input:{kind:'image'|'video'|'speech'|'sound';provider:string;model?:string;seconds?:number;referenceVideoSeconds?:number;referenceVideoDurations?:readonly number[];videoImageCount?:number;text:string;settings?:{size:string;quality:string;count:number};referenceImages?:Array<{width:number;height:number}>;videoSettings?:WanGenerationSettings;videoResolution?:string;region?:'cn'|'international'}):WorkspaceCallEstimate{
 let yuan=0,minimumCents=input.kind==='sound'?0:1,basis='',sourceUrl='',conservative=false,imageInputs:WorkspaceCallEstimate['imageInputs'];
 if(input.kind==='sound')basis='Freesound 预览检索沿用 0 元费用预留。';
 else if(input.kind==='speech'){
  // Preserve the existing application floor; it is not the Provider's tariff.
  const characters=Array.from(input.text).length;minimumCents=Math.max(1,input.text.length);
  yuan=characters*3/10000;basis=`${characters} 字符 × 3 元/万字符；系统最低预留 ¥${(minimumCents/100).toFixed(2)}。`;sourceUrl='https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh';
 }else if(input.kind==='image'&&openAiEnhancedImageModels.some(model=>model===input.model)){
  const family=input.model?.startsWith('gpt-image-2.6-')?'2.6':'2.5';
  return {version:'workspace-cost/2026-11-08.image2x',estimatedCents:0,suggestedCents:1,minimumCents:1,maximumCents:100000,manualReservation:true,bufferPercent:0,conservative:true,basis:`GPT Image ${family} 的输出 token 不能用本平台现有 GPT Image 2 计算器估算，请手动填写本次费用预留。Standard 文本输入/图片输入/图片输出单价为 $5/$8/$30 每百万 token；实际用量以供应商返回为准。`,sourceUrl:`https://developers.openai.com/api/docs/models/gpt-image-${family}-sunburst`};
 }else if(input.kind==='image'){
  const s=input.settings!,[w,h]=s.size.split('x').map(Number),quality=s.quality==='auto'?'high':s.quality;
  if(!['low','medium','high'].includes(quality)||!(w>0&&h>0&&s.count>0))throw Error('Invalid image estimate inputs');
  const outputTokens=gptImage2OutputTokens(w,h,quality as 'low'|'medium'|'high');
  const textTokens=imagePromptTokens(input.text),references=(input.referenceImages??[]).map(r=>({...r,tokens:imageReferenceTokens(r.width,r.height)})),referenceTokens=references.reduce((sum,r)=>sum+r.tokens,0);
  // Direct Images API Standard rates. Text and reference input counts remain
  // local estimates; the measured dimensions and complete request are frozen.
  yuan=(outputTokens*imageOutput*s.count+referenceTokens*imageInput+textTokens*textInput)/1000000*usdCny;
  imageInputs={textCharacters:Array.from(input.text).length,textTokens,referenceTokens,references,outputTokensPerImage:outputTokens,quality:quality as 'low'|'medium'|'high'};
  const referenceBasis=references.length?references.map((r,i)=>`图 ${i+1} ${r.width}×${r.height} ≈${r.tokens} token`).join('；'):'无参考图';
  basis=`完整提示词 ${imageInputs.textCharacters} 字符 ≈${textTokens} 输入 token；${referenceBasis}（输入均为本地近似）。输出 ${s.count} 张 × ${outputTokens} token/张（官方计算器，${s.quality==='auto'?'自动质量按高质量':quality}）；文本/图片输入/输出单价 $${textInput}/$${imageInput}/$${imageOutput} 每百万 token，美元按 ${usdCny} 折算。`;
  sourceUrl='https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency';conservative=true;
 }else{
  const seconds=input.seconds!;if(!(Number.isFinite(seconds)&&seconds>0))throw Error('Invalid video estimate duration');
  if(input.provider==='bailian'){
   const s=input.videoSettings??defaultWanModelSettings(input.model!),rate=wanRates[input.model!]?.[s.resolution+(s.audio?'-audio':'')];
   if(input.model===wanReferenceModel&&rate!==undefined){
    const durations=input.referenceVideoDurations??[],count=durations.length+(input.videoImageCount??0);
    const clipLimit=[5,2.5,1.65,1.25,1][count-1]??0;
    const billable=durations.reduce((sum,duration)=>sum+Math.min(duration,clipLimit),0);
    yuan=(seconds+billable)*rate;
    basis=durations.length?`（输出 ${seconds} 秒 + 参考视频约 ${billable.toFixed(2)} 秒）× ¥${rate}/秒，参考时长按本期素材和计费上限估算。`:`${seconds} 秒 × ¥${rate}/秒，${s.resolution}，参考图片免费。`;
    sourceUrl='https://help.aliyun.com/zh/model-studio/video-to-video-guide';
    conservative=durations.length>0;
   }else if(rate!==undefined){yuan=seconds*rate;basis=`${seconds} 秒 × ¥${rate}/秒，${s.resolution}${s.audio?'有声':'无声'}，百炼北京原价。`;sourceUrl='https://help.aliyun.com/zh/model-studio/model-pricing';}
  }else if(input.provider==='volcengine'&&['doubao-seedance-2-0-260128','doubao-seedance-2-5-260628'].includes(input.model!)){
   const isSeedance2=input.model==='doubao-seedance-2-0-260128',referenceSeconds=input.referenceVideoSeconds??0;
   const rate=referenceSeconds>0?(isSeedance2?28:42):(isSeedance2?46:70);
   yuan=(seconds+referenceSeconds)*720*1280*24/1024/1000000*rate;
   basis=referenceSeconds>0
    ?`（参考视频约 ${referenceSeconds.toFixed(2)} 秒 + 输出 ${seconds} 秒）× 720 × 1280 × 24 ÷ 1024 × ¥${rate}/百万 token。参考时长取本期预览素材，平台另有最低用量。`
    :`${seconds} 秒，按 720P 参考像素、24 fps、¥${rate}/百万 token 估算；以实际返回 token 为准。`;
   sourceUrl='https://docs.volcengine.com/docs/ark/model-pricing?lang=zh';
  }else if(input.provider==='minimax'&&Object.hasOwn(minimaxVideoModels,input.model??'')){
   const domestic=input.region==='cn',referenceSeconds=input.referenceVideoSeconds??0,extraImages=Math.max(0,(input.videoImageCount??1)-5);
   const resolution=minimaxVideoResolution(input.model!,input.videoResolution??'768P'),profile=minimaxVideoModels[input.model!],secondsRate=(domestic?profile.cn:profile.international)[resolution],imageRate=domestic?profile.imageCn:profile.imageInternational,currency=domestic?'¥':'$';
   yuan=((seconds+referenceSeconds)*secondsRate+extraImages*imageRate)*(domestic?1:usdCny);
   const terms=[`输出 ${seconds} 秒 × ${currency}${secondsRate}/秒`];
   if(referenceSeconds>0)terms.push(`参考视频 ${referenceSeconds.toFixed(2)} 秒 × ${currency}${secondsRate}/秒`);
   if(extraImages>0)terms.push(`超出免费额度的 ${extraImages} 张图 × ${currency}${imageRate}/张`);
   basis=`${terms.join(' + ')}（${resolution}${domestic?'，国内站':`，美元按 ${usdCny} 折算`}）。`;
   sourceUrl=`https://platform.minimax.${domestic?'cn':'io'}/docs/pricing/overview`;
  }else if(input.provider==='kling'&&input.model==='kling-v3'){
   yuan=seconds*.084*usdCny;basis=`${seconds} 秒 × $0.084/秒，Kling 3.0 标准无声 720P，API 余额原价；美元按 7.2 折算。`;sourceUrl='https://kling.ai/dev/pricing';
  }
  if(!basis){yuan=seconds;basis=`${seconds} 秒 × ¥1/秒本地保守预留；当前通道或套餐价格未核实，请按需调整。`;conservative=true;}
 }
 return{version:'workspace-cost/2026-11-02.3',estimatedCents:Math.max(0,Math.ceil(yuan*100-1e-8)),suggestedCents:Math.max(minimumCents,Math.ceil(yuan*100*buffer-1e-8)),minimumCents,maximumCents:input.kind==='sound'?0:100000,basis,...(sourceUrl?{sourceUrl}:{}),conservative,bufferPercent:20,...(imageInputs?{imageInputs}:{})};
}
