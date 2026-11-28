// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {expect,it} from 'vitest';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';
import {executeWorkspaceDeliveryWorker} from '../worker/workspaceDeliveryWorker';
import {startHarnessProductionSocket} from './harnessProductionSocket';
import {inspectMediaRoot} from './mediaRootSettings';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

const context=process.env.LOOP_NATIVE_PREVIEW_CONTEXT;
const run=process.env.LOOP_NATIVE_PREVIEW_ROOT;
const sdk=process.env.LOOP_NATIVE_PREVIEW_SDK;
const title='隔离验收 · 桌面支架';
const script=`# ${title}

## 制作设置
- 模板版本：3
- 画幅：9:16
- 口播启用：关闭
- 字幕：关闭

## 正文
### 段落 01
- 口播：
- 画面来源：图片
- 画面提示：展示桌面支架的正面。
- 镜头时长（秒）：2
`;

it.skipIf(!context||!run||!sdk)('keeps a production-scoped fixture available to the isolated native Harness browser',async()=>{
 const runtime={mountPath:'',wake(episodeId:string){if(episodeId===episode)pending=true;}};
 let episode='',pending=false;
 const f=await nativeWorkspaceFixture({testContextModule:context,openChatCutRoot:sdk,testRootParent:run,runtime});
 let socket:Awaited<ReturnType<typeof startHarnessProductionSocket>>|undefined;
 try{
  const binding=await inspectMediaRoot(f.root);runtime.mountPath=binding.mountPath;
  await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  await f.start();
  const must=async(endpoint:string,command:string,data:Record<string,unknown>)=>{
   const result=await f.post(endpoint,command,data);expect(result.status,`${command}: ${JSON.stringify(result.body)}`).toBe(200);return result.body;
  };
  const account=await must('configuration','createAccount',{name:'隔离测试账号',slug:`preview-${randomUUID()}`,timezone:'Asia/Shanghai',policy:{}});
  const order=await must('episode-commands','create',{accountId:account.id,title});episode=order.id;
  const importMaterial=(sourcePath:string,materialType:'script'|'image',mimeType:string,content:Buffer)=>must('episode-commands','importMaterial',{
   episodeId:episode,sourceKind:'file',sourcePath,materialType,materialPurpose:materialType==='script'?'main_script':'visual_reference',
   mimeType,isMainScript:materialType==='script',contentBase64:content.toString('base64'),
  });
  await importMaterial('script.md','script','text/markdown',Buffer.from(script));
  await importMaterial('桌面支架参考图.png','image','image/png',await readFile(workspaceTestMedia('still-striped.png')));
  const location=await must('account-commands','readAssetDirectory',{accountId:account.id});
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO NOTHING');
  const worker=f.workerPool(),port=nativeWorkerPort(worker);
  const directory=join(run!,'rpc');await mkdir(directory,{mode:0o700});
  socket=await startHarnessProductionSocket({directory,ownerId:f.owner,episodeIds:[episode],pool:f.pool,handler:f.handler});
  await writeFile(join(run!,'ready.json'),JSON.stringify({directory,episode,title}),{mode:0o600,flag:'wx'});
  // This fixture executes only the formal local delivery task. It never runs a Provider.
  const until=Date.now()+60*60_000;
  while(Date.now()<until){
   if(await access(join(run!,'stop')).then(()=>true,()=>false))return;
   if(pending){
    pending=false;
    const taskId=(await f.c.query("SELECT t.id FROM public.tasks t WHERE t.episode_id=$1 AND t.task_type='prepare_publish_package' AND t.status='ready' ORDER BY t.created_at LIMIT 1",[episode])).rows[0]?.id;
    if(taskId){
     const task=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:2}))[0] as ClaimedTaskRow;
     expect(task?.task_type).toBe('prepare_publish_package');
     const result=await executeWorkspaceDeliveryWorker(worker,location.assetRoot,task);
     expect(result.status,JSON.stringify(result)).toBe('completed');
     await writeFile(join(run!,'delivery.json'),JSON.stringify({episode,taskId,artifacts:result.artifacts}),{mode:0o600});
    }
   }
   await delay(250);
  }
 }finally{await socket?.close();await f.close();}
},61*60_000);
