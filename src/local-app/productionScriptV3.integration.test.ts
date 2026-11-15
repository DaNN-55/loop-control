// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a static v3 order rejects malformed structured imports and delivers without video fields or generation tasks',async()=>{
 const script=`# 纯静态制作\n\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n- 字幕：关闭\n\n## 正文\n### 段落 01\n- 口播：一束光，也可以成为一个镜头。\n- 画面来源：图片\n- 素材名称：light.png\n- 镜头时长（秒）：2\n`;
 const f=await formalWorkflowFixture({freshAccount:true,blank:true}),worker=f.workerPool();
 try{
  const bad=await f.send('importMaterial',{sourceKind:'file',sourcePath:'bad.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(script.replace('画面来源：图片','画面来源：未知')).toString('base64')});
  expect(bad.status,JSON.stringify(bad.body)).toBe(400);expect(bad.body.error).toContain('画面来源');
  expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].main_script_revision_id).toBeNull();
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'static.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(script).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  expect((await f.c.query('SELECT script_template_version FROM local_identity.input_episodes WHERE episode_id=$1',[f.newEpisode])).rows[0].script_template_version).toBe(3);
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  expect(w.preparation.shots).toEqual([{shotId:'shot-01',origin:'script-segment',visualSource:'image',materialReference:'light.png'}]);
  expect(w.readiness.placeholders).toHaveLength(1); // A named source is intent, not permission to choose an ambiguous file.
  const send=async(command:string,data:Record<string,unknown>)=>{
   const response=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(response.status,`${command}: ${JSON.stringify(response.body)}`).toBe(200);if(response.body.id===w.id)w=response.body;return response.body;
  };
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'light.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  expect(w.clips).toHaveLength(1);const clip=w.clips[0];
  await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});
  await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const opened=await send('openWorkspaceStudio',{});w=opened.productionWorkspace;const host=JSON.parse((await readFile(join(f.assetRoot,dirname(opened.workspace.relativePath),'workspace.json'))).toString());expect(host.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);await send('closeWorkspaceStudio',{});
  await send('exportWorkspace',{});const output=w.exports[0];expect(output.status,JSON.stringify(output)).toBe('ready');
  await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  await send('prepareWorkspaceDelivery',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256,title:'纯静态 v3',description:'没有视频生成字段。',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2})as any[])[0];expect(task.task_id).toBe(w.deliveries[0].taskId);
  const result=await runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath});expect(result.status,JSON.stringify(result)).toBe('completed');
  expect((await f.c.query('SELECT task_type FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows).toEqual([{task_type:'prepare_publish_package'}]);
  expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await worker.end();await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a restored invalid structured main script reports its line error and never creates a prose preparation',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,blank:true});
 try{
  const source='# 历史结构化脚本\n\n## 制作设置\n- 模板版本：3\n\n## 正文\n### 段落 01\n- 口播：保留原始内容。\n- 画面来源：无法识别\n';
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'restored-source.md',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/markdown',isMainScript:false,contentBase64:Buffer.from(source).toString('base64')});expect(imported.status).toBe(200);
  // A restored source may predate validation; retain its bytes and exercise the actual Owner prepare boundary.
  await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='script_approved' WHERE id=$1",[f.newEpisode,imported.body.id]);
  const response=await f.send('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});
  expect(response.status,JSON.stringify(response.body)).toBe(400);expect(response.body.error).toMatch(/第 \d+ 行.*画面来源/);
  expect((await f.c.query('SELECT count(*)::int n FROM public.review_packages WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},90000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['default','example']as const)('the current %s script imports as v3 and prepares without an old plan or implicit media generation',async kind=>{
 const {productionScriptTemplate}=await import('../reviews/productionScript'),{workspaceScriptExample}=await import('./workspaceScriptInput');
 const source=kind==='default'?productionScriptTemplate:workspaceScriptExample,f=await formalWorkflowFixture({freshAccount:true,blank:true});
 try{
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:kind+'.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(source).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  expect((await f.c.query('SELECT script_template_version FROM local_identity.input_episodes WHERE episode_id=$1',[f.newEpisode])).rows[0].script_template_version).toBe(3);
  expect((await f.send('start')).status).toBe(200);const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  expect(prepared.body.preparation.shots[0]).toMatchObject({shotId:'shot-01',visualSource:kind==='default'?'unassigned':'image'});
  expect(prepared.body.storyboardPackageId).toBeNull();expect(prepared.body.preparationRevisionId).toBeTruthy();
  for(const table of ['public.review_packages','public.shot_preparation_drafts','public.tasks','local_identity.script_productions'])expect((await f.c.query(`SELECT count(*)::int n FROM ${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n,table).toBe(0);
 }finally{await f.close();}
},120000);
