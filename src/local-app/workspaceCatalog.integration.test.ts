// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner catalog projects only current workspace export and delivery evidence',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);const w=made.body;
  const catalog=async(status='all',token=f.token)=>{const response=await fetch(f.origin+'/api/local/catalog?'+new URLSearchParams({view:'operations',q:f.episode,status}),{headers:{Cookie:'loop_owner_session='+token}});expect(response.status).toBe(200);return response.json();};
  await f.c.query("INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,last_result) VALUES($1,'generate_b_roll','failed','{}',$2)",[f.episode,{blockers:[{code:'UNUSED_CANDIDATE',detail:'Unadopted candidate failed.'}]}]);
  let view=await catalog();expect(view.operationRows).toEqual([expect.objectContaining({episodeId:f.episode,actionStatus:'running',workflowStep:'preparation',blockerCount:0,reviewPending:false})]);expect(view.blocked.total).toBe(0);
  const exportId=randomUUID();await f.c.query("INSERT INTO local_identity.workspace_exports(id,workspace_id,episode_id,project_content_version,content_sha256,project,status,artifact,checks,created_by) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,'[{\"passed\":true}]',$8)",[exportId,w.id,f.episode,w.revision,w.contentSha256,w.project,{relativePath:f.videoPath,sha256:f.files[0].sha256,fileSize:f.files[0].fileSize},f.owner]);
  view=await catalog('review');expect(view.total).toBe(1);expect(view.operationRows[0]).toMatchObject({actionStatus:'review',reviewPending:true,workflowStep:'delivery'});expect(view.pending.total).toBe(1);expect(view.pending.items[0].id).toBe(f.episode);
  expect((await catalog('review',f.otherToken)).episodes).toEqual([]);
  await f.c.query('UPDATE local_identity.workspace_exports SET confirmed_at=clock_timestamp(),confirmed_by=$2 WHERE id=$1',[exportId,f.owner]);
  const task=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,last_result) VALUES($1,$2,'prepare_publish_package','failed','{}',$3)",[task,f.episode,{blockers:[{code:'DELIVERY_FAILED',detail:'Controlled retryable delivery failure.'}]}]);
  await f.c.query('INSERT INTO local_identity.workspace_deliveries(id,workspace_id,episode_id,export_id,task_id) VALUES($1,$2,$3,$4,$1)',[task,w.id,f.episode,exportId]);
  view=await catalog('blocked');expect(view.operationRows[0]).toMatchObject({actionStatus:'blocked',workflowStep:'delivery',blockerCount:1});expect(view.blocked.items.map((x:{blocker:{code:string}})=>x.blocker.code)).toEqual(['DELIVERY_FAILED']);
  await f.c.query("UPDATE local_identity.production_workspaces SET revision=revision+1,content_sha256=repeat('b',64) WHERE id=$1",[w.id]);
  expect((await catalog('review')).total).toBe(0);expect((await catalog('blocked')).total).toBe(0);
 }finally{await f.close();}
},120000);
