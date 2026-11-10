// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {cleanupRecoveryProcess} from './cleanupRecoveryProcess.fixture';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';
const enabled=process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE==='1';
async function get(f:Awaited<ReturnType<typeof embeddedStudioFixture>>,accountId:string,token=f.token){const r=await fetch(f.origin+'/api/local/account-deletion-status?accountId='+accountId,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};}
it.skipIf(!enabled)('counts all pages and archived orders, isolates Owners, and keeps actual delete rejection aligned',async()=>{
 const f=await embeddedStudioFixture({runtime:{mountPath:'/',wake(){}}});try{
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 for(let i=0;i<24;i++){const created=await f.post('episode-commands','create',{accountId:account,title:'关联生产单 '+i});expect(created.status,JSON.stringify(created.body)).toBe(200);}
 await f.c.query('UPDATE public.episodes SET archived_at=now() WHERE account_id=$1',[account]);
 const active=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) SELECT $1,episode_id,task_type,'running',input_snapshot FROM public.tasks WHERE id=$2",[active,f.task]);
 const before=await deletionFixtureFingerprint(f.assetRoot);
 const result=await get(f,account);expect(result).toEqual({status:200,body:{episodeCount:25,archivedEpisodeCount:25,creationCount:0,deletionCount:0,cleanupKey:null}});
 const list=await fetch(f.origin+'/api/local/catalog?view=episodes&accountId='+account+'&visibility=all&page=1&pageSize=10&seriesId=all&pendingPage=1&blockedPage=1',{headers:{Cookie:'loop_owner_session='+f.token}});const page=await list.json();expect(page.total).toBe(25);expect(page.episodes).toHaveLength(10);
 expect((await get(f,account,f.otherToken)).status).toBe(404);expect((await get(f,'invalid')).status).toBe(400);expect((await get(f,account+'&accountId='+account)).status).toBe(400);
 expect((await f.post('configuration','deleteAccount',{accountId:account,confirmation:'Studio153 fixture'})).status).toBe(409);expect(await deletionFixtureFingerprint(f.assetRoot)).toEqual(before);expect((await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[active])).rows[0].status).toBe('running');
 const empty=await f.post('configuration','createAccount',{name:'空账号核对',slug:'empty-'+randomUUID(),timezone:'UTC',policy:{}});expect(empty.status).toBe(200);expect((await get(f,empty.body.id)).body.episodeCount).toBe(0);expect((await f.post('configuration','deleteAccount',{accountId:empty.body.id,confirmation:'空账号核对'})).status).toBe(200);
 }finally{await f.close();}
},300000);
it.skipIf(!enabled).each(['link-before-unlink','before-finalize'] as const)('reports durable %s and links the exact recovery task after the process exits',async fault=>{
 const f=await embeddedStudioFixture({runtime:{mountPath:'/',wake(){}}});let worker:Awaited<ReturnType<typeof cleanupRecoveryProcess>>|undefined;try{
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;worker=await cleanupRecoveryProcess(f,fault);await worker.post('archiveEpisode',{episodeId:f.episode,archived:true});const plan=await worker.post('planDeletion',{episodeId:f.episode});expect(plan.status).toBe(200);const key=randomUUID(),exit=once(worker.child,'exit',{signal:AbortSignal.timeout(10000)});
 await worker.post('deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision},key).catch(()=>null);await exit;
 const status=await get(f,account);expect(status.status).toBe(200);expect(status.body).toMatchObject({episodeCount:fault==='before-finalize'?0:1,deletionCount:1,cleanupKey:key});
 expect((await f.post('configuration','deleteAccount',{accountId:account,confirmation:'Studio153 fixture'})).status).toBe(409);
 expect((await f.post('episode-lifecycle','retryDeletionCleanup',{deletionKey:key})).status).toBe(200);expect((await get(f,account)).body.deletionCount).toBe(0);
 }finally{await worker?.close();await f.close();}
},300000);
