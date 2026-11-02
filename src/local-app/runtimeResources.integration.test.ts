// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,statfs,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
import {createRuntimeStatusReader} from './runtimeStatus';
import {createLocalHandler} from './localRoute';

it.skipIf(process.env.LOOP_RUNTIME_RESOURCES_ACCEPTANCE!=='1')('Owner HTTP reports distinct and shared volume sources, preserves unknown versions, and recovers after the isolated media volume returns',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Explicit isolated context required');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE),context=runtimeContext();context.assertDatabase();if(context.dailyRuntime!==false)throw Error('Daily runtime forbidden');
 const f=await nativeWorkspaceFixture(),volume=await workspaceAudioVolume();let server:ReturnType<typeof createServer>|undefined;
 try{
  const mediaRoot=join(volume.mountPath,'制作素材盘很长的中文名称用于验证真实路径换行而不遮挡可用空间'.repeat(2));await mkdir(mediaRoot);
  const account=randomUUID(),episode=randomUUID();
  await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'资源观测隔离账号','Asia/Shanghai')",[account,'resources-'+account]);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,f.owner]);
  await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy) VALUES($1,$1,1,'{}')",[account]);
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$2,'资源观测隔离生产单','waiting_input')",[episode,account]);
  await f.c.query("INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot) VALUES($1,'generate_narration','ready','{}')",[episode]);
  const binding=await inspectMediaRoot(mediaRoot);await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  const base={pool:f.pool,projectRoot:process.cwd(),mediaRoot,mountPath:volume.mountPath,minimumFreeBytes:1,worker:()=>({stopped:false,lastHeartbeatAt:new Date().toISOString(),lastScanAt:new Date().toISOString(),lastError:null,activeWorkers:0,capacity:1})};
  let reader=createRuntimeStatusReader(base),handler:ReturnType<typeof createLocalHandler>;
  server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=createLocalHandler({pool:f.pool,origin,mediaRoot,runtimeStatus:(owner,page)=>reader(owner,page)});
  const get=async()=>{const response=await fetch(origin+'/api/local/system-status',{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);return response.json();};
  expect((await fetch(origin+'/api/local/system-status')).status).toBe(401);
  for(const query of ['?queuePage=0','?queuePage=1&queuePage=2','?unknown=1'])expect((await fetch(origin+'/api/local/system-status'+query,{headers:{Cookie:'loop_owner_session='+f.token}})).status).toBe(400);
  expect((await fetch(origin+'/api/local/system-status',{method:'PUT',headers:{Cookie:'loop_owner_session='+f.token,Origin:origin,'X-CSRF-Token':(await import('./sessions')).csrfFor(f.token)}})).status).toBe(405);
  const foreign=await fetch(origin+'/api/local/system-status',{headers:{Cookie:'loop_owner_session='+f.otherToken}});expect(foreign.status).toBe(200);expect((await foreign.json()).runtime.queue.total).toBe(0);
  const initial=await get(),system=await statfs(homedir()),media=await statfs(mediaRoot);
  expect(initial.runtime.queue).toMatchObject({total:1,queued:1});
  expect(initial.runtime.version).toMatchObject({state:'not_prepared',backendReleaseId:null,workerReleaseId:null});
  expect(initial.runtime.resources.systemDisk).toMatchObject({sourcePath:homedir(),totalBytes:system.blocks*system.bsize});
  expect(initial.runtime.resources.disk.availableBytes).toBeGreaterThan(0);
  expect(initial.runtime.resources.media).toMatchObject({state:'healthy',sourcePath:mediaRoot,mountPath:volume.mountPath,totalBytes:media.blocks*media.bsize,sameVolume:false});
  expect(initial.runtime.resources.media.availableBytes).toBeGreaterThan(0);
  const sharedBinding=await inspectMediaRoot(f.root);await f.c.query('DELETE FROM local_identity.media_root_binding');await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[sharedBinding.path,sharedBinding.deviceId,sharedBinding.inodeId,sharedBinding.mountPath,f.owner]);
  reader=createRuntimeStatusReader({...base,mediaRoot:f.root,mountPath:sharedBinding.mountPath});const shared=await get();expect(shared.runtime.resources.media.sameVolume).toBe(true);expect(shared.runtime.resources.systemDisk.totalBytes).toBe(shared.runtime.resources.media.totalBytes);
  await f.c.query('DELETE FROM local_identity.media_root_binding');await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  reader=createRuntimeStatusReader({...base,projectRoot:join(f.root,'missing-program')});const failedSystem=await get();expect(failedSystem.runtime.resources.disk).toBeNull();expect(failedSystem.runtime.resources.media.state).toBe('healthy');
  reader=createRuntimeStatusReader(base);await volume.unmount();const offline=await get();expect(offline.runtime.resources.media).toMatchObject({state:'offline',availableBytes:null,totalBytes:null,sameVolume:null,sourcePath:mediaRoot,mountPath:volume.mountPath});expect(offline.runtime.resources.systemDisk.availableBytes).toBeGreaterThan(0);
  expect((await fetch(origin+'/api/local/catalog',{headers:{Cookie:'loop_owner_session='+f.token}})).status).toBe(409);expect((await fetch(origin+'/api/local/system-status')).status).toBe(401);
  await volume.remount();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+2600);const restored=await get();vi.useRealTimers();expect(restored.runtime.resources.media).toMatchObject({state:'healthy',sameVolume:false});expect(restored.runtime.resources.media.availableBytes).toBeGreaterThan(0);
  if(process.env.LOOP_RUNTIME_RESOURCES_EVIDENCE)await writeFile(join(process.env.LOOP_RUNTIME_RESOURCES_EVIDENCE,'http.json'),JSON.stringify({initial,shared,failedSystem,offline,restored},null,2));
  if(process.env.LOOP_RUNTIME_RESOURCES_BROWSER_MODULE){const {verify}=await import(process.env.LOOP_RUNTIME_RESOURCES_BROWSER_MODULE);await verify({origin,token:f.token,mediaRoot});}
 }finally{vi.useRealTimers();server?.closeAllConnections();if(server?.listening)await new Promise<void>(done=>server!.close(()=>done()));await volume.close();await f.close();}
},90000);
