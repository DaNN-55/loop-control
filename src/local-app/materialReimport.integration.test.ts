// @vitest-environment node
import{it,expect}from'vitest';
import{readFile}from'node:fs/promises';
import{join}from'node:path';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{narrationFixture}from'./workspaceNarration.fixture';
import{workspaceTestMedia}from'./workspaceTestMedia.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('identical reference upload keeps the original revision and queued paid video valid; changed bytes still invalidate',async()=>{
 const f=await narrationFixture(undefined,undefined,true);
 try{
  await f.authorize();const w=f.made;
  const bytes=await readFile(workspaceTestMedia('still-striped.png'));
  const data={materialType:'image',sourceKind:'file',sourcePath:'shared-product.png',mimeType:'image/png',contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'visual_reference'};
  const first=await f.request('importMaterial',data);expect(first.status).toBe(200);
  const generated=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:first.body.id,prompt:'保持挂画原样，缓慢推进',durationSeconds:4,reservationCents:90});
  expect(generated.status,JSON.stringify(generated.body)).toBe(200);const taskId=generated.body.visualTasks[0].taskId;
  const repeated=await f.request('importMaterial',data);expect(repeated.status).toBe(200);
  expect(repeated.body.id).toBe(first.body.id);
  expect((await f.c.query('SELECT invalidated_at FROM public.tasks WHERE id=$1',[taskId])).rows[0].invalidated_at).toBeNull();
  expect((await f.execute(taskId))?.status).toBe('completed');
  const changedPath=join(f.root,'changed-reference.png');
  await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=320x480','-frames:v','1',changedPath]);
  const changed=await f.request('importMaterial',{...data,contentBase64:(await readFile(changedPath)).toString('base64')});
  expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.id).not.toBe(first.body.id);
  expect((await f.c.query('SELECT invalidated_at FROM public.tasks WHERE id=$1',[taskId])).rows[0].invalidated_at).not.toBeNull();
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('an invalidated unsent video does not prevent a new explicit request for the updated reference',async()=>{
 const f=await narrationFixture(undefined,undefined,true,false,['db/local/165-invalidated-unsent-video-requests.sql']);
 try{
  await f.authorize();const w=f.made;
  const data={materialType:'image',sourceKind:'file',sourcePath:'changed-product.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'};
  const first=await f.request('importMaterial',data);expect(first.status).toBe(200);
  const payload={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,prompt:'按当前产品缓慢推进',durationSeconds:4,reservationCents:90};
  const old=await f.chosenRequest('requestWorkspaceVisualCandidate',{...payload,firstFrameMaterialRevisionId:first.body.id});expect(old.status).toBe(200);
  const oldTask=old.body.visualTasks[0].taskId;
  const path=join(f.root,'new-reference.png');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x480','-frames:v','1',path]);
  const changed=await f.request('importMaterial',{...data,contentBase64:(await readFile(path)).toString('base64')});expect(changed.status).toBe(200);
  expect((await f.c.query('SELECT status,invalidated_at FROM public.tasks WHERE id=$1',[oldTask])).rows[0]).toMatchObject({status:'ready',invalidated_at:expect.any(Date)});
  const next=await f.chosenRequest('requestWorkspaceVisualCandidate',{...payload,firstFrameMaterialRevisionId:changed.body.id});expect(next.status,JSON.stringify(next.body)).toBe(200);
  const newTask=next.body.visualTasks.find((t:{taskId:string})=>t.taskId!==oldTask).taskId;
  expect((await f.execute(newTask))?.status).toBe('completed');
  expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations WHERE task_id=$1',[oldTask])).rows[0].n).toBe(0);
  expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);
