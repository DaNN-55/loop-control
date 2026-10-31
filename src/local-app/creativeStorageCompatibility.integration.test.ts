// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {collectionOwnerPost} from './episodeCollection.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner creative extensions remain creative data while actual indexed file dependencies still block a root plan',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations:['db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql']}),{f,target}=fixture;
 try{
  const runtime=await fixture.launch(),post=collectionOwnerPost({...f,origin:runtime.origin}),policy={positioning:'保留创作扩展',restrictions:'不得虚构事实',extension:{relativePath:'叙事/转折',src:'第一人称视角'}};
  const account=await post('configuration','createAccount',{name:'扩展规则账号',slug:'extension-'+randomUUID(),timezone:'Asia/Shanghai',policy});expect(account.status,JSON.stringify(account.body)).toBe(200);
  const series=await post('configuration','createSeries',{accountId:account.body.id,name:'继承规则',rules:{positioning:'系列偏好',restrictions:'额外限制',extension:{relativePath:'故事结构',src:'叙述方式'}}});expect(series.status).toBe(200);
  const episode=await post('episode-commands','create',{accountId:account.body.id,title:'扩展规则冻结单',seriesVersionId:series.body.id});expect(episode.status,JSON.stringify(episode.body)).toBe(200);
  const legacyOnly=await post('account-commands','planAssetDirectoryMigration',{accountId:account.body.id,path:target});expect(legacyOnly.status).toBe(409);expect(legacyOnly.body.error).toContain('已登记生产单');
  const send=async(command:string,data:Record<string,unknown>={})=>{const result=await post('episode-commands',command,{episodeId:episode.body.id,...data});expect(result.status,JSON.stringify(result.body)).toBe(200);return result.body;};
  const harness=await post('configuration','createPromptVersion',{accountId:account.body.id,capability:'storyboard_planning',name:'扩展规则规划',summary:'受控验收',instructions:'Preserve every creative rule.'});expect(harness.status).toBe(200);
  await send('saveWorkspacePlanningSelection',{selection:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harnessId:harness.body.id,budgetCents:0,allowedTools:['read','write']},expectedSelectionRevision:0});
  const script=await send('importMaterial',{sourceKind:'paste',sourcePath:'script.txt',materialType:'script',materialPurpose:'main_script',mimeType:'text/plain',isMainScript:true,contentBase64:Buffer.from('# Creative extension\n\n## 正文\n真实 Owner 规划保留未知创作扩展。').toString('base64')});
  await send('importMaterial',{sourceKind:'file',sourcePath:'reference.mp4',materialType:'video',materialPurpose:'visual_reference',mimeType:'video/mp4',isMainScript:false,contentBase64:(await readFile(join(f.assetRoot,f.videoPath))).toString('base64')});
  await send('start');await send('prepareWorkspace',{expectedScriptRevisionId:script.id});
  // The scheduler adds its existing resource limits after task creation.
  // Capture the full snapshot after that normal enrichment, before planning.
  await expect.poll(async()=>(await f.c.query("SELECT input_snapshot#>'{runtime_constraints,resource_limits}' limits FROM public.tasks WHERE episode_id=$1 AND task_type='draft_storyboard'",[episode.body.id])).rows[0]?.limits,{timeout:10000}).toEqual(expect.any(Array));
  const task=(await f.c.query("SELECT input_snapshot FROM public.tasks WHERE episode_id=$1 AND task_type='draft_storyboard'",[episode.body.id])).rows[0];expect(task.input_snapshot.prompt_context.account_defaults).toEqual(policy);expect(task.input_snapshot.prompt_context.account_hard_constraints.restrictions).toBe(policy.restrictions);expect(task.input_snapshot.prompt_context.series_baseline.rules).toEqual(series.body.rules);
  const frozen=(await f.c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[episode.body.id])).rows[0].policy;expect(frozen).toEqual(policy);
  const plan=async()=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})});expect(r.status,await r.clone().text()).toBe(200);return r.json();};
  const valid=await plan();expect(valid.manifest.conflicts).toEqual([]);expect(valid.manifest.blockers.every((b:{kind:string})=>b.kind==='production')).toBe(true);
  expect((await f.c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[episode.body.id])).rows[0].policy).toEqual(policy);
  expect((await f.c.query("SELECT input_snapshot FROM public.tasks WHERE episode_id=$1 AND task_type='draft_storyboard'",[episode.body.id])).rows[0].input_snapshot).toEqual(task.input_snapshot);
  const path=join(f.assetRoot,f.videoPath),before=await readFile(path);await writeFile(path,Buffer.alloc(before.length));
  const invalid=await plan();expect(invalid.manifest.canExecute).toBe(false);expect(invalid.manifest.conflicts.join()).toContain(f.videoPath);await writeFile(path,before);
 }finally{await fixture.close();}
},90000);
