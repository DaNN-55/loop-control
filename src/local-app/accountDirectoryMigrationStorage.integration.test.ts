// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {mkdirSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Pool} from 'pg';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {createLocalHandler} from './localRoute';
import {csrfFor} from './sessions';
import {hashPassword} from './password';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a real backup and fresh restore retain migrated account location mappings and return original artifact bytes through Owner HTTP',async()=>{
 const f=await embeddedStudioFixture(),storage=await mkdtemp('/private/tmp/loop-t08-storage-'),target='loop_t24_restore_t08_'+randomUUID().replaceAll('-','').slice(0,12);
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();let restored=false,pool:Pool|undefined,server:ReturnType<typeof createServer>|undefined;
 try{
 const {createNativeBackup}=await import(new URL('../../scripts/storage/backup.mjs',import.meta.url).href),{restoreNativeBackup}=await import(new URL('../../scripts/storage/restore.mjs',import.meta.url).href);
 // A real filesystem adapter restricted to this disposable storage fixture.
 const ensurePrivateDirectory=(path:string)=>{const rel=relative(storage,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Fixture storage escape');mkdirSync(path,{recursive:true,mode:0o700});if(realpathSync(path)!==path)throw Error('Fixture storage alias');};
 const runtime={...context,root:storage,projectRoot:process.cwd(),database:f.database,mediaRoot:f.root,ensurePrivateDirectory};
 const accountId=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,targetRoot=join(f.root,'migrated-account');await mkdir(targetRoot);
 const migrationCommand=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{accountId,...data},idempotencyKey:randomUUID()})});const body=await r.json();expect(r.status,JSON.stringify(body)).toBe(200);return body;};
 const migration=await migrationCommand('planAssetDirectoryMigration',{path:targetRoot});expect(migration.conflicts).toEqual([]);await migrationCommand('executeAssetDirectoryMigration',{migrationId:migration.id});

 const jobId=randomUUID(),backupRoot=join(storage,'backups',f.database);
 const backup=await createNativeBackup({database:f.database,mediaRoot:f.root,projectRoot:process.cwd(),backupRoot,jobId},undefined,runtime);expect(backup.passed).toBe(true);
 const mediaRoot=join(storage,'state','t24-t07','media');
 const receipt=await restoreNativeBackup({database:target,mediaRoot,archiveRoot:join(backupRoot,jobId),archiveSha256:backup.archiveSha256},{...runtime,dailyRuntime:false});restored=true;
 expect(receipt.passed).toBe(true);expect(receipt.mediaReferences).toBe(2);
 const actualRoot=join(mediaRoot,'migrated-account');expect(receipt.accountDirectoryRebindings).toHaveLength(1);expect(receipt.accountDirectoryRebindings[0].actualRoot).toBe(actualRoot);
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
