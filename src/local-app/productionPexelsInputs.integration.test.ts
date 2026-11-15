// @vitest-environment node
import {expect,it} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspacePexelsFixture} from './workspacePexels.fixture';
import {readFile} from 'node:fs/promises';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('independent Pexels search and preview freeze the canonical shot basis, import explicitly and leave legacy records untouched',async()=>{
 const f=await formalWorkflowFixture({controlled:true,videoConfiguration:false,freshAccount:true,scriptText:'# 当前检索\n\n## 正文\n\n第一镜寻找海面。\n\n第二镜保留原画面。'});
 try{
  const p=await workspacePexelsFixture(undefined,[],f.controlled!);expect((await f.send('start')).status).toBe(200);
  const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  const send=async(command:string,data:Record<string,unknown>)=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  const read=async()=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);w=(await r.json()).workspace;};
  const original=w.project.sha256,shot=w.clips[0].shotId;
  await send('searchWorkspacePexelsVideos',{targetItemId:w.clips[0].itemId,selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:p.version},query:'ocean'});
  const search=w.pexels.requests[0],reference={version:'production-preparation-ref/v1',workspace_id:w.id,preparation_revision_id:w.preparationRevisionId,script_revision_id:f.main,shot_id:shot};
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[search.taskId])).rows[0].input_snapshot;expect(snapshot.production_preparation).toEqual(reference);expect(snapshot).not.toHaveProperty('storyboard_review_package_id');expect(snapshot.workspace_target).toMatchObject({workspaceId:w.id,preparationRevisionId:w.preparationRevisionId,shotId:shot});
  expect((await p.execute(search.taskId)).status).toBe('completed');await read();expect(w.pexels.requests[0].results.map((x:any)=>x.id)).toEqual([11,22]);
  await send('previewWorkspacePexelsVideo',{searchId:search.id,resultId:22});const preview=w.pexels.requests[0];expect((await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[preview.taskId])).rows[0].input_snapshot.production_preparation).toEqual(reference);
  expect((await p.execute(preview.taskId)).status).toBe('completed');await read();await send('importWorkspacePexelsVideo',{previewId:preview.id});expect(w.visualCandidates).toHaveLength(1);expect(w.visualCandidates[0].source.id).toBe(22);expect(w.project.sha256).toBe(original);
  const decision=await f.send('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:w.visualCandidates[0].id,durationPolicy:'use-candidate',acceptTimelineImpact:true});expect(decision.status,JSON.stringify(decision.body)).toBe(200);
  await send('adoptWorkspaceVisualCandidate',{candidateId:w.visualCandidates[0].id,adoptionId:decision.body.adoptionId});expect(w.visualCandidates[0].status).toBe('adopted');
  for(const table of ['review_packages','shot_preparation_drafts','approvals'])expect((await f.c.query(`SELECT count(*)::int n FROM public.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['other-shot','missing-reference','future-version','wrong-request','wrong-target'] as const)('Pexels stops before transport when the frozen preparation has %s',async change=>{
 const f=await formalWorkflowFixture({controlled:true,videoConfiguration:false,freshAccount:true,scriptText:'# 当前检索\n\n## 正文\n\n第一镜寻找海面。\n\n第二镜保留原画面。'});
 try{
  const p=await workspacePexelsFixture(undefined,[],f.controlled!);expect((await f.send('start')).status).toBe(200);let response=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(response.status).toBe(200);let w=response.body;
  response=await f.send('searchWorkspacePexelsVideos',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:p.version},query:'ocean'});expect(response.status).toBe(200);w=response.body;
  const id=w.pexels.requests[0].taskId,snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0].input_snapshot;
  if(change==='other-shot')snapshot.production_preparation.shot_id=w.clips[1].shotId;
  else if(change==='missing-reference')delete snapshot.production_preparation;
  else if(change==='future-version')snapshot.production_preparation.version='production-preparation-ref/v999';
  else if(change==='wrong-target')snapshot.workspace_target.targetItemId=w.clips[1].itemId;
  else snapshot.workspace_pexels_request_id=w.id;
  await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[id,snapshot]);
  expect((await p.execute(id,false)).status).toBe('failed');await expect(readFile(p.calls,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  expect((await f.c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].project_sha256).toBe(w.project.sha256);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['future-protocol','wrong-target'] as const)('Pexels refuses an unknown legacy Pexels contract: %s',async change=>{
 const f=await workspacePexelsFixture();try{
  let w=await f.read();const r=await f.request('searchWorkspacePexelsVideos',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:f.version},query:'recorded input'});expect(r.status).toBe(200);w=r.body;const job=w.pexels.requests[0];
  await f.c.query("UPDATE local_identity.workspace_pexels_requests SET request_snapshot=request_snapshot #- '{target,preparationRevisionId}' #- '{target,workspaceId}' WHERE id=$1",[job.id]);
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[job.taskId])).rows[0].input_snapshot;delete snapshot.production_preparation;delete snapshot.workspace_target.preparationRevisionId;delete snapshot.workspace_target.workspaceId;
  if(change==='wrong-target')snapshot.workspace_target.targetItemId=w.clips[1].itemId;
  await f.c.query('UPDATE public.tasks SET input_snapshot=$2,prompt_version=$3 WHERE id=$1',[job.taskId,snapshot,change==='future-protocol'?'workspace-pexels-v999':'workspace-pexels-v1']);
  expect((await f.execute(job.taskId,false)).status).toBe('failed');await expect(readFile(f.calls,'utf8')).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a recorded legacy Pexels search executes through its original basis without rewriting its frozen snapshot',async()=>{
 const f=await workspacePexelsFixture();try{
  let w=await f.read();const r=await f.request('searchWorkspacePexelsVideos',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:f.version},query:'recorded ocean'});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const job=w.pexels.requests[0];
  // Reconstruct the pre-192 frozen protocol only in this owned historical fixture.
  await f.c.query("UPDATE local_identity.workspace_pexels_requests SET request_snapshot=request_snapshot #- '{target,preparationRevisionId}' #- '{target,workspaceId}' WHERE id=$1",[job.id]);
  await f.c.query("UPDATE public.tasks SET input_snapshot=(input_snapshot-'production_preparation') #- '{workspace_target,preparationRevisionId}' #- '{workspace_target,workspaceId}' WHERE id=$1",[job.taskId]);
  const frozen=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[job.taskId])).rows[0].input_snapshot;
  expect((await f.execute(job.taskId)).status).toBe('completed');w=await f.read();expect(w.pexels.requests[0].results).toHaveLength(2);
  const preview=await f.request('previewWorkspacePexelsVideo',{workspaceId:w.id,expectedRevision:w.revision,searchId:job.id,resultId:22});expect(preview.status,JSON.stringify(preview.body)).toBe(200);
  const previewTask=preview.body.pexels.requests.find((r:any)=>r.operation==='preview').taskId;expect((await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[previewTask])).rows[0].input_snapshot.production_preparation).toMatchObject({version:'production-preparation-ref/v1',preparation_revision_id:w.preparationRevisionId});expect((await f.execute(previewTask)).status).toBe('completed');
  const after=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[job.taskId])).rows[0].input_snapshot;delete frozen.runtime_constraints;delete after.runtime_constraints;expect(after).toEqual(frozen);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a new Pexels task cannot discard its reference and pretend to be legacy on an imported workspace',async()=>{
 const f=await workspacePexelsFixture();try{
  let w=await f.read();const r=await f.request('searchWorkspacePexelsVideos',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:f.version},query:'new request on imported workspace'});expect(r.status).toBe(200);w=r.body;const id=w.pexels.requests[0].taskId;
  await f.c.query("UPDATE public.tasks SET input_snapshot=(input_snapshot-'production_preparation')||jsonb_build_object('storyboard_review_package_id',$2::text) WHERE id=$1",[id,f.board]);
  expect((await f.execute(id,false)).status).toBe('failed');await expect(readFile(f.calls,'utf8')).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.close();}
},120000);
