// @vitest-environment node
import {it,expect,vi} from 'vitest';
const creationFault=vi.hoisted(()=>({afterMkdir:false,mkdirErrno:''}));
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return{...actual,mkdir:async(path:Parameters<typeof actual.mkdir>[0],options?:Parameters<typeof actual.mkdir>[1])=>{if(creationFault.mkdirErrno){const code=creationFault.mkdirErrno;creationFault.mkdirErrno='';throw Object.assign(Error('controlled filesystem creation failure'),{code});}const result=await actual.mkdir(path,options);if(creationFault.afterMkdir){creationFault.afterMkdir=false;throw Object.assign(Error('injected interruption after mkdir'),{code:'EIO'});}return result;}};});
import {randomUUID} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import {inspectMediaRoot} from './mediaRootSettings';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('first account on a native workspace without import history owns one persisted real directory and survives replay and rename',async()=>{
 const f=await embeddedStudioFixture({migrations:['db/local/111-global-media-root.sql','db/local/112-series-extension-rules.sql']});
 try{
 await f.c.query('TRUNCATE public.accounts CASCADE');await f.c.query('DELETE FROM local_identity.import_record');
 const root=await inspectMediaRoot(f.root);await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[root.path,root.deviceId,root.inodeId,root.mountPath,f.owner]);
 const post=async(command:string,data:Record<string,unknown>,key=randomUUID(),token=f.token)=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token),'Content-Type':'application/json'},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 const data={name:'CON/同名：账号',slug:'first-account',timezone:'Asia/Shanghai',policy:{}},key=randomUUID();
 expect((await post('createAccount',{...data,assetRoot:f.assetRoot})).status).toBe(400);
 const result=await post('createAccount',data,key);expect(result.status,JSON.stringify(result.body)).toBe(200);
 const id=result.body.id,row=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[id])).rows[0];expect(row.actual_root).toContain(id);expect((await lstat(row.actual_root)).isDirectory()).toBe(true);expect(await readdir(row.actual_root)).toEqual([]);
 const replay=await post('createAccount',data,key);expect(replay).toEqual(result);expect((await f.c.query('SELECT count(*)::int n FROM public.accounts')).rows[0].n).toBe(1);
 expect((await post('renameAccount',{accountId:id,name:'新显示名称'})).status).toBe(200);await f.restart();expect((await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[id])).rows[0].actual_root).toBe(row.actual_root);
 const catalog=await fetch(f.origin+'/api/local/catalog',{headers:{Cookie:'loop_owner_session='+f.token}});expect(catalog.status).toBe(200);expect((await catalog.json()).importedAt).toBeNull();
 expect((await post('createAccount',{...data,slug:'foreign'},randomUUID(),f.otherToken)).status).toBe(403);
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('real native new installation creates its first account without import data and resumes a killed creation in the same directory',async()=>{
 const {nativeMediaRootFixture}=await import('./mediaRootRuntime.fixture');const {writeFile,readFile}=await import('node:fs/promises');const {join}=await import('node:path');
 const fixture=await nativeMediaRootFixture({newInstall:true}),{f}=fixture;
 try{
 let runtime=await fixture.launch();const firstPid=runtime.pid;
 const call=async(command:string,data:Record<string,unknown>,key=randomUUID(),csrf=true,route='configuration')=>{const r=await fetch(runtime.origin+'/api/local/'+route,{method:'POST',headers:{Origin:runtime.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(f.token)}:{})},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 expect((await f.c.query('SELECT count(*)::int n FROM public.accounts')).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.import_record')).rows[0].n).toBe(0);
 const input={name:'首个账号',slug:'native-first',timezone:'Asia/Shanghai',policy:{}},key=randomUUID();expect((await call('createAccount',input,key,false)).status).toBe(403);
 const concurrent=await Promise.all([call('createAccount',input,key),call('createAccount',input,key)]);expect(concurrent[0].status,JSON.stringify(concurrent)).toBe(200);expect(concurrent[1]).toEqual(concurrent[0]);
 const id=concurrent[0].body.id,root=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[id])).rows[0].actual_root;
 await writeFile(join(root,'manual.txt'),'unknown manual data');expect((await call('renameAccount',{accountId:id,name:'已改名'})).status).toBe(200);
 expect((await call('openAssetDirectory',{accountId:id,path:'/tmp'},randomUUID(),true,'account-commands')).status).toBe(400);
 expect((await call('openAssetDirectory',{accountId:id},randomUUID(),true,'account-commands')).status).toBe(200);
 await f.c.query("CREATE FUNCTION public.test_pause_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.slug='native-crash' THEN PERFORM pg_advisory_xact_lock(178182); END IF; RETURN NEW; END $$; CREATE TRIGGER test_pause BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.test_pause_creation()");
 await f.c.query('SELECT pg_advisory_lock(178182)');
 const crashKey=randomUUID(),crashInput={...input,name:'中断恢复',slug:'native-crash'};const pending=call('createAccount',crashInput,crashKey).catch(()=>null);
 let intent:any;for(let attempt=0;attempt<100;attempt++){intent=(await f.c.query('SELECT * FROM local_identity.account_creation_intents WHERE idempotency_key=$1',[crashKey])).rows[0];if(intent?.device_id)break;await new Promise(r=>setTimeout(r,30));}expect(intent?.device_id).toBeTruthy();
 await fixture.crash();await pending;await f.c.query('SELECT pg_advisory_unlock(178182)');expect((await f.c.query('SELECT count(*)::int n FROM public.accounts')).rows[0].n).toBe(1);expect((await lstat(intent.path)).ino.toString()).toBe(intent.inode_id);
 await f.c.query('DROP TRIGGER test_pause ON public.accounts; DROP FUNCTION public.test_pause_creation()');runtime=await fixture.launch();expect(runtime.pid).not.toBe(firstPid);
 const resumed=await call('createAccount',crashInput,crashKey);expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);expect(resumed.body.id).toBe(intent.account_id);expect((await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[intent.account_id])).rows[0].actual_root).toBe(intent.path);expect(await readdir(intent.path)).toEqual([]);
 const episodeId=randomUUID();await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$3,'首建后的实际媒体','waiting_input')",[episodeId,id,concurrent[0].body.current_blueprint_version_id]);await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[episodeId,f.owner]);const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'episodes',episodeId),{recursive:true});
 const imported=await call('importMaterial',{episodeId,sourceKind:'file',sourcePath:'new-install.txt',materialType:'script',materialPurpose:'supplemental_script',mimeType:'text/plain',isMainScript:false,contentBase64:Buffer.from('无导入历史的新安装真实媒体').toString('base64')},randomUUID(),true,'episode-commands');expect(imported.status,JSON.stringify(imported.body)).toBe(200);
 const file=imported.body,preview=await fetch(runtime.origin+`/_local-artifact?episode=${episodeId}&path=${encodeURIComponent(file.storage_path)}&sha256=${file.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(preview.status).toBe(200);expect(await preview.text()).toBe('无导入历史的新安装真实媒体');
 expect(await readFile(join(root,'manual.txt'),'utf8')).toBe('unknown manual data');expect((await f.c.query('SELECT count(*)::int n FROM local_identity.import_record')).rows[0].n).toBe(0);
 if(process.env.LOOP_ACCEPTANCE_OUTPUT)await writeFile(join(process.env.LOOP_ACCEPTANCE_OUTPUT,'native-result.json'),JSON.stringify({firstPid,restartedPid:runtime.pid,firstAccountId:id,directory:root,crashedIntent:intent,resumedAccount:resumed.body,noImportHistory:true,previewBytesVerified:true},null,2));
 }finally{await fixture.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('creation faults preserve unknown files, clean only owned empty folders and resume the pre-marker crash window',async()=>{
 const fs=await import('node:fs/promises');const {join,basename}=await import('node:path');const f=await embeddedStudioFixture();
 try{
 const call=async(data:Record<string,unknown>,key=randomUUID())=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createAccount',data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
 const data={name:'mkdir 前后中断',slug:'recover-marker',timezone:'Asia/Shanghai',policy:{}},key=randomUUID();
 creationFault.afterMkdir=true;
 const failed=await call(data,key);expect(failed.status).toBe(409);
 const pending=(await f.c.query('SELECT * FROM local_identity.account_creation_intents WHERE idempotency_key=$1',[key])).rows[0];expect(await readdir(pending.path)).toEqual([]);expect(pending.device_id).toBeNull();
 const recovered=await call(data,key);expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect(recovered.body.id).toBe(pending.account_id);
 for(const code of ['EACCES','ENOSPC']){creationFault.mkdirErrno=code;const blocked=await call({...data,slug:'fault-'+code});expect(blocked.status).toBe(409);expect(blocked.body.error).toContain('权限、挂载和磁盘空间');expect((await f.c.query('SELECT count(*)::int n FROM public.accounts WHERE slug=$1',['fault-'+code])).rows[0].n).toBe(0);}
 await fs.chmod(f.root,0o500);try{expect((await call({...data,slug:'readonly-root'})).status).toBe(409);}finally{await fs.chmod(f.root,0o700);}
 await fs.rename(f.root,f.root+'-offline');try{expect((await call({...data,slug:'offline-root'})).status).toBe(409);await fs.mkdir(f.root,{mode:0o700});await fs.writeFile(join(f.root,'manual.txt'),'unknown replacement root');expect((await call({...data,slug:'replaced-root'})).status).toBe(409);expect(await fs.readFile(join(f.root,'manual.txt'),'utf8')).toBe('unknown replacement root');}finally{await fs.rm(f.root,{recursive:true,force:true});await fs.rename(f.root+'-offline',f.root);}

 await f.c.query("CREATE FUNCTION public.test_creation_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.slug IN ('failed-empty','failed-manual') THEN PERFORM pg_sleep(.3); RAISE EXCEPTION 'injected final creation failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_creation_fail BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.test_creation_fail()");
 const emptyKey=randomUUID();expect((await call({...data,slug:'failed-empty'},emptyKey)).status).toBe(409);const empty=(await f.c.query('SELECT * FROM local_identity.account_creation_intents WHERE idempotency_key=$1',[emptyKey])).rows[0];await expect(lstat(empty.path)).rejects.toMatchObject({code:'ENOENT'});
 const manualKey=randomUUID(),manual=call({...data,slug:'failed-manual'},manualKey);let owned:any;for(let i=0;i<100;i++){owned=(await f.c.query('SELECT * FROM local_identity.account_creation_intents WHERE idempotency_key=$1',[manualKey])).rows[0];if(owned?.device_id)break;await new Promise(r=>setTimeout(r,10));}expect(owned.device_id).toBeTruthy();await fs.writeFile(join(owned.path,'manual.txt'),'unknown owner bytes');expect((await manual).status).toBe(409);expect(await fs.readFile(join(owned.path,'manual.txt'),'utf8')).toBe('unknown owner bytes');
 await f.c.query('DROP TRIGGER test_creation_fail ON public.accounts; DROP FUNCTION public.test_creation_fail()');expect((await call({...data,slug:'failed-manual'},manualKey)).status).toBe(200);expect(await fs.readFile(join(owned.path,'manual.txt'),'utf8')).toBe('unknown owner bytes');
 for(const [i,name] of ['CON.txt','aux','A/B\\C:*?<>|','é','e\u0301','同名'.repeat(300)].entries()){const created=await call({...data,name,slug:'name-'+i});expect(created.status,JSON.stringify(created.body)).toBe(200);const path=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[created.body.id])).rows[0].actual_root;expect(basename(path)).toContain(created.body.id);expect(Buffer.byteLength(basename(path))).toBeLessThanOrEqual(150);expect(basename(path)).not.toMatch(/^CON\./i);}
 }finally{creationFault.afterMkdir=false;creationFault.mkdirErrno='';await f.close();}
},180000);
