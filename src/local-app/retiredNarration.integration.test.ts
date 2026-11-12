// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {narrationFixture} from './workspaceNarration.fixture';
import {ownerTransaction} from './ownerTransaction';
import {nativeWorkerPort} from './workerDatabase';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retires old narration entrypoints and claims while keeping current voice files and historical records',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'当前制作口播完整保留。'})).status).toBe(200);
  expect((await f.request('confirmWorkspaceNarration',base)).status).toBe(200);
  const queued=await f.request('generateWorkspaceNarration',{...base,reservationCents:100});expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  const currentId=queued.body.narration[0].taskId;expect((await f.execute(currentId))?.status).toBe('completed');
  // A retained old ready record is evidence, never a new paid submission.
  const legacyId=randomUUID();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) SELECT $1::uuid,episode_id,task_type,'ready',(input_snapshot-'selectionVersion'-'native_output_namespace')||jsonb_build_object('native_tts_retry_id',$3::text),budget_limit_cents,max_attempts,provider,model,'narration-v1' FROM public.tasks WHERE id=$2",[legacyId,currentId,randomUUID()]);
  const rows=async()=>({tasks:(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows,audio:(await f.c.query('SELECT to_jsonb(t) value FROM public.audio_tracks t ORDER BY id')).rows,artifacts:(await f.c.query('SELECT to_jsonb(t) value FROM public.artifacts t ORDER BY id')).rows});
  const before=await rows(),audio=(await f.c.query('SELECT a.relative_path FROM public.artifacts a WHERE producer_task_id=$1 AND artifact_type=\'narration_audio\'',[currentId])).rows;
  expect(audio.length).toBeGreaterThan(0);const bytes=await Promise.all(audio.map(a=>readFile(join(f.assetRoot,a.relative_path))));
  const commands=[['local_identity.generate_input_shot_tts($1,$2,$3,false)',[f.episode,f.board,'shot-1']],['public.generate_shot_tts($1,$2,$3,false)',[f.episode,f.board,'shot-1']],['public.generate_confirmed_shot_tts_batch($1,$2)',[f.episode,f.board]]] as const;
  for(const [call,args]of commands){
   await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT '+call,[...args]))).rejects.toMatchObject({code:call.startsWith('local_identity.')?'0A000':'42501'});

   await expect(ownerTransaction(f.pool,f.other,false,c=>c.query('SELECT '+call,[...args]))).rejects.toMatchObject({code:'42501'});
  }
  for(const name of ['orchestrate_narration_tasks','orchestrate_narration_tasks_all','orchestrate_narration_tasks_configured','orchestrate_narration_tasks_without_connection_ref'])await expect(f.c.query(`SELECT * FROM public.${name}()`)).rejects.toMatchObject({code:'0A000'});
  const retired=await f.request('generateTts',{reviewPackageId:f.board,shotId:'shot-1'});expect(retired.status).toBe(410);
  expect((await f.request('generateTts',{reviewPackageId:f.board,shotId:'shot-1'},{token:f.otherToken})).status).toBe(404);
  expect((await f.c.query('SELECT local_identity.current_worker_task(t) allowed FROM public.tasks t WHERE id=$1',[legacyId])).rows[0].allowed).toBe(false);
  const worker=f.workerPool();try{expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:legacyId,p_worker_capacity:1})).toEqual([]);}finally{await worker.end();}
  expect(await rows()).toEqual(before);expect(await Promise.all(audio.map(a=>readFile(join(f.assetRoot,a.relative_path))))).toEqual(bytes);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);
