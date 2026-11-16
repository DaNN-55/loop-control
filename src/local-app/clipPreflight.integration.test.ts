// @vitest-environment node
// Retired commands never reach network policy, credential, readiness or task creation.
// Current local clip production is covered by workspace visual/material tests.
import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {LocalConnections} from './connections';
import {createProviderProbe} from './providerProbe';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([
 {command:'generateClip',mediaEnabled:false},
 {command:'generateClip',mediaEnabled:true},
 {command:'planMedia',mediaEnabled:true},
])('retired $command ignores expired network authorization without changing media dispatch (enabled=$mediaEnabled)',async({command,mediaEnabled})=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);
 if(runtimeContext().dailyRuntime!==false)throw Error('An explicit isolated fixture is required');
 const directory=await mkdtemp('/private/tmp/retired-clip-policy-');
 let f:Awaited<ReturnType<typeof embeddedStudioFixture>>|undefined;
 try{
  const policy={version:1,runId:randomUUID(),enabled:true,expiresAt:'2020-01-01T00:00:00Z',maxRequests:1,currency:'USD',maxCostMicrounits:100,priceEvidenceSha256:'a'.repeat(64),approvalSha256:'b'.repeat(64),providers:['pexels'],operations:{'pexels.verify':{maxRequests:1,maxBytes:64,timeoutMs:1000,costMicrounits:0}}};
  const bytes=JSON.stringify(policy),policySha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory,'policy.json'),bytes,{mode:0o600});
  await writeFile(join(directory,'state.json'),JSON.stringify({version:1,policySha256,used:0,costMicrounits:0,byOperation:{},halted:false,events:[]}),{mode:0o600});
  let secretReads=0,secretWrites=0,providerCalls=0,preflights=0,wakes=0;
  const probe=createProviderProbe({directory,policySha256},async()=>{providerCalls++;throw Error('No Provider calls permitted');});
  expect(probe.verificationStatus!('pexels')).toMatchObject({available:false,code:'network_expired'});
  const readiness=async()=>{preflights++;throw Error('Retired commands must not check runtime readiness');};
  f=await embeddedStudioFixture({runtime:{ready:readiness,narrationReady:readiness,mediaReady:readiness,checkReferences:readiness,wake(){wakes++;}},connections:pool=>new LocalConnections(pool,{mode:'keychain',async get(){secretReads++;throw Error('Store locked');},async putImmutable(){secretWrites++;throw Error('No writes');}},probe)});
  await f.c.query('UPDATE local_identity.input_episodes SET media_enabled=$2 WHERE episode_id=$1',[f.episode,mediaEnabled]);
  const login=await fetch(f.origin+'/api/local/login',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password})});
  expect(login.status).toBe(200);const token=login.headers.get('set-cookie')!.split(';')[0].split('=')[1];
  const snapshot=async()=>(await f!.c.query("SELECT jsonb_build_object('input',(SELECT to_jsonb(i) FROM local_identity.input_episodes i WHERE episode_id=$1),'episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'drafts',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.shot_preparation_drafts d WHERE episode_id=$1),'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY idempotency_key) FROM local_identity.command_receipts r),'reservations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY task_id) FROM public.paid_generation_reservations p)) value",[f!.episode])).rows[0].value;
  const before=await snapshot(),files=await deletionFixtureFingerprint(f.assetRoot),ledger=await readFile(join(directory,'state.json')),preflightBefore=preflights;
  const data={reviewPackageId:f.board,...(command==='generateClip'?{shotId:'shot-1',retry:true}:{})};
  expect((await f.request(command,data,{token:f.otherToken})).status).toBe(404);
  expect((await f.request(command,data,{token,csrf:false})).status).toBe(403);
  const result=await f.request(command,data,{token});expect(result.status,JSON.stringify(result.body)).toBe(410);expect(result.body.error).toContain('已退役');
  expect(await snapshot()).toEqual(before);expect(await deletionFixtureFingerprint(f.assetRoot)).toEqual(files);
  expect(await readFile(join(directory,'policy.json'),'utf8')).toBe(bytes);expect(await readFile(join(directory,'state.json'))).toEqual(ledger);
  expect({secretReads,secretWrites,providerCalls,wakes}).toEqual({secretReads:0,secretWrites:0,providerCalls:0,wakes:0});expect(preflights).toBe(preflightBefore);
 }finally{await f?.close();await rm(directory,{recursive:true,force:true});}
},60000);
