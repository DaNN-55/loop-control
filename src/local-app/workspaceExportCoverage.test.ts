// @vitest-environment node
import {it,expect,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands';
import {workspaceExportReadiness} from './workspaceExportCommands';

const timeline=(items:unknown[],id='main')=>({id,fps:30,width:360,height:640,items,tracks:{V1:{kind:'video'},A1:{kind:'audio'}},trackOrder:['V1','A1'],captionsHidden:false});
const solid=(startFrame:number,durationInFrames:number)=>({id:`solid-${startFrame}`,kind:'solid',track:'V1',startFrame,durationInFrames,props:{color:'#fff'}});
async function coverage(items:unknown[],children:unknown[]=[]){
 const project={activeTimelineId:'main',assets:[],timelines:[timeline(items),...children]} as unknown as OpenChatCutProject;
 const c={query:vi.fn(async()=>({rows:[]}))} as unknown as PoolClient;
 return (await workspaceExportReadiness(c,'/tmp',{id:'w',episode_id:'e',bindings:[]} as unknown as ProductionWorkspaceRecord,project)).checks.find(c=>c.name==='visual_coverage');
}
it('blocks the exact 3–5 second visual gap even when audio spans the full export',async()=>{
 const check=await coverage([solid(0,90),solid(150,150),{id:'music',kind:'audio',track:'A1',startFrame:0,durationInFrames:300}]);
 expect(check).toMatchObject({passed:false});expect(check?.detail).toContain('3.00–5.00');
});
it('accepts contiguous or overlapping visuals and explicit solid backgrounds',async()=>{
 expect(await coverage([solid(0,90),solid(90,210)])).toMatchObject({passed:true});
 expect(await coverage([solid(0,300),solid(150,150)])).toMatchObject({passed:true});
});
it('checks nested visible windows without counting out-of-window or audio-only content',async()=>{
 const child=timeline([solid(0,30),solid(60,30)],'child');
 expect(await coverage([{id:'seq',kind:'sequence',track:'V1',timelineId:'child',startFrame:0,durationInFrames:90}], [child])).toMatchObject({passed:false});
 expect(await coverage([{id:'seq',kind:'sequence',track:'V1',timelineId:'child',startFrame:0,durationInFrames:30,srcInFrame:60}], [child])).toMatchObject({passed:true});
});

it('audio tails and hidden visual layers cannot stand in for picture coverage',async()=>{
 expect(await coverage([solid(0,60),{id:'tail',kind:'audio',track:'A1',startFrame:0,durationInFrames:90}])).toMatchObject({passed:false,detail:expect.stringContaining('2.00–3.00')});
 expect(await coverage([{...solid(0,90),hidden:true}])).toMatchObject({passed:false});
});

it('blocks export of original audio retained from a replaced video on the same used shot',async()=>{
 const project={activeTimelineId:'main',assets:[{id:'original-audio',kind:'audio',src:'old.mp3',durationInFrames:150,loopControlAudioSource:{videoAssetId:'old-video'}}],timelines:[timeline([
  {id:'visual',kind:'video',track:'V1',sourceAssetId:'new-video',src:'new.mp4',startFrame:0,durationInFrames:150,loopControlShot:{shotId:'s1'}},
  {id:'workspace-source-shot-s1',kind:'audio',track:'A1',sourceAssetId:'original-audio',src:'old.mp3',startFrame:0,durationInFrames:150,volume:1,loopControlAudio:{shotId:'s1',sourceItemId:'visual'}}
 ])]} as unknown as OpenChatCutProject;
 const c={query:vi.fn(async()=>({rows:[]}))} as unknown as PoolClient;
 const row={id:'w',episode_id:'e',bindings:[{shotId:'s1',itemId:'visual'}]} as unknown as ProductionWorkspaceRecord;
 const check=(await workspaceExportReadiness(c,'/tmp',row,project)).checks.find(c=>c.name==='used_content');
 expect(check).toMatchObject({passed:false,detail:expect.stringContaining('重新接入当前视频原声')});
});

it('exports the native timeline without requiring old storyboard picture or caption bindings',async()=>{
 const project={activeTimelineId:'main',loopControl:{version:'four-step-workspace/v1',inputFingerprint:'initial',editorAuthority:'native'},assets:[],timelines:[{...timeline([
  {id:'shot-s1',kind:'text',track:'V1',startFrame:0,durationInFrames:90,props:{text:'我直接在剪辑台写的片尾'}},solid(120,30)
 ]),tracks:{V1:{kind:'video'},C1:{kind:'caption',captions:{enabled:true,sourceEntries:[{id:'manual',words:[{text:'手动校准',start:100,end:600}]}]}}},trackOrder:['V1','C1']}]} as unknown as OpenChatCutProject;
 const c={query:vi.fn(async()=>({rows:[]}))} as unknown as PoolClient;
 const row={id:'w',episode_id:'e',bindings:[{itemId:'shot-s1',shotId:'s1',source:null}]} as unknown as ProductionWorkspaceRecord;
 const checks=(await workspaceExportReadiness(c,'/tmp',row,project)).checks;
 expect(checks.every(check=>check.passed),JSON.stringify(checks)).toBe(true);
 expect(c.query).not.toHaveBeenCalled();
});
