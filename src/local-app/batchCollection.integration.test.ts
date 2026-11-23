// @vitest-environment node
import {expect,it} from 'vitest';
import {lstat,readFile,realpath,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {csrfFor} from './sessions';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner changes physical collection, can open registered folders, and sees blocking reasons for each rejected order',async()=>{
 const volume=await workspaceAudioVolume(),opened:string[]=[];
 const f=await nativeWorkspaceFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,async openDirectory(path){opened.push(await realpath(path));}}}).catch(async error=>{await volume.close();throw error;});
 try{
  const binding=await inspectMediaRoot(f.root);
  await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  await f.start();
  const send=async(endpoint:string,command:string,data:Record<string,unknown>)=>{
   const result=await f.post(endpoint,command,data);
   expect(result.status,JSON.stringify(result.body)).toBe(200);
   return result.body;
  };
  const account=await send('configuration','createAccount',{name:'主账号',slug:'batch-collection',timezone:'Asia/Shanghai',policy:{}});
  const other=await send('configuration','createAccount',{name:'另一个账号',slug:'foreign-collection',timezone:'Asia/Shanghai',policy:{}});
  const source=await send('configuration','createSeries',{accountId:account.id,name:'原系列',rules:{positioning:'冻结规则'}});
  const target=await send('configuration','createSeries',{accountId:account.id,name:'目标系列',rules:{positioning:'另一套规则'}});
  const create=(title:string,accountId=account.id,seriesVersionId:string|undefined=source.id)=>send('episode-commands','create',{accountId,title,seriesVersionId});
  const first=await create('第一张'),second=await create('第二张'),missing=await create('离线目录');
  const outside=await send('episode-commands','create',{accountId:other.id,title:'跨账号'});
  const read=(episodeId:string)=>send('account-commands','readEpisodeCollection',{episodeId});
  const move=(episodeId:string)=>send('account-commands','moveEpisodeCollection',{episodeId,seriesId:target.series_id});
  const folder=(episodeId:string)=>send('account-commands','readEpisodeDirectory',{episodeId});
  const firstBefore=await read(first.id),missingBefore=await read(missing.id);
  await writeFile(join(firstBefore.directoryPath,'snapshot.txt'),'原始文件');
  await rename(missingBefore.directoryPath,missingBefore.directoryPath+'.offline');
  const idempotencyKey=randomUUID(),operation={command:'moveEpisodeCollection',idempotencyKey,data:{episodeId:first.id,seriesId:target.series_id}};
  const firstMove=async()=>{
   const response=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token),'Content-Type':'application/json'},body:JSON.stringify(operation)});
   expect(response.status).toBe(200);
   return response.json();
  };
  const committed=await firstMove();
  expect(committed).toMatchObject({episodeId:first.id,status:'success',migrationId:expect.any(String)});
  expect(await firstMove()).toEqual(committed);
  expect(await move(second.id)).toMatchObject({episodeId:second.id,status:'success',migrationId:expect.any(String)});
  expect(await move(first.id)).toMatchObject({episodeId:first.id,status:'skipped'});
  expect(await move(outside.id)).toMatchObject({episodeId:outside.id,status:'failed',reason:expect.stringContaining('同一账号')});
  expect(await move(missing.id)).toMatchObject({episodeId:missing.id,status:'failed',reason:expect.stringContaining('目录缺失')});
  const after=await read(first.id);
  expect(after).toMatchObject({collection:{seriesId:target.series_id},creative:firstBefore.creative,plans:[{status:'completed',files:[{relativePath:expect.stringContaining('snapshot.txt')}],retained:expect.any(Array)}]});
  expect(after.directoryPath).not.toBe(firstBefore.directoryPath);
  expect(await readFile(join(after.directoryPath,'snapshot.txt'),'utf8')).toBe('原始文件');
  expect(await readFile(join(firstBefore.directoryPath,'snapshot.txt'),'utf8')).toBe('原始文件');
  const listed=await fetch(f.origin+'/api/local/catalog?view=episodes&seriesId='+target.series_id+'&accountId='+account.id,{headers:{Cookie:'loop_owner_session='+f.token}});
  expect(listed.status).toBe(200);
  expect((await listed.json()).episodes.map((e:{id:string})=>e.id).sort()).toEqual([first.id,second.id].sort());
  expect(await send('episode-commands','openDirectory',{episodeId:first.id})).toEqual({opened:true,path:after.directoryPath});
  expect(opened).toEqual([after.directoryPath]);
  expect(await folder(first.id)).toEqual({path:after.directoryPath});
  expect(await folder(missing.id)).toEqual({path:missingBefore.directoryPath,reason:expect.stringContaining('目录缺失')});
  expect(await f.post('episode-commands','openDirectory',{episodeId:missing.id})).toMatchObject({status:409,body:{error:expect.stringContaining('目录缺失')}});
  expect(await f.post('episode-commands','openDirectory',{episodeId:first.id,path:missingBefore.directoryPath})).toMatchObject({status:400});
  expect(await f.post('episode-commands','openDirectory',{episodeId:first.id},{token:f.otherToken})).toMatchObject({status:404});
  expect(await f.post('account-commands','readEpisodeDirectory',{episodeId:first.id},{token:f.otherToken})).toMatchObject({status:404});
  await expect(lstat(missingBefore.directoryPath)).rejects.toMatchObject({code:'ENOENT'});
  expect(opened).toEqual([after.directoryPath]);

  const blocked=await create('已有计划'),changed=await create('内容改变');
  const changedBefore=await read(changed.id),file=join(changedBefore.directoryPath,'evidence.txt');
  await writeFile(file,'入盘前');
  const pending=await send('account-commands','planEpisodeCollectionMove',{episodeId:changed.id,seriesId:target.series_id});
  expect(await move(blocked.id)).toMatchObject({status:'failed',reason:expect.stringContaining('已有目录计划')});
  await writeFile(file,'盘点后被外部改动');
  expect(await f.post('account-commands','moveEpisodeCollection',{episodeId:changed.id,seriesId:target.series_id,migrationId:pending.id},{token:f.otherToken})).toMatchObject({status:200,body:{status:'failed',reason:'生产单不可见。'}});
  expect(await send('account-commands','moveEpisodeCollection',{episodeId:blocked.id,seriesId:target.series_id,migrationId:pending.id})).toMatchObject({status:'failed',reason:expect.stringContaining('迁移计划已变化')});
  expect(await send('account-commands','moveEpisodeCollection',{episodeId:changed.id,seriesId:target.series_id,migrationId:pending.id})).toMatchObject({status:'failed',reason:expect.stringContaining('源文件或生产记录已变化'),migrationId:pending.id});
  expect((await read(changed.id)).collection.seriesId).toBe(source.series_id);
  expect(await readFile(file,'utf8')).toBe('盘点后被外部改动');
  await send('account-commands','rollbackAssetDirectoryMigration',{accountId:account.id,migrationId:pending.id});
  expect(await move(blocked.id)).toMatchObject({status:'success'});

  const unassigned={seriesId:null,targetAccountId:account.id};
  expect(firstBefore.targets).toContainEqual({seriesId:null,name:'未分系列',containerId:null});
  expect(await f.post('account-commands','moveEpisodeCollection',{episodeId:first.id,seriesId:null})).toMatchObject({status:400});
  expect(await send('account-commands','moveEpisodeCollection',{episodeId:outside.id,...unassigned})).toMatchObject({status:'failed',reason:expect.stringContaining('同一账号')});
  expect((await read(first.id)).targets).toContainEqual({seriesId:null,name:'未分系列',containerId:null});
  const unassignedKey=randomUUID();
  const moveToUnassigned=async()=>{
   const response=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token),'Content-Type':'application/json'},body:JSON.stringify({command:'moveEpisodeCollection',idempotencyKey:unassignedKey,data:{episodeId:first.id,...unassigned}})});
   expect(response.status).toBe(200);
   return response.json();
  };
  const movedToUnassigned=await moveToUnassigned();
  expect(movedToUnassigned).toMatchObject({episodeId:first.id,status:'success',migrationId:expect.any(String)});
  expect(await moveToUnassigned()).toEqual(movedToUnassigned);
  expect(await send('account-commands','moveEpisodeCollection',{episodeId:second.id,...unassigned})).toMatchObject({status:'success'});
  expect(await send('account-commands','moveEpisodeCollection',{episodeId:first.id,...unassigned})).toMatchObject({status:'skipped'});
  const unassignedAfter=await read(first.id);
  expect(unassignedAfter).toMatchObject({collection:{status:'registered',seriesId:null,name:'未分系列'},creative:firstBefore.creative});
  expect(unassignedAfter.targets.filter((target:{seriesId:string|null})=>target.seriesId)).toEqual(firstBefore.targets.filter((target:{seriesId:string|null})=>target.seriesId));
  expect(unassignedAfter.directoryPath).not.toBe(after.directoryPath);
  expect(await readFile(join(unassignedAfter.directoryPath,'snapshot.txt'),'utf8')).toBe('原始文件');
 }finally{await f.close();await volume.close();}
},120000);
