// @vitest-environment node
// Explicit fixture only: real Owner HTTP, PostgreSQL, file verification and 040
// triggers. A surrounding transaction uses savepoints for command transactions
// and always rolls back; readiness/wake ports never execute a Provider.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
const fixturePath=process.env.LOOP_NATIVE_TTS_TEST_FIXTURE;
assert(fixturePath,'Set LOOP_NATIVE_TTS_TEST_FIXTURE to an explicitly approved private fixture');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
assert.equal(fixture.purpose,'native-tts-first-use');
assert.equal(fixture.testOnly,true);
const deployment=JSON.parse(await readFile(fixture.deploymentFile,'utf8'));
const owner=JSON.parse(await readFile(fixture.ownerFile,'utf8'));
assert.equal(deployment.database.host,'127.0.0.1');
assert.equal(deployment.database.user,'loop_app');
assert.equal(deployment.database.database,fixture.database);
assert(/^loop_[a-z0-9_]+$/.test(fixture.database),'Only explicitly named isolated loop database');

async function runCase(missingShot=false){
 const realPool=new Pool({...deployment.database,max:3});
 const client=await realPool.connect();
 let commandOpen=false,wakes=0,testActive=false;
 const scopedClient={
  async query(text:string,values?:unknown[]){
   if(text==='BEGIN'){assert(!commandOpen);commandOpen=true;return client.query('SAVEPOINT native_tts_command');}
   if(text==='COMMIT'){assert(commandOpen);commandOpen=false;return client.query('RELEASE SAVEPOINT native_tts_command');}
   if(text==='ROLLBACK'){assert(commandOpen);commandOpen=false;await client.query('ROLLBACK TO SAVEPOINT native_tts_command');return client.query('RELEASE SAVEPOINT native_tts_command');}
   return client.query(text,values);
  },release(){},
 } as unknown as PoolClient;
 const commandPool={query:realPool.query.bind(realPool),connect:async()=>testActive?scopedClient:realPool.connect()} as unknown as Pool;
 const commands=new LocalEpisodeCommands(commandPool,deployment.mediaRoot,{ready:async()=>{},narrationReady:async()=>{},mediaReady:async()=>{},mountPath:fixture.mountPath,minimumFreeBytes:0,checkReferences:async()=>{},wake(){wakes++;}});
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 handler=createLocalHandler({pool:commandPool,episodes:commands,origin,mediaRoot:deployment.mediaRoot});
 // Login uses the ordinary route and real pool, outside the rolled-back command.
 const login=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});
 assert.equal(login.status,200);
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:login.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':(await login.json()).csrfToken};
 testActive=true;await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id',$1,true)",[owner.id]);
 const before=(await client.query('SELECT to_jsonb(i) snapshot FROM local_identity.input_episodes i WHERE episode_id=$1',[fixture.episodeId])).rows[0].snapshot;
 const draft=(await client.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[fixture.episodeId,fixture.reviewPackageId,fixture.shotId])).rows[0];
 const originalTasks=(await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n;
 try{
  // Arrange first use inside the outer rollback, without altering live history.
  await client.query('UPDATE local_identity.input_episodes SET narration_enabled=false WHERE episode_id=$1',[fixture.episodeId]);
  if(!missingShot)await client.query('SELECT public.save_shot_preparation_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)',[fixture.episodeId,fixture.reviewPackageId,fixture.shotId,'tts','回滚测试。',true,'回滚'+randomUUID(),draft.tts_voice,draft.tts_speaking_rate]);
  const response=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command:'generateTts',idempotencyKey:randomUUID(),data:{episodeId:fixture.episodeId,reviewPackageId:fixture.reviewPackageId,shotId:missingShot?'missing-native-first-use':fixture.shotId}})});
  const result=await response.json();
  const optedIn=(await client.query('SELECT narration_enabled FROM local_identity.input_episodes WHERE episode_id=$1',[fixture.episodeId])).rows[0].narration_enabled;
  if(missingShot){
   expect(response.status).not.toBe(200);expect(optedIn).toBe(false);expect(wakes).toBe(0);
   expect((await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n).toBe(originalTasks);
  }else{
   expect(response.status,JSON.stringify(result)).toBe(200);expect(optedIn).toBe(true);
   expect(result.input_snapshot.native_output_namespace).toBe(result.id);
   expect(result.input_snapshot.output.relative_path).toMatch(new RegExp(`^episodes/${fixture.episodeId}/native-tasks/${result.id}/[^/]+\\.mp3$`));
   expect(wakes).toBe(1);
  }
 }finally{
  await client.query('ROLLBACK');
  await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id',$1,true)",[owner.id]);
  const after=(await client.query('SELECT to_jsonb(i) snapshot FROM local_identity.input_episodes i WHERE episode_id=$1',[fixture.episodeId])).rows[0].snapshot;
  expect(after).toEqual(before);
  expect((await client.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[fixture.episodeId,fixture.reviewPackageId,fixture.shotId])).rows[0]).toEqual(draft);
  expect((await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n).toBe(originalTasks);
  await client.query('ROLLBACK');
  await fetch(origin+'/api/local/logout',{method:'POST',headers});
  client.release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await commands.close();await realPool.end();
 }
}

it('freezes the first native TTS output into its task namespace before dispatch',async()=>{await runCase();});
it('rolls back first-use opt-in when the TTS creation RPC rejects the shot',async()=>{await runCase(true);});
