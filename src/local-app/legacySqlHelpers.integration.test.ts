// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('unused SQL routines are absent while nonempty budget history, current preparation and a full restore remain intact',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false)throw Error('Cleanup acceptance requires an isolated cluster');
 const restored='loop_cleanup_restore_'+randomBytes(6).toString('hex'),f=await productionWorkspaceFixture();let created=false;
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  await f.c.query("INSERT INTO public.generation_account_budgets(account_id,trial_video_limit_cents,total_limit_cents,full_generation_enabled,approved_by,approved_at) VALUES($1,25,75,false,$2,'2026-10-01T01:02:03.123456Z')",[account,f.owner]);
  const history=(await f.c.query('SELECT to_jsonb(b) value FROM public.generation_account_budgets b WHERE account_id=$1',[account])).rows[0].value;
  const read=(owner:string)=>ownerTransaction(f.pool,owner,true,c=>c.query('SELECT to_jsonb(b) value FROM public.generation_account_budgets b'));
  expect((await read(f.owner)).rows).toEqual([{value:history}]);expect((await read(f.other)).rows).toEqual([]);
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('UPDATE public.generation_account_budgets SET total_limit_cents=99 WHERE account_id=$1',[account]))).rejects.toMatchObject({code:'42501'});
  const cleanup=(await Promise.all(['202-remove-retired-manual-functions.sql','203-remove-unused-legacy-draft-writes.sql','204-remove-unreachable-legacy-residue.sql','205-remove-disconnected-workspace-wrappers.sql'].map(file=>readFile('db/current/'+file,'utf8')))).join('\n');
  const retired=[...cleanup.matchAll(/^DROP FUNCTION(?: IF EXISTS)? ([^;]+);/gm)].map(match=>match[1].replace(/ RESTRICT$/,''));
  expect(retired).toHaveLength(79);
  const removed=['public.set_generation_budget(uuid,integer,integer,boolean)','public.approval_gate_enabled(uuid,text)','public.auto_advance_disabled_approval_gate()','public.orchestrate_provided_script_tasks()','public.orchestrate_provided_script_tasks_for_episode(uuid)','public.orchestrate_embedded_audio_tasks(uuid)',...retired];
  for(const name of removed)expect((await f.c.query('SELECT to_regprocedure($1) value',[name])).rows[0].value).toBeNull();
  expect((await f.c.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='zz_auto_advance_disabled_approval_gate_after_task'")).rows[0].n).toBe(0);
  for(const name of ['public.orchestrate_review_render_tasks(uuid)','public.orchestrate_final_render_tasks(uuid)'])expect((await f.c.query('SELECT to_regprocedure($1) value',[name])).rows[0].value).toBeNull();
  const worker=f.workerPool();try{await expect(worker.query('SELECT * FROM local_identity.plan_input_tasks(NULL)')).rejects.toMatchObject({code:'42883'});}finally{await worker.end();}
  // The fixture is an original storyboard order; explicitly adopt that retained
  // source instead of treating its plain historical script as a fresh request.
  const board=JSON.parse(await readFile(join(f.assetRoot,f.boardPath),'utf8'));
  const scriptBefore=(await f.c.query('SELECT to_jsonb(r) value FROM public.production_material_revisions r WHERE id=$1',[f.script])).rows[0].value;
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  expect(prepared.body.clips.map((clip:{text:string})=>clip.text)).toEqual(board.shots.map((shot:{scriptSegment:string})=>shot.scriptSegment));
  expect((await f.c.query('SELECT to_jsonb(r) value FROM public.production_material_revisions r WHERE id=$1',[f.script])).rows[0].value).toEqual(scriptBefore);
  expect((await f.c.query('SELECT to_jsonb(b) value FROM public.generation_account_budgets b WHERE account_id=$1',[account])).rows[0].value).toEqual(history);
  const policies=(await f.c.query('SELECT to_jsonb(b) value FROM public.account_blueprint_versions b ORDER BY id')).rows;
  // Restore real SQL, rows and ACLs from the nonempty isolated source, not reconstructed summaries.
  const args=['-U','postgres','-d',f.database];
  const dump=context.execTool?context.execTool('pg_dump',args):context.docker(['exec',context.container,'pg_dump',...args]);
  context.sql('CREATE DATABASE '+restored+' TEMPLATE template0','postgres');created=true;context.sql(dump,restored);
  const budget=JSON.parse(context.sql(`SELECT to_jsonb(b) FROM public.generation_account_budgets b WHERE account_id='${account}'`,restored));expect(budget).toEqual(history);
  expect(JSON.parse(context.sql("SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(b)) ORDER BY id) FROM public.account_blueprint_versions b",restored))).toEqual(policies);
  for(const name of removed)expect(context.sql(`SELECT to_regprocedure('${name}') IS NULL`,restored)).toBe('t');
 }finally{if(created)context.sql('DROP DATABASE '+restored+' WITH (FORCE)','postgres');await f.close();}
},120000);
