// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {nativeMediaRootFixture} from './mediaRootRuntime.fixture';
import {csrfFor} from './sessions';
const migrations=['db/local/121-restored-media-deployment.sql','db/local/125-global-media-root-plans.sql','db/local/126-global-media-root-execution.sql'];
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('SIGKILL after private config publication but before database COMMIT restores source metadata and resumes the original plan',async()=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,source,target,configFile,runtimeRoot}=fixture;
 try{
  const config=JSON.parse(await readFile(configFile,'utf8'));await writeFile(configFile,JSON.stringify({...config,publicationFaultTarget:target}),{mode:0o600});
  let runtime=await fixture.launch('root-before-commit-kill');const first=runtime.pid;
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const original=await readFile(join(f.assetRoot,f.videoPath)),plan=await call('planMigration',{path:target});expect(plan.status).toBe(200);await expect(call('executeMigration',{migrationId:plan.body.id})).rejects.toThrow();
  const pending=JSON.parse(await readFile(join(runtimeRoot,'media-root-pending.json'),'utf8'));expect(pending.publication).toMatchObject({operation:'migration',planId:plan.body.id,manifestSha256:plan.body.manifestSha256});expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(target);expect((await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding.path).toBe(source);
  runtime=await fixture.launch();expect(runtime.pid).not.toBe(first);const recovered=(await call()).body;expect(recovered.path).toBe(source);expect(recovered.migration.status).toBe('copying');expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(source);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
  const result=await call('executeMigration',{migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe('completed');expect((await call()).body.path).toBe(target);await expect(access(join(runtimeRoot,'media-root-pending.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['root-commit-unknown','root-activation-fail','root-old-close-fail','root-finalize-kill'] as const)('%s retains committed plan authority and a fresh native process completes one consistent target',async fault=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,source,target,configFile,runtimeRoot}=fixture;
 try{
  const config=JSON.parse(await readFile(configFile,'utf8'));await writeFile(configFile,JSON.stringify({...config,publicationFaultTarget:target}),{mode:0o600});
  let runtime=await fixture.launch(fault);const first=runtime.pid;
  const call=async(command?:string,data:Record<string,unknown>={})=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:command?'POST':'GET',headers:{Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},...(command?{body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})}:{})});return{status:r.status,body:await r.json()};};
  const original=await readFile(join(f.assetRoot,f.videoPath)),plan=await call('planMigration',{path:target});expect(plan.status).toBe(200);
  if(fault==='root-finalize-kill')await expect(call('executeMigration',{migrationId:plan.body.id})).rejects.toThrow();else{const result=await call('executeMigration',{migrationId:plan.body.id});expect(result.status,JSON.stringify(result.body)).toBe(503);expect(result.body.error).toContain('待恢复');}
  const row=(await f.c.query('SELECT * FROM local_identity.media_root_migrations WHERE id=$1',[plan.body.id])).rows[0];expect(row.status).toBe(fault==='root-finalize-kill'?'completed':'committed');expect(row.manifest).toEqual(plan.body.manifest);expect((await f.c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding.path).toBe(target);expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(target);
  const journal=JSON.parse(await readFile(join(runtimeRoot,'media-root-pending.json'),'utf8'));expect(journal.publication.planId).toBe(plan.body.id);if(fault==='root-commit-unknown')expect(JSON.parse(await readFile(join(runtimeRoot,'commit-confirmation-lost.json'),'utf8')).database).toBe(f.database);
  if(fault==='root-old-close-fail'){const during=(await call()).body;expect(during.path).toBe(target);expect(during.migration.status).toBe('committed');}
  await fixture.stop();runtime=await fixture.launch();expect(runtime.pid).not.toBe(first);const recovered=(await call()).body;expect(recovered).toMatchObject({path:target,status:'ready',migration:{id:plan.body.id,status:'completed',manifest:plan.body.manifest,manifestSha256:plan.body.manifestSha256}});await expect(access(join(runtimeRoot,'media-root-pending.json'))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);expect((await f.c.query('SELECT count(*) FROM local_identity.storage_location_operations WHERE media_root_migration_id=$1',[plan.body.id])).rows[0].count).toBe('1');
  if(process.env.LOOP_T16_EVIDENCE){const {mkdir}=await import('node:fs/promises');await mkdir(process.env.LOOP_T16_EVIDENCE,{recursive:true});await writeFile(join(process.env.LOOP_T16_EVIDENCE,fault+'.json'),JSON.stringify({fault,source,target,firstPid:first,restartedPid:runtime.pid,committedStatus:row.status,recovered,onePublication:true,originalsRetained:true},null,2));}
 }finally{await fixture.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['root-before-commit-kill','root-activation-fail'] as const)('environment pre-secret recovery uses the same real plan proof for %s and retains a tampered publication',async fault=>{
 const fixture=await nativeMediaRootFixture({existingData:true,migrations}),{f,source,target,configFile,runtimeRoot}=fixture;
 try{
  const config=JSON.parse(await readFile(configFile,'utf8'));await writeFile(configFile,JSON.stringify({...config,publicationFaultTarget:target}),{mode:0o600});
  const runtime=await fixture.launch(fault),headers={Cookie:'loop_owner_session='+f.token,Origin:runtime.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)};
  const call=async(command:string,data:Record<string,unknown>)=>{const r=await fetch(runtime.origin+'/api/local/media-root',{method:'POST',headers,body:JSON.stringify({command,idempotencyKey:randomUUID(),...data})});return{status:r.status,body:await r.json()};};
  const plan=await call('planMigration',{path:target});expect(plan.status).toBe(200);if(fault==='root-before-commit-kill')await expect(call('executeMigration',{migrationId:plan.body.id})).rejects.toThrow();else expect((await call('executeMigration',{migrationId:plan.body.id})).status).toBe(503);await fixture.stop();
  // Import is side-effect free. The production environment reader's exact
  // pre-hydration seam receives only this fixture's private settings and DB.
  const {recoverDeploymentMediaRoot}=await import(join(process.cwd(),'scripts/runtime/environment.mjs'));const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext(),beforeConfig=await readFile(configFile,'utf8'),beforeJournal=await readFile(join(runtimeRoot,'media-root-pending.json'),'utf8');const readSettings=()=>JSON.parse(readFileSync(configFile,'utf8')),adapter={sql:(text:string)=>context.sql(text,f.database),readSettings,deploymentFile:configFile};
  let tamperRejected=false;
  if(fault==='root-activation-fail'){
   const original=(await f.c.query('SELECT publication FROM local_identity.media_root_migrations WHERE id=$1',[plan.body.id])).rows[0].publication;
   await f.c.query("UPDATE local_identity.media_root_migrations SET publication=jsonb_set(publication,'{bindings}','[]') WHERE id=$1",[plan.body.id]);
   expect(()=>recoverDeploymentMediaRoot(readSettings(),adapter)).toThrow();tamperRejected=true;expect(await readFile(configFile,'utf8')).toBe(beforeConfig);expect(await readFile(join(runtimeRoot,'media-root-pending.json'),'utf8')).toBe(beforeJournal);await f.c.query('UPDATE local_identity.media_root_migrations SET publication=$2 WHERE id=$1',[plan.body.id,original]);
  }
  const recovered=recoverDeploymentMediaRoot(readSettings(),adapter);expect(recovered.mediaRoot).toBe(fault==='root-before-commit-kill'?source:target);expect(JSON.parse(await readFile(configFile,'utf8')).mediaRoot).toBe(recovered.mediaRoot);
  if(fault==='root-before-commit-kill')await expect(access(join(runtimeRoot,'media-root-pending.json'))).rejects.toMatchObject({code:'ENOENT'});else expect(JSON.parse(await readFile(join(runtimeRoot,'media-root-pending.json'),'utf8')).publication.planId).toBe(plan.body.id);
  if(process.env.LOOP_T16_EVIDENCE)await writeFile(join(process.env.LOOP_T16_EVIDENCE,'environment-'+fault+'.json'),JSON.stringify({fault,planId:plan.body.id,manifestSha256:plan.body.manifestSha256,beforeConfig:JSON.parse(beforeConfig),beforeJournal:JSON.parse(beforeJournal),recovered,tamperRejected,secretHydrationInvoked:false},null,2));
 }finally{await fixture.close();}
},180000);
