// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {nativeStorageContext} from './nativeStorage.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('backup and restore retain inactive invalidated submission history without weakening active or destructive-operation guards',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-readiness-history-'),source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex');await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});
 try{
  const {assertStorageUnoccupied}=await import(new URL('../../scripts/storage/occupied.mjs',import.meta.url).href),{createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href),runtime={...context,mediaRoot:f.root};
  await f.c.query("UPDATE public.tasks SET status='failed',completed_at=clock_timestamp(),lease_token=NULL WHERE id=$1",[f.task]);
  await f.c.query("INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES($1,'received')",[f.task]);
  const check=()=>assertStorageUnoccupied(source,f.root,[],runtime);
  await expect(check()).rejects.toThrow('Storage occupied');
  await f.c.query("UPDATE public.tasks SET invalidated_at=clock_timestamp(),invalidated_reason='Controlled superseded historical input',lease_token=$2 WHERE id=$1",[f.task,randomUUID()]);
  await expect(check()).rejects.toThrow('Storage occupied');
  await f.c.query('UPDATE public.tasks SET lease_token=NULL WHERE id=$1',[f.task]);
  await f.c.query('INSERT INTO local_identity.native_output_publications(task_id,attempt,lease_token) VALUES($1,0,$2)',[f.task,randomUUID()]);
  await expect(check()).rejects.toThrow('Storage occupied');
  await f.c.query('DELETE FROM local_identity.native_output_publications WHERE task_id=$1',[f.task]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status) VALUES($1,0,'{}','running')",[f.task]);
  await expect(check()).rejects.toThrow('Storage occupied');
  await f.c.query("UPDATE public.task_runs SET status='failed',completed_at=clock_timestamp() WHERE task_id=$1",[f.task]);
  const historySql=`SELECT jsonb_build_object('task',(SELECT to_jsonb(t) FROM public.tasks t WHERE id='${f.task}'),'submission',(SELECT to_jsonb(s) FROM local_identity.workspace_visual_submissions s WHERE task_id='${f.task}'),'runs',(SELECT jsonb_agg(r ORDER BY attempt) FROM public.task_runs r WHERE task_id='${f.task}'))`,before=context.sql(historySql,source);
  const jobId=randomUUID(),backupRoot=join(storage,'backups',source),backup=await createNativeBackup({database:source,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime);
  expect(backup.passed).toBe(true);
  const restored=await restoreNativeBackup({database:target,mediaRoot:join(storage,'state/t24-history/media'),archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},runtime);
  expect(restored.passed).toBe(true);expect(context.sql(historySql,target)).toBe(before);expect(context.sql(historySql,source)).toBe(before);
  const account=context.sql(`SELECT account_id FROM public.episodes WHERE id='${f.episode}'`,target),strict=`SET SESSION AUTHORIZATION loop_app;DO $$BEGIN PERFORM set_config('loop.owner_id','${f.owner}',false);END$$;SELECT local_identity.account_directory_busy('${account}'::uuid)`;
  expect(JSON.parse(context.sql(strict,target))).toContainEqual(expect.objectContaining({taskId:f.task}));
 }finally{if(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await rm(storage,{recursive:true,force:true});}
},300000);
