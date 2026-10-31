// @vitest-environment node
import {it,expect,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {mkdir,lstat,readFile,writeFile,rename,symlink,rmdir,chmod,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {randomUUID} from 'node:crypto';
import {csrfFor} from './sessions';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
const publicationFault=vi.hoisted(()=>({directory:'',once:false,triggered:false}));
// Controlled fault at the system filesystem boundary; DB, HTTP and file bytes stay real.
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return{...actual,unlink:async(path:Parameters<typeof actual.unlink>[0])=>{if(publicationFault.once&&String(path).startsWith(publicationFault.directory+'/.input-')&&/\.input-[0-9a-f-]{36}(?:\.part)?$/.test(String(path))){publicationFault.once=false;publicationFault.triggered=true;throw Object.assign(Error('controlled disk interruption after link'),{code:'EIO'});}return actual.unlink(path);}};});
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner imports and confirms managed script bytes at the registered production location, retaining legacy previews after restart',async()=>{
 const volume=await workspaceAudioVolume();const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}},migrations:['db/local/117-input-storage-locations.sql']});
 try{
  await f.c.query("UPDATE public.episodes SET stage='waiting_input' WHERE id=$1",[f.episode]);
  const prefix='系列 stable/生产单 stable',directory=join(f.assetRoot,prefix);await mkdir(join(directory,'input'),{recursive:true});const stat=await lstat(directory,{bigint:true});
  await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,prefix,String(stat.dev),String(stat.ino)]);
  await writeFile(join(directory,'input','main.md'),productionScriptTemplate);
  const imported=await f.request('importMaterial',{sourceKind:'directory',sourcePath:'main.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true});
  expect(imported.status,JSON.stringify(imported.body)).toBe(200);expect(imported.body.storage_path).toMatch(/^系列 stable\/生产单 stable\/materials\/[a-f0-9]{64}-main.md$/);
  await rename(join(directory,'input','main.md'),join(f.root,'source-moved.md'));
  const preview=async(path:string,sha:string)=>fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(path)}&sha256=${sha}`,{headers:{Cookie:'loop_owner_session='+f.token}});
  const bytes=await preview(imported.body.storage_path,imported.body.sha256);expect(bytes.status).toBe(200);expect(await bytes.text()).toBe(productionScriptTemplate);
  await rename(join(f.assetRoot,'episodes'),join(f.root,'legacy-fixture-offline'));
  const started=await f.request('start');expect(started.status,JSON.stringify(started.body)).toBe(200);expect(started.body.stage).toBe('script_approved');
  await rename(join(f.root,'legacy-fixture-offline'),join(f.assetRoot,'episodes'));
  const prepared=await f.request('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const detail=await(await fetch(f.origin+'/api/local/episodes/'+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}})).json(),artifacts=detail.sections.artifacts??detail.patches?.artifacts?.rows,preparation=artifacts.find((a:{relative_path:string})=>a.relative_path.startsWith(prefix+'/preparation/'));expect(preparation).toBeTruthy();
  const board=await(await preview(preparation.relative_path,preparation.sha256)).json();expect(board.shots[0].inputBasis).toContainEqual({relativePath:imported.body.storage_path,sha256:imported.body.sha256});
  await f.c.query("UPDATE public.episodes SET title='改显示名称' WHERE id=$1",[f.episode]);await f.restart();
  expect(await(await preview(imported.body.storage_path,imported.body.sha256)).text()).toBe(productionScriptTemplate);
  const revisedText=productionScriptTemplate.replace('# ', '# 修订');
  const revision=await f.request('reconfirmScript',{expectedScriptRevisionId:imported.body.id,text:revisedText,reason:'调整输入正文'});expect(revision.status,JSON.stringify(revision.body)).toBe(200);expect(revision.body.storage_path).toContain(prefix+'/materials/');expect(revision.body.id).not.toBe(imported.body.id);
  expect(await(await preview(imported.body.storage_path,imported.body.sha256)).text()).toBe(productionScriptTemplate);expect(await(await preview(revision.body.storage_path,revision.body.sha256)).text()).toBe(revisedText);
  expect((await f.request('start')).status).toBe(200);
  const old=f.files[0],legacy=await preview(old.relativePath,old.sha256);expect(legacy.status).toBe(200);expect(Buffer.from(await legacy.arrayBuffer())).toEqual(await readFile(join(f.assetRoot,old.relativePath)));
  await volume.close();const offline=await f.request('importMaterial',{sourceKind:'file',sourcePath:'offline.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from('offline').toString('base64')});expect(offline.status,JSON.stringify(offline.body)).toBe(409);
 }finally{await f.close();await volume.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner reuses an approved series input as a self-contained managed copy with original source approval evidence',async()=>{
 const volume=await workspaceAudioVolume();const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}},migrations:['db/local/117-input-storage-locations.sql']});
 try{
  const {randomUUID}=await import('node:crypto');const series=randomUUID(),version=randomUUID();
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  await f.c.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$2,'Input reuse')",[series,account]);await f.c.query("INSERT INTO public.series_versions(id,account_id,series_id,version,rules,created_by) VALUES($1,$2,$3,1,'{}',$4)",[version,account,series,f.owner]);
  await f.c.query("UPDATE public.episodes SET stage='waiting_input',series_version_id=$2 WHERE id=$1",[f.episode,version]);
  const source=await f.request('importMaterial',{sourceKind:'file',sourcePath:'shared.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from('approved inert image bytes').toString('base64')});expect(source.status,JSON.stringify(source.body)).toBe(200);
  const foreignRoot=join(f.root,'foreign-account');await mkdir(foreignRoot);const configuredAccount=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createAccount',idempotencyKey:randomUUID(),data:{name:'另一个账号',slug:'foreign-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'隔离复用',tone:'克制'},assetRoot:foreignRoot}})});const foreignAccount=await configuredAccount.json();expect(configuredAccount.status,JSON.stringify(foreignAccount)).toBe(200);
  const foreignEpisode=await f.request('create',{episodeId:undefined,accountId:foreignAccount.id,title:'跨账号源'});expect(foreignEpisode.status,JSON.stringify(foreignEpisode.body)).toBe(200);
  const foreign=await f.request('importMaterial',{episodeId:foreignEpisode.body.id,sourceKind:'file',sourcePath:'shared.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from('different account owned bytes').toString('base64')});expect(foreign.status,JSON.stringify(foreign.body)).toBe(200);
  const target=await f.request('create',{episodeId:undefined,accountId:account,seriesVersionId:version,title:'复用目标'});expect(target.status,JSON.stringify(target.body)).toBe(200);const id=target.body.id;
  const prefix='未分系列 stable/复用目标 stable',directory=join(f.assetRoot,prefix);await mkdir(directory,{recursive:true});const stat=await lstat(directory,{bigint:true});await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[id,prefix,String(stat.dev),String(stat.ino)]);
  const text=productionScriptTemplate.replace('填写已上传图片的素材名称','shared');
  const script=await f.request('importMaterial',{episodeId:id,sourceKind:'file',sourcePath:'script.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(text).toString('base64')});expect(script.status,JSON.stringify(script.body)).toBe(200);
  const foreignChoice=await f.request('configureScriptProduction',{episodeId:id,enabled:false,choices:{'image:shared':foreign.body.id}});expect(foreignChoice.status,JSON.stringify(foreignChoice.body)).toBe(200);expect(foreignChoice.body.plan.segments[0].firstFrame.material).toBeUndefined();expect(foreignChoice.body.plan.segments[0].firstFrame.candidates.map((m:{id:string})=>m.id)).not.toContain(foreign.body.id);
  const configured=await f.request('configureScriptProduction',{episodeId:id,enabled:false,choices:{}});expect(configured.status,JSON.stringify(configured.body)).toBe(200);
  const material=configured.body.plan.segments[0].firstFrame.material;expect(material).toMatchObject({episodeId:id,sha256:source.body.sha256,path:expect.stringContaining(prefix+'/materials/'),provenance:{source:{id:source.body.id,episode_id:f.episode,storage_path:source.body.storage_path},approvals:[expect.objectContaining({approved_by:f.owner})]}});
  await rename(join(f.assetRoot,'episodes',f.episode),join(f.root,'source-production-offline'));await f.restart();
  const preview=await fetch(f.origin+`/_local-artifact?episode=${id}&path=${encodeURIComponent(material.path)}&sha256=${material.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(preview.status).toBe(200);expect(await preview.text()).toBe('approved inert image bytes');
  const reconfigured=await f.request('configureScriptProduction',{episodeId:id,enabled:false,choices:{}});expect(reconfigured.status,JSON.stringify(reconfigured.body)).toBe(200);expect(reconfigured.body.authorizationHash).toBe(configured.body.authorizationHash);
  const read=await(await fetch(f.origin+`/api/local/script-production?episode=${id}`,{headers:{Cookie:'loop_owner_session='+f.token}})).json();expect(read.inspection.segments[0].firstFrame.material.provenance).toEqual(material.provenance);
 }finally{await f.close();await volume.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('input retries preserve immutable bytes and reject unsafe, foreign, interrupted and replaced-directory submissions',async()=>{
 const f=await embeddedStudioFixture();
 try{
  await f.c.query("UPDATE public.episodes SET stage='waiting_input' WHERE id=$1",[f.episode]);
  const prefix='stable/account-input',directory=join(f.assetRoot,prefix);await mkdir(directory,{recursive:true});const stat=await lstat(directory,{bigint:true});await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,prefix,String(stat.dev),String(stat.ino)]);
  const data={sourceKind:'file',sourcePath:'same.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from('first immutable bytes').toString('base64')};
  const submit=async(value:Record<string,unknown>,key:string)=>{const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'importMaterial',idempotencyKey:key,data:{episodeId:f.episode,...value}})});return{status:response.status,body:await response.json()};};
  const key=randomUUID(),first=await submit(data,key);expect(first.status,JSON.stringify(first.body)).toBe(200);expect(await submit(data,key)).toEqual(first);expect((await submit({...data,contentBase64:Buffer.from('different').toString('base64')},key)).status).toBe(409);
  const second=await submit({...data,contentBase64:Buffer.from('second immutable bytes').toString('base64')},randomUUID());expect(second.status).toBe(200);expect(second.body.storage_path).not.toBe(first.body.storage_path);
  expect((await f.request('importMaterial',data,{token:f.otherToken})).status).toBe(404);expect((await f.request('importMaterial',data,{csrf:false})).status).toBe(403);
  for(const sourcePath of ['../outside.png','/private/tmp/foreign.png','nested/../../foreign.png'])expect((await submit({...data,sourcePath},randomUUID())).status).toBe(400);
  const retry=randomUUID(),directoryInput={...data,sourceKind:'directory',sourcePath:'arriving.png',contentBase64:undefined};const interrupted=await submit(directoryInput,retry);expect(interrupted.status,JSON.stringify(interrupted.body)).toBe(409);await writeFile(join(directory,'input','arriving.png'),'later complete bytes');const recovered=await submit(directoryInput,retry);expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);
  const interruptedKey=randomUUID(),writeFailure={...data,sourcePath:'write-interrupted.png'};await chmod(join(directory,'materials'),0o500);try{expect((await submit(writeFailure,interruptedKey)).status).toBe(403);}finally{await chmod(join(directory,'materials'),0o700);}expect((await submit(writeFailure,interruptedKey)).status).toBe(200);expect((await readdir(join(directory,'materials'))).filter(name=>name.startsWith('.input-'))).toEqual([]);
  await writeFile(join(f.root,'foreign.png'),'foreign bytes');await symlink(join(f.root,'foreign.png'),join(directory,'input','alias.png'));expect((await submit({...directoryInput,sourcePath:'alias.png'},randomUUID())).status).toBe(400);
  const preview=()=>fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(first.body.storage_path)}`,{headers:{Cookie:'loop_owner_session='+f.token,Range:'bytes=0-4'}});const ranged=await preview();expect(ranged.status).toBe(206);expect(await ranged.text()).toBe('first');
  await rename(directory,directory+'-offline');expect((await submit(data,randomUUID())).status).toBe(409);expect((await preview()).status).toBe(409);await expect(lstat(directory)).rejects.toMatchObject({code:'ENOENT'});
  await mkdir(directory);expect((await submit(data,randomUUID())).status).toBe(409);expect((await preview()).status).toBe(409);await rmdir(directory);await symlink(directory+'-offline',directory);expect((await submit(data,randomUUID())).status).toBe(409);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('receipted input publication survives an interrupted unlink and restart without overwriting unknown targets or trusting altered receipts',async()=>{
 const f=await embeddedStudioFixture();
 try{
  await f.c.query("UPDATE public.episodes SET stage='waiting_input' WHERE id=$1",[f.episode]);
  const directory=join(f.assetRoot,'episodes',f.episode,'materials'),bytes='complete interrupted input bytes',key=randomUUID();
  const submit=async()=>{const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'importMaterial',idempotencyKey:key,data:{episodeId:f.episode,sourceKind:'file',sourcePath:'interrupted.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:Buffer.from(bytes).toString('base64')}})});return{status:r.status,body:await r.json()};};
  publicationFault.directory=directory;publicationFault.once=true;publicationFault.triggered=false;
  const interrupted=await submit();expect(interrupted.status,JSON.stringify(interrupted.body)).toBe(409);expect(publicationFault.triggered).toBe(true);
  const receiptName=(await readdir(directory)).find(name=>name.endsWith('.receipt.json'))!,receipt=join(directory,receiptName),original=await readFile(receipt,'utf8'),record=JSON.parse(original),target=join(directory,record.target);expect((await lstat(target)).nlink).toBe(2);expect(await readFile(target,'utf8')).toBe(bytes);
  await f.restart();await writeFile(receipt,JSON.stringify({...record,target:'../unowned.png'}));expect((await submit()).status).toBe(409);expect(await readFile(target,'utf8')).toBe(bytes);await writeFile(receipt,original);
  await rename(target,target+'.retained');await writeFile(target,'unknown conflict bytes');expect((await submit()).status).toBe(409);expect(await readFile(target,'utf8')).toBe('unknown conflict bytes');expect(await readFile(target+'.retained','utf8')).toBe(bytes);await fs.unlink(target);await rename(target+'.retained',target);
  const restored=await submit();expect(restored.status,JSON.stringify(restored.body)).toBe(200);expect((await lstat(target)).nlink).toBe(1);expect(await readFile(target,'utf8')).toBe(bytes);expect((await readdir(directory)).filter(name=>name.startsWith('.input-'))).toEqual([]);expect(await submit()).toEqual(restored);
  const preview=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(restored.body.storage_path)}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(preview.status).toBe(200);expect(await preview.text()).toBe(bytes);
 }finally{publicationFault.once=false;publicationFault.directory='';await f.close();}
},300000);
