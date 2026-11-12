// @vitest-environment node
import{it,expect}from'vitest';
import{randomUUID}from'node:crypto';
import{productionWorkspaceFixture}from'./productionWorkspace.fixture';
import{ownerTransaction}from'./ownerTransaction';
import{runtimeQueueSql}from'./runtimeStatus';
import{readLocalCatalog,parseCatalogQuery}from'./catalog';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('completed unused unpaid audio failures stay in history while active, paid and publication work stays visible in both queue projections',async()=>{
 const f=await productionWorkspaceFixture();try{
 const w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const add=async(status='failed',type='generate_soundtrack',adopted:string|null=null)=>{const id=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,last_result,completed_at) VALUES($1,$2,$3,$4::public.task_status,'{}','{}',CASE WHEN $4::public.task_status='failed' THEN now() END)",[id,f.episode,type,status]);if(type==='generate_soundtrack')await f.c.query("INSERT INTO local_identity.workspace_audio_preparations(id,workspace_id,episode_id,kind,description,query,anchor,offset_seconds,duration_seconds,input_fingerprint,task_id,adopted_item_id) VALUES($1,$2,$3,'bgm','old failed search','no result','absolute',0,1,'fixture',$4,$5)",[randomUUID(),w.id,f.episode,id,adopted]);return id;};
 const original=await add(),snap=(await f.c.query('SELECT row_to_json(t) data FROM public.tasks t WHERE id=$1',[original])).rows[0].data;
 const queue=async()=>ownerTransaction(f.pool,f.owner,true,async c=>(await c.query(runtimeQueueSql,[f.owner,1])).rows[0].queue);
 const catalog=()=>readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams('view=operations')));
 expect((await queue()).failed).toBe(1);expect((await catalog()).worker.failed).toBe(1);
 await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
 expect(await queue()).toMatchObject({failed:0,total:0});expect((await catalog()).worker.failed).toBe(0);
 const cases=[await add('ready'),await add('running'),await add('blocked'),await add('failed','generate_soundtrack','still-used'),await add('failed','generate_narration')];
 const paid=await add();cases.push(paid);const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;await f.c.query("INSERT INTO public.paid_generation_reservations(task_id,account_id,kind,reserved_cents,request_state) VALUES($1,$2,'video',1,'submitting')",[paid,account]);
 const held=await add();cases.push(held);await f.c.query('INSERT INTO local_identity.native_output_publications(task_id,attempt,lease_token) VALUES($1,0,$2)',[held,randomUUID()]);
 const leased=await add();cases.push(leased);await f.c.query('UPDATE public.tasks SET lease_token=$2 WHERE id=$1',[leased,randomUUID()]);
 const activeRun=await add();cases.push(activeRun);await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status) VALUES($1,0,'{}','running')",[activeRun]);
 const unfinished=await add();cases.push(unfinished);await f.c.query('UPDATE public.tasks SET completed_at=NULL WHERE id=$1',[unfinished]);
 const q=await queue();expect(q.items.map((t:{id:string})=>t.id).sort()).toEqual(cases.sort());const c=await catalog();expect(c.worker).toMatchObject({running:q.running,failed:q.failed,blocked:q.blocked});
 expect((await f.c.query('SELECT row_to_json(t) data FROM public.tasks t WHERE id=$1',[original])).rows[0].data).toEqual(snap);
 }finally{await f.close();}
},120000);
