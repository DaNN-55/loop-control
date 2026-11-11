// @vitest-environment node
import {it,expect}from'vitest';
import {writeFile}from'node:fs/promises';
import {narrationFixture}from'../../../../src/local-app/workspaceNarration.fixture';
it('24 a completed replacement becomes the current narration task, retaining the unknown original only in history',async()=>{
 const f=await narrationFixture();try{
  const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [command,data]of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'独立替代投影验收。'}],['confirmWorkspaceNarration',base]]as const){const r=await f.request(command,data);expect(r.status,JSON.stringify(r.body)).toBe(200);}
  const old=await f.request('generateWorkspaceNarration',{...base,reservationCents:100});expect(old.status).toBe(200);const id=old.body.narration[0].taskId;
  await writeFile(f.responseMode,'unknown');expect((await f.execute(id,false))?.status).toBe('blocked');
  const fresh=await f.request('generateWorkspaceNarration',{...base,reservationCents:100,retry:true,retryOfTaskId:id});expect(fresh.status,JSON.stringify(fresh.body)).toBe(200);const next=fresh.body.narration[0].taskId;expect(next).not.toBe(id);
  await writeFile(f.responseMode,'success');expect((await f.execute(next))?.status).toBe('completed');
  const state=await f.read();expect(state.narration[0].taskId).toBe(next);expect(state.narration[0].status).toBe('completed');
  expect(state.narration[0].generationTask).toBeUndefined();
  expect((await f.c.query('SELECT outcome FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[id])).rows[0].outcome).toBe('started');
 }finally{await f.close();}
},120000);
