// @vitest-environment node
// Current Owner HTTP and isolated PG/files; never loads the daily runtime.
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {csrfFor} from './sessions';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('immutable script reconfirmation preserves Owner, version, idle and idempotency fences after old shot revision removal',async()=>{
 const f=await formalWorkflowFixture();
 try{
  const old=(await f.c.query('SELECT * FROM public.production_material_revisions WHERE id=$1',[f.main])).rows[0],text=await readFile(join(f.assetRoot,old.storage_path),'utf8');
  const revision={expectedScriptRevisionId:old.id,text:text.replace(/^(- 口播[：:]).+$/m,'$1这是Owner修订并确认的完整口播。'),reason:'调整口播'};
  expect(revision.text).not.toBe(text);
  const request=async(data:Record<string,unknown>,idempotencyKey=randomUUID(),token=f.token,csrf=true)=>{
   const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command:'reconfirmScript',idempotencyKey,data:{episodeId:f.newEpisode,...data}})});
   return{status:response.status,body:await response.json()};
  };
  expect((await request(revision,randomUUID(),f.token,false)).status).toBe(403);
  expect((await request(revision,randomUUID(),f.otherToken)).status).toBe(404);
  expect((await request({...revision,expectedScriptRevisionId:randomUUID()})).status).toBe(409);
  expect((await request({...revision,text:''})).status).toBe(400);
  const task=randomUUID(),pack=randomUUID();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','running','{}')",[task,f.newEpisode]);
  await f.c.query("UPDATE public.episodes SET stage='qc_review' WHERE id=$1",[f.newEpisode]);
  expect((await request(revision)).status).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM public.production_material_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(1);
  await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[task]);
  await f.c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,context_snapshot) VALUES($1,$2,'qc_review',1,'{}')",[pack,f.newEpisode]);
  await f.c.query("INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at) VALUES($1,$2,$3,$4,'{}',true,$4,now())",[f.newEpisode,f.owner,old.id,old.sha256]);
  const key=randomUUID(),saved=await request(revision,key);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.id).not.toBe(old.id);expect(saved.body.revision_number).toBe(2);
  expect((await request(revision,key)).body.id).toBe(saved.body.id);
  expect((await request({...revision,text:revision.text+'变动'},key)).status).toBe(409);
  expect(await readFile(join(f.assetRoot,old.storage_path),'utf8')).toBe(text);expect(await readFile(join(f.assetRoot,saved.body.storage_path),'utf8')).toBe(revision.text);
  expect((await f.c.query('SELECT stage,main_script_revision_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0]).toEqual({stage:'waiting_input',main_script_revision_id:saved.body.id});
  expect((await f.c.query('SELECT enabled,authorized_at FROM local_identity.script_productions WHERE episode_id=$1',[f.newEpisode])).rows[0]).toEqual({enabled:false,authorized_at:null});
  expect((await f.c.query('SELECT invalidated_at FROM public.review_packages WHERE id=$1',[pack])).rows[0].invalidated_at).toBeTruthy();
  expect((await f.c.query('SELECT count(*)::int n FROM public.production_material_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(2);
  expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type='draft_storyboard_revision'",[f.newEpisode])).rows[0].n).toBe(0);
  await f.c.query('UPDATE public.episodes SET archived_at=now() WHERE id=$1',[f.newEpisode]);
  expect((await request({...revision,expectedScriptRevisionId:saved.body.id,text:revision.text+'追加'})).status).toBe(409);
 }finally{await f.close();}
},120000);
