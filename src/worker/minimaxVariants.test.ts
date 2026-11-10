// @vitest-environment node
import {it,expect} from 'vitest';
import {registeredAdapters} from './registeredAdapters';
import {officialVideoBody} from './officialVideoProvider';
import {officialVideoOperation} from '../local-app/officialVideoNetwork';
import {estimateWorkspaceCall} from '../local-app/workspaceCallEstimate';
for(const model of ['MiniMax-H3-Highspeed','MiniMax-H3-Lite'])for(const resolution of ['480P','768P'])for(const mode of ['first-frame','keyframes','references'])it(`${model} / ${resolution} / ${mode} preserves API settings through actual network admission`,()=>{
 const choice=registeredAdapters.productionChoices().find(c=>c.provider==='minimax')!;expect(choice.models).toContain(model);expect(choice.videoGenerationModes?.[model]?.map(m=>m.id)).toContain(mode);
 const frame={materialRevisionId:'first',mimeType:'image/png',image:Uint8Array.of(1)};
 const body=officialVideoBody({provider:'minimax',model,prompt:'动作',durationSeconds:4,resolution,referenceRatio:'9:16',...(mode==='first-frame'?{image:frame.image,imageMime:frame.mimeType}:{visualMode:mode,visualInputs:mode==='keyframes'?[{...frame,role:'firstFrame'},{...frame,materialRevisionId:'last',role:'lastFrame'}]:[{...frame,role:'referenceImages'}]})} as any);
 expect(body).toMatchObject({model,resolution,duration:4,ratio:model.endsWith('Lite')&&mode==='references'?'9:16':'adaptive'});
 expect(officialVideoOperation('minimax','execute',new URL('https://api.minimax.cn/v2/video_generation'),{method:'POST',body:JSON.stringify(body)})).toBe('generate');
});
it('new variant estimates use model and resolution, including input video and extra images',()=>{
 for(const [model,resolution,rate,imageRate] of [['MiniMax-H3-Highspeed','480P',.26,.2],['MiniMax-H3-Highspeed','768P',.4,.2],['MiniMax-H3-Lite','480P',.16,.13],['MiniMax-H3-Lite','768P',.26,.13]] as const){
  expect(estimateWorkspaceCall({kind:'video',provider:'minimax',model,videoResolution:resolution,region:'cn',text:'动作',seconds:4,referenceVideoSeconds:2,videoImageCount:6} as any).estimatedCents).toBe(Math.round((6*rate+imageRate)*100));
 }
});
