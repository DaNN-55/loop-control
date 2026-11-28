// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {executeWorkspaceDeliveryWorker} from '../worker/workspaceDeliveryWorker';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';
import {nativeWorkerPort} from './workerDatabase';
import {cp,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {LocalHarnessHandoff} from './harnessHandoff';
import {inspectMediaRoot} from './mediaRootSettings';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {csrfFor} from './sessions';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

const context=process.env.LOOP_HANDOFF_TEST_CONTEXT;
const golden=process.env.LOOP_HANDOFF_GOLDEN_PACKAGE;
const staticV3=`# 桌面支架细节

## 制作设置
- 模板版本：3
- 画幅：9:16
- 口播启用：关闭
- 字幕：关闭

## 正文
### 段落 01
- 口播：
- 画面来源：图片
- 素材名称：front.png
- 镜头时长（秒）：2
`;

it.skipIf(!context)('receives the v3 package over Owner HTTP and replays one Episode, keeping a changed revision separate',async()=>{
 let root='';
 const runtime={mountPath:'',wake(){}};
 const f=await nativeWorkspaceFixture({testContextModule:context,migrations:['db/current/236-harness-handoff.sql'],
  onSetup:async p=>{if(p.stage==='directory'){root=join(p.root!,'handoff');await mkdir(root,{mode:0o700});}},
  runtime,createHandoff:options=>new LocalHarnessHandoff({...options,root}),
 });
 try{
  const binding=await inspectMediaRoot(f.root);runtime.mountPath=binding.mountPath;
  await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  const origin=await f.start(),endpoint=origin+'/api/local/harness-handoff';
  const account=await f.post('configuration','createAccount',{name:'交接测试',slug:`handoff-${randomUUID()}`,timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const get=async(token:string|null=f.token)=>{
   const r=await fetch(endpoint,{headers:token?{Cookie:'loop_owner_session='+token}:{}});
   return {status:r.status,body:await r.json()};
  };
  const accept=async(data:Record<string,unknown>,token=f.token,csrf=true)=>{
   const r=await fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify(data)});
   return {status:r.status,body:await r.json()};
  };
  const manifest=golden?JSON.parse(await readFile(join(golden,'manifest.json'),'utf8')):{schema:'loop-control-handoff/v1',handoff_id:'demo-stand-sg-001',revision:1,product_id:'P01',title:'桌面支架细节',product_images:['images/front.png']};
  const id=manifest.handoff_id,inbox=join(root,'in',id),publish=async (revision:number)=>{
   const version=`v${String(revision).padStart(4,'0')}`,temp=join(inbox,'tmp-'+version),dir=join(inbox,version);
   if(golden)await cp(golden,temp,{recursive:true});
   else{await mkdir(join(temp,'images'),{recursive:true,mode:0o700});await cp(workspaceTestMedia('still-striped.png'),join(temp,'images/front.png'));await writeFile(join(temp,'script.md'),staticV3);}
   if(!golden||revision!==manifest.revision)await writeFile(join(temp,'manifest.json'),JSON.stringify({...manifest,revision,...(revision===manifest.revision?{}:{title:manifest.title+' 新修订'})}));
   if(revision===manifest.revision)expect(await get()).toEqual({status:200,body:{enabled:true,items:[]}});
   await rename(temp,dir);return dir;
  };
  const readResult=async(rev:number)=>JSON.parse(await readFile(join(root,'out',id,`v${String(rev).padStart(4,'0')}`,'result.json'),'utf8'));
  await mkdir(inbox,{recursive:true,mode:0o700});
  const first=await publish(manifest.revision);
  expect((await get(null)).status).toBe(401);
  expect(await get(f.otherToken)).toEqual({status:200,body:{enabled:false,items:[]}});
  const listed=await get(),[item]=listed.body.items;
  expect(listed.status,JSON.stringify(listed.body)).toBe(200);
  expect(item).toMatchObject({handoffId:id,revision:manifest.revision,status:'received',canAccept:true,episodeId:null,aspectRatio:'9:16',digest:expect.stringMatching(/^[a-f0-9]{64}$/)});
  const payload={handoffId:id,revision:item.revision,accountId:account.body.id,expectedDigest:item.digest};
  expect((await accept(payload,f.otherToken)).status).toBe(404);
  expect((await accept(payload,f.token,false)).status).toBe(403);
  const [a,b]=await Promise.all([accept(payload),accept(payload)]);
  expect(a.status,JSON.stringify(a.body)).toBe(200);expect(b).toEqual(a);
  const episodeId=a.body.episodeId;
  expect(episodeId).toMatch(/^[a-f0-9-]{36}$/);
  expect(await accept(payload)).toEqual(a);
  const afterAccept=await get();
  expect(afterAccept.body.items).toMatchObject([{episodeId,status:'received',canAccept:false}]);
  expect(await readResult(item.revision)).toMatchObject({status:'received',production_order:{id:episodeId},outputs:{}});
  const episodes=await f.c.query('SELECT e.id,e.main_script_revision_id,i.script_template_version FROM public.episodes e JOIN local_identity.input_episodes i ON i.episode_id=e.id WHERE e.account_id=$1',[account.body.id]);
  expect(episodes.rows).toEqual([{id:episodeId,main_script_revision_id:expect.any(String),script_template_version:3}]);
  expect((await f.c.query('SELECT count(*)::int AS n FROM public.tasks WHERE episode_id=$1',[episodeId])).rows[0].n).toBe(0);
  await f.restart();expect(await accept(payload)).toEqual(a);
  const started=await f.post('episode-commands','start',{episodeId});
  expect(started.status,JSON.stringify(started.body)).toBe(200);
  expect((await get()).body.items).toMatchObject([{episodeId,status:'producing'}]);
  expect(await readResult(item.revision)).toMatchObject({status:'producing',production_order:{id:episodeId},outputs:{}});
  const originalScript=await readFile(join(first,'script.md'),'utf8');
  await writeFile(join(first,'script.md'),originalScript+'\n');
  expect((await accept(payload)).status).toBe(409);
  expect((await get()).body.items).toMatchObject([{episodeId,status:'needs_attention',canAccept:false}]);
  expect(await readResult(item.revision)).toMatchObject({status:'needs_attention',reason_code:'revision_conflict',production_order:{id:episodeId}});
  await writeFile(join(first,'script.md'),originalScript);
  const nextRevision=item.revision+1;
  await publish(nextRevision);
  expect((await get()).body.items.find((x:{revision:number})=>x.revision===nextRevision)).toMatchObject({status:'needs_attention',canAccept:true,episodeId:null});
  expect(await readResult(nextRevision)).toMatchObject({status:'needs_attention',production_order:null});
  expect((await f.c.query('SELECT count(*)::int AS n FROM public.episodes WHERE account_id=$1',[account.body.id])).rows[0].n).toBe(1);
  if(!process.env.LOOP_TEST_OPENCHATCUT_ROOT)return;
  const send=(command:string,data:Record<string,unknown>={})=>f.post('episode-commands',command,{episodeId,...data});
  const prepared=await send('prepareWorkspace',{expectedScriptRevisionId:episodes.rows[0].main_script_revision_id});
  expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  const change=async(command:string,data:Record<string,unknown>={})=>{
   const next=await send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(next.status,`${command}: ${JSON.stringify(next.body)}`).toBe(200);w=next.body;
  };
  const material=(await f.c.query("SELECT id FROM public.production_material_revisions WHERE episode_id=$1 AND mime_type='image/png'",[episodeId])).rows;
  expect(material).toHaveLength(1);
  for(const [index,clip] of (w.clips as {id:string}[]).entries())await change('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:material[0].id,usage:'still',durationSeconds:index===0?2:3,fit:'contain',focusX:0,focusY:0});
  await change('exportWorkspace');
  const approved=w.exports[0];expect(approved.status,JSON.stringify(approved)).toBe('ready');
  await get();expect(await readResult(item.revision)).toMatchObject({status:'producing',outputs:{}});
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO NOTHING');
  await change('completeWorkspaceExport',{exportId:approved.id,expectedExportSha256:approved.artifact.sha256,expectedContentSha256:w.contentSha256});
  await get();expect(await readResult(item.revision)).toMatchObject({status:'producing',outputs:{}});
  const port=nativeWorkerPort(f.workerPool()),task=(await port.rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2}))[0] as ClaimedTaskRow;
  expect(task.task_type).toBe('prepare_publish_package');
  const location=await f.post('account-commands','readAssetDirectory',{accountId:account.body.id});
  expect(location.status,JSON.stringify(location.body)).toBe(200);
  const completed=await executeWorkspaceDeliveryWorker(f.workerPool(),location.body.assetRoot,task);
  expect(completed.status,JSON.stringify(completed)).toBe('completed');
  expect((await get()).body.items.find((x:{revision:number})=>x.revision===item.revision)).toMatchObject({episodeId,status:'delivered'});
  const delivered=await readResult(item.revision),video=join(root,'out',id,`v${String(item.revision).padStart(4,'0')}`,'exports','final.mp4');
  const bytes=await readFile(video),hash=createHash('sha256').update(bytes).digest('hex');
  expect(hash).toBe(approved.artifact.sha256);
  expect(delivered).toMatchObject({status:'delivered',production_order:{id:episodeId},outputs:{video:'exports/final.mp4',video_sha256:hash,video_file_size:bytes.length}});
  execFileSync('ffmpeg',['-v','error','-xerror','-i',video,'-f','null','-']);
  const durationSeconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',video],{encoding:'utf8'}));
  expect(Math.abs(durationSeconds-(w.clips.length===1?2:5))).toBeLessThan(0.15);
  await f.restart();await get();expect(await readResult(item.revision)).toEqual(delivered);
  console.info('Verified isolated handoff delivery',JSON.stringify({handoffId:id,revision:item.revision,episodeId,sha256:hash,fileSize:bytes.length,durationSeconds}));
 }finally{await f.close();}
},120000);
