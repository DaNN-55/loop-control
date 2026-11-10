// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

it.skipIf(process.env.LOOP_SHOT_PROTOCOL_UPGRADE!=='1')('real 155 → 156 upgrade preserves an already submitted legacy task and creates canonical subsequent tasks',async()=>{
 const f=await narrationFixture(undefined,undefined,true);
 try{
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.schema_migrations WHERE version LIKE '156-%'")).rows[0].n).toBe(0);
  await f.authorize();let w=await f.read();
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'upgrade.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'}),mode=join(f.root,'upgrade-poll-mode'),module=join(f.root,'controlled-video.mjs');expect(image.status).toBe(200);
  await writeFile(mode,'fail');await writeFile(module,(await readFile(module,'utf8')).replace("if(host==='ark.cn-beijing.volces.com')return",`if(host==='ark.cn-beijing.volces.com'&&readFileSync(${JSON.stringify(mode)},'utf8')==='fail')throw Error('Controlled pre-upgrade poll interruption');if(host==='ark.cn-beijing.volces.com')return`));
  const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'升级前已经提交的镜头',durationSeconds:4,reservationCents:90};
  let r=await f.chosenRequest('requestWorkspaceVisualCandidate',args);expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const old=w.visualTasks[0];await f.execute(old.taskId,false);w=await f.read();expect(w.visualTasks[0].canResume).toBe(true);
  const before=(await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[old.taskId])).rows[0];expect(before.task_type).toBe('generate_b_roll');
  const sql=await readFile('db/local/156-unified-shot-video-protocol.sql','utf8');await f.c.query('BEGIN');await f.c.query(sql);await f.c.query('INSERT INTO local_identity.schema_migrations(version,sha256) VALUES($1,$2)',['156-unified-shot-video-protocol.sql',createHash('sha256').update(sql).digest('hex')]);await f.c.query('COMMIT');
  expect((await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[old.taskId])).rows[0]).toEqual(before);
  const blocked=await f.chosenRequest('requestWorkspaceVisualCandidate',{...args,prompt:'升级后也不能绕过未完成旧提交'});expect(blocked.status).toBe(409);
  r=await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:old.id});expect(r.status,JSON.stringify(r.body)).toBe(200);await writeFile(mode,'success');expect((await f.execute(old.taskId))?.status).toBe('completed');expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);
  expect((await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[old.taskId])).rows[0]).toEqual(before);
  w=await f.read();r=await f.chosenRequest('requestWorkspaceVisualCandidate',{...args,expectedRevision:w.revision,targetItemId:w.clips[1].itemId,prompt:'升级后统一镜头协议'});expect(r.status,JSON.stringify(r.body)).toBe(200);const current=r.body.visualTasks.find((t:any)=>t.taskId!==old.taskId),stored=(await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[current.taskId])).rows[0];expect(stored.task_type).toBe('generate_shot_video');expect(stored.input_snapshot.capability).toBe('shot_video_generation');expect(stored.input_snapshot.media.video).toBeTruthy();expect((await f.execute(current.taskId))?.status).toBe('completed');expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(2);
  await writeFile(join(process.env.LOOP_SECOND_BATCH_EVIDENCE!,'shot-protocol-upgrade-proof.json'),JSON.stringify({oldTaskType:before.task_type,oldFrozenSnapshotUnchanged:true,newTaskType:stored.task_type,newCapability:stored.input_snapshot.capability,outputTypes:stored.input_snapshot.output.required_artifact_types,legacyProviderPosts:1,totalProviderPosts:2,migrationSha256:createHash('sha256').update(sql).digest('hex'),paidCalls:0},null,2));
 }finally{await f.close();}
},120000);
