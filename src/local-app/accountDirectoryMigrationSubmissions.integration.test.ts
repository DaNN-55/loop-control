// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {copyFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['reject','unknown'] as const)('real Worker %s outcome controls directory migration after restart without erasing the paid ledger',async mode=>{
 const holder=await mkdtemp('/private/tmp/loop-t08-submission-'),voice=join(holder,'original-voice.mp3');
 // Keep the original fixture's immutable input fingerprint exact. Only the
 // external Provider response is controlled; the HTTP/queue/Worker/DB are real.
 const f=await narrationFixture(undefined,base=>copyFileSync(join(base.assetRoot,`episodes/${base.episode}/voice.mp3`),voice),false,false,{voice,video:workspaceTestMedia('landscape-red-blue.mp4')});
 try{
 await f.authorize();expect((await f.request('setWanBudget',{trialCents:100,totalCents:1000,full:false})).status).toBe(200);
 let w=await f.read();const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='volcengine_tts'")).rows[0].id,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
 const saved=await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'明确拒绝与提交未知必须区分。',selection:{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:version},voice:'zh_female_vv_uranus_bigtts',speakingRate:1,languageCode:'zh-CN'});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
 expect((await f.request('confirmWorkspaceNarration',{...base,expectedRevision:w.revision})).status).toBe(200);
 const queued=await f.request('generateWorkspaceNarration',{...base,expectedRevision:w.revision,reservationCents:50});expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.narration[0].taskId;
 await writeFile(f.responseMode,mode);expect((await f.execute(task,false))?.status).toBe(mode==='reject'?'failed':'blocked');
 expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 const ledger=(await f.c.query('SELECT t.status,r.request_state,s.outcome FROM public.tasks t JOIN public.paid_generation_reservations r ON r.task_id=t.id JOIN local_identity.workspace_narration_submissions s ON s.task_id=t.id WHERE t.id=$1',[task])).rows[0];expect(ledger).toMatchObject({request_state:'submitting',outcome:mode==='reject'?'rejected':'started'});
 await f.restart();await f.restartWorker();const accountId=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,target=join(f.root,'submission-migration');await mkdir(target);
 const call=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{accountId,...data},idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 const planned=await call('planAssetDirectoryMigration',{path:target});expect(planned.status,JSON.stringify(planned.body)).toBe(200);
 if(mode==='unknown'){expect(planned.body.conflicts.join(' ')).toContain('供应商');expect((await call('executeAssetDirectoryMigration',{migrationId:planned.body.id})).status).toBe(409);expect((await call('readAssetDirectory')).body.assetRoot).toBe(f.assetRoot);}
 else{
 expect(planned.body.conflicts).toEqual([]);
 // A contradictory unknown record in another protocol must outweigh rejection.
 await f.c.query("INSERT INTO local_identity.workspace_visual_submissions(task_id,outcome) VALUES($1,'received')",[task]);
 const contradictory=await call('planAssetDirectoryMigration',{path:target});expect(contradictory.body.conflicts.join(' ')).toContain('供应商');expect((await call('executeAssetDirectoryMigration',{migrationId:contradictory.body.id})).status).toBe(409);await call('rollbackAssetDirectoryMigration',{migrationId:contradictory.body.id});
 await f.c.query('DELETE FROM local_identity.workspace_visual_submissions WHERE task_id=$1',[task]);
 const moved=await call('executeAssetDirectoryMigration',{migrationId:planned.body.id});expect(moved.status,JSON.stringify(moved.body)).toBe(200);expect(moved.body.status).toBe('completed');const file=f.files[0];expect(await readFile(join(target,file.relativePath))).toEqual(await readFile(join(f.assetRoot,file.relativePath)));
 expect((await f.c.query('SELECT request_state FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows[0].request_state).toBe('submitting');
 }
 }finally{await f.close();await rm(holder,{recursive:true,force:true});}
},300000);
