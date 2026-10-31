// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Pool} from 'pg';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {nativeStorageContext} from './nativeStorage.fixture';
import {createLocalHandler} from './localRoute';
import {hashPassword} from './password';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a real backup and fresh restore preserve independent episode files and rebind account directory identity for Owner HTTP',async()=>{
 const storage=await mkdtemp('/private/tmp/loop-t07-storage-'),source='loop_t24_restore_'+randomUUID().replaceAll('-','').slice(0,12),target='loop_t24_restore_'+randomUUID().replaceAll('-','').slice(0,12);await mkdir(join(storage,'state'));
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=nativeStorageContext(runtimeContext(),storage,source,target),f=await embeddedStudioFixture({databaseName:source,testRootParent:join(storage,'state')});let restored=false,pool:Pool|undefined,server:ReturnType<typeof createServer>|undefined;
 try{
 const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href);
 const runtime={...context,mediaRoot:f.root};
 await f.c.query("UPDATE public.account_blueprint_versions SET policy=policy-'asset_root'");
 const jobId=randomUUID(),backupRoot=join(storage,'backups',f.database);
 const backup=await createNativeBackup({database:f.database,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime);expect(backup.passed).toBe(true);
 const mediaRoot=join(storage,'state','t24-t07','media');
 const receipt=await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},{...runtime,dailyRuntime:false});restored=true;
 expect(receipt.passed).toBe(true);expect(receipt.mediaReferences).toBe(2);
 const actualRoot=join(mediaRoot,'account');expect(receipt.accountDirectoryRebindings).toHaveLength(1);expect(receipt.accountDirectoryRebindings[0].actualRoot).toBe(actualRoot);
 const restoredPassword='restored-fixture-'+randomUUID(),digest=await hashPassword(restoredPassword);
 context.sql(`INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES('${f.owner}','${JSON.stringify(digest).replaceAll("'","''")}'::jsonb)`,target);
 pool=new Pool({...f.pool.options,database:target} as ConstructorParameters<typeof Pool>[0]);let handler:ReturnType<typeof createLocalHandler>;server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,origin,mediaRoot});
 const login=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:restoredPassword})});expect(login.status,await login.clone().text()).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json()).csrfToken;
 const account=receipt.accountDirectoryRebindings[0].accountId;
 const response=await fetch(origin+'/api/local/account-commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({command:'readAssetDirectory',data:{accountId:account},idempotencyKey:randomUUID()})});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'ready',assetRoot:actualRoot});
 const file=f.files[0],download=await fetch(origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:{Cookie:cookie}});expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(await readFile(join(f.assetRoot,file.relativePath)));
 expect(await readFile(join(actualRoot,file.relativePath))).toEqual(await readFile(join(f.assetRoot,file.relativePath)));
 }finally{if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}await pool?.end();if(restored||context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')==='1')context.sql('DROP DATABASE '+target+' WITH (FORCE)','postgres');await f.close();await rm(storage,{recursive:true,force:true});}
},300000);
