// @vitest-environment node
import {expect,it} from 'vitest';
import {narrationFixture} from './workspaceNarration.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('rejects an old valid batch adoption without changing the project and still permits explicit single-shot adoption',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const clip=w.clips[0];
  const send=async(command:string,data:Record<string,unknown>)=>{
   const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;
  };
  w=await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.narrationSettings,text:clip.text});
  w=await send('confirmWorkspaceNarration',{clipId:clip.id});
  w=await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:100});
  const task=w.narration.find((n:any)=>n.shotId===clip.shotId).taskId;await f.execute(task);w=await f.read();
  const candidate=w.candidates.find((c:any)=>c.shotId===clip.shotId);
  const plan=await send('prepareWorkspaceCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate'});
  const before=await f.read();
  const rejected=await f.request('adoptWorkspaceBatch',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,kind:'voice',items:[{candidateId:candidate.id,adoptionId:plan.adoptionId}]});
  expect(rejected.status,JSON.stringify(rejected.body)).toBe(400);
  const after=await f.read();expect(after.project.sha256).toBe(before.project.sha256);expect(after.revision).toBe(before.revision);expect(after.candidates).toEqual(before.candidates);expect(after.usedNarration).toEqual(before.usedNarration);
  w=await send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:plan.adoptionId});
  expect(w.usedNarration).toHaveLength(1);expect(w.usedNarration[0].shotId).toBe(clip.shotId);
 }finally{await f.close();}
});
