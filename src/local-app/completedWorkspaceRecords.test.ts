import {expect,it} from 'vitest';
import {completedShotRecords} from './completedWorkspaceRecords';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
it('retains failed originals after retry and distinguishes a formerly adopted visual from the saved source',()=>{
 const w={clips:[{shotId:'S1',itemId:'a',source:{relativePath:'current.mp4',sha256:'current'}}],
  visualCandidates:[{id:'old',shotId:'S1',targetItemId:'a',kind:'video',status:'adopted',relativePath:'old.mp4',sha256:'old',taskId:'old-task'}],
  visualTasks:[{id:'failed',taskId:'failed-task',shotId:'S1',targetItemId:'a',kind:'video',status:'failed',error:'下载失败',retryTaskId:'retry'}],
 } as unknown as ProductionWorkspace;
 const project={assets:[],timelines:[{items:[{id:'a',kind:'video',src:'current.mp4',sourceContentHash:'current'}]}]} as unknown as OpenChatCutProject;
 const before=JSON.stringify(w),records=completedShotRecords(w,project,'S1');
 expect(records.find(r=>r.key==='visual:old')?.current).toBe(false);
 expect(records.find(r=>r.taskId==='failed-task')?.error).toBe('下载失败');
 expect(JSON.stringify(w)).toBe(before);
});
it('keeps two separate requests with identical output bytes and does not attach another shot narration',()=>{
 const w={clips:[{shotId:'S1',itemId:'a'}],candidates:[
  {id:'one',kind:'audio',shotId:'S1',taskId:'request-1',relativePath:'voice.mp3',sha256:'same'},
  {id:'two',kind:'audio',shotId:'S1',taskId:'request-2',relativePath:'voice.mp3',sha256:'same'},
  {id:'other',kind:'audio',shotId:'S2',taskId:'other-request',relativePath:'other.mp3',sha256:'other'},
 ]} as unknown as ProductionWorkspace;
 expect(completedShotRecords(w,null,'S1').map(r=>r.taskId)).toEqual(['request-1','request-2']);
});
