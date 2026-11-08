// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {productionWorkspaceMigrations} from './productionWorkspace.fixture';
import {readLocalCatalog,parseCatalogQuery} from './catalog';

it('reads real Owner metrics, sorts before pagination, keeps unknowns last and exposes only page metrics',async()=>{
 const f=await nativeWorkspaceFixture({migrations:productionWorkspaceMigrations});
 try{
  const account=randomUUID(),otherAccount=randomUUID(),episodes:string[]=[];
  for(const [id,owner] of [[account,f.owner],[otherAccount,f.other]]){
   await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'统计验收','Asia/Shanghai')",[id,'metrics-'+id]);
   await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[id,owner]);
   await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy) VALUES($1,$1,1,'{}')",[id]);
  }
  for(let n=0;n<24;n++){
   const id=randomUUID(),aid=n===23?otherAccount:account;episodes.push(id);
   await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,created_at,updated_at) VALUES($1,$2,$2,$3,'script_approved','2026-11-02T00:00:00Z','2026-11-02T00:20:00Z')",[id,aid,'统计 '+n]);
   await f.c.query("INSERT INTO public.state_transitions(episode_id,from_stage,to_stage,reason,created_at) VALUES($1,'script_review','script_approved','test','2026-11-02T00:10:00Z')",[id]);
   if(n!==22)await f.c.query("INSERT INTO public.tasks(episode_id,task_type,provider,status,actual_cost_cents,claimed_at,completed_at) VALUES($1,'generate_b_roll','metrics_test','completed',$2,'2026-11-02T00:11:00Z','2026-11-02T00:12:00Z')",[id,(n+1)*10]);
  }
  const read=(sort:string,page='1',owner=f.owner)=>readLocalCatalog(f.pool,owner,parseCatalogQuery(new URLSearchParams({sort,page})));
  const desc=await read('cost_desc');expect(desc.total).toBe(23);expect(desc.episodes).toHaveLength(20);expect(desc.episodes[0].id).toBe(episodes[21]);
  expect(desc.metrics?.[episodes[21]].cost).toMatchObject({actualCents:220,estimatedCents:null,unpricedCount:0});
  expect(desc.metrics?.[episodes[21]].workerRunSeconds).toBe(60);
  expect(Object.keys(desc.metrics??{})).toHaveLength(20);expect(desc.metrics?.[episodes[23]]).toBeUndefined();
  const last=await read('cost_desc','2');expect(last.episodes.at(-1)?.id).toBe(episodes[22]);
  expect((await read('cost_asc')).episodes[0].id).toBe(episodes[0]);expect((await read('cost_asc','2')).episodes.at(-1)?.id).toBe(episodes[22]);
  const workbench=(catalogStage:string,status:string,page='1')=>readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams({view:'operations',accountId:account,catalogStage,status,page})));
  const preparation=await workbench('preparation','running','2');
  expect(preparation).toMatchObject({total:23,page:2,statusCounts:{all:23,running:23}});
  expect(preparation.operationRows.map(row=>row.workflowStep)).toEqual(['preparation','preparation','preparation']);
  expect(await workbench('delivery','running','2')).toMatchObject({episodes:[],total:0,page:1});
  const foreign=await read('cost_desc','1',f.other);expect(foreign.episodes.map(e=>e.id)).toEqual([episodes[23]]);expect(Object.keys(foreign.metrics??{})).toEqual([episodes[23]]);
 }finally{await f.close();}
},90000);
