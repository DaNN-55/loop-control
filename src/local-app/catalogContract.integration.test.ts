// @vitest-environment node
// Explicit isolated fixture only. The retained RPC is a compatibility reference:
// its identity call is adapted to native identity, not a deployed Supabase test.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {hashPassword} from './password';
import type {EpisodeCatalog} from '../episodes/episodeCatalogTypes';

const fixturePath=process.env.LOOP_CATALOG_CONTRACT_TEST_FIXTURE;
assert(fixturePath,'Set LOOP_CATALOG_CONTRACT_TEST_FIXTURE to an approved isolated fixture');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
assert.equal(fixture.purpose,'ad-sql-closeout');assert.equal(fixture.testOnly,true);
assert(/^loop_t24_restore_sql[a-z0-9_]+$/.test(fixture.database));
const deployment=JSON.parse(await readFile(fixture.deploymentFile,'utf8'));
assert.equal(deployment.database.host,'127.0.0.1');assert.equal(deployment.database.user,'loop_app');assert.equal(deployment.database.database,fixture.database);
const {assertDatabase,env:containerEnvironment}=await import(fixture.nativeEnvironmentModule);
assertDatabase();
const bridges:ReturnType<typeof spawn>[]=[];
const admin=new Pool({...deployment.database,user:'postgres',password:undefined,max:1,stream:()=>{
 const bridge=spawn('docker',['exec','-i','loop-control-stage-d-postgres','perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:containerEnvironment,stdio:['pipe','pipe','pipe']});bridges.push(bridge);
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 return Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}});
}} as ConstructorParameters<typeof Pool>[0]);
const pool=new Pool({...deployment.database,max:4});
const nonce=randomUUID().replaceAll('-',''),schema='catalog_contract_'+nonce;
const owner=randomUUID(),otherOwner=randomUUID(),accountA=randomUUID(),accountB=randomUUID(),foreignAccount=randomUUID(),memberAccount=randomUUID();
const series=randomUUID(),seriesVersion=randomUUID();
const episode=(n:number)=>`${nonce.slice(0,8)}-${nonce.slice(8,12)}-4${nonce.slice(13,16)}-8${nonce.slice(17,20)}-${String(n).padStart(12,'0')}`;
const active=Array.from({length:28},(_,i)=>episode(i+1));
const archived=[episode(29),episode(30)],foreign=episode(31),member=episode(32);
const instant='2026-01-01T00:00:00.000Z';
const server=createServer((request,response)=>handler(request,response));
let handler:ReturnType<typeof createLocalHandler>,origin:string;
let ownerCookie:string,otherCookie:string;
const contractKeys=['episodes','total','page','pageSize','episodeCount','accountCounts','reviewCount','stages','artifactCounts','pending','blocked','worker','operationRows'] as const;
const contract=(catalog:EpisodeCatalog)=>Object.fromEntries(contractKeys.map(key=>[key,catalog[key]]));

beforeAll(async()=>{
 const historical=await readFile(new URL('../../supabase/migrations/20261024004749_episode_catalog_paging.sql',import.meta.url),'utf8');
 assert.equal(historical.match(/auth\.uid\(\)/g)?.length,1);
 const rpc=historical.slice(historical.indexOf('create function'),historical.indexOf('revoke all on function'))
  .replace('public.read_episode_catalog(',`${schema}.read_episode_catalog(`).replace('auth.uid()','local_identity.owner_id()');
 const password=randomBytes(24).toString('hex'),digest=await hashPassword(password);
 const client=await admin.connect();
 try{
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${schema};REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;GRANT USAGE ON SCHEMA ${schema} TO loop_owner;${rpc}REVOKE ALL ON FUNCTION ${schema}.read_episode_catalog(text,integer,uuid,text,text,integer,integer) FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${schema}.read_episode_catalog(text,integer,uuid,text,text,integer,integer) TO loop_owner;`);
  for(const id of [owner,otherOwner]){
   await client.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2)',[id,`catalog-${id}@example.invalid`]);
   await client.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[id,digest]);
  }
  for(const [id,user,role]of [[accountA,owner,'owner'],[accountB,owner,'owner'],[foreignAccount,otherOwner,'owner'],[memberAccount,owner,'worker']]as const){
   await client.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Catalog contract fixture','Asia/Shanghai')",[id,'catalog-'+id]);
   await client.query('INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,$3)',[id,user,role]);
   await client.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy) VALUES($1,$1,1,$2)',[id,{asset_root:deployment.mediaRoot}]);
  }
  await client.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$2,'Contract series')",[series,accountA]);
  await client.query("INSERT INTO public.series_versions(id,account_id,series_id,version,rules,created_by) VALUES($1,$2,$3,1,'{}',$4)",[seriesVersion,accountA,series,owner]);
  for(let n=1;n<=32;n++){
   const account=n<=26?accountA:n<=30?accountB:n===31?foreignAccount:memberAccount;
   // 24 active reviews + 4 active waiting + 2 archived waiting.
   const actualAccount=n<=24||n===29||n===30?accountA:n<=28?accountB:account;
   await client.query('INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,updated_at,archived_at,series_version_id) VALUES($1,$2,$2,$3,$4,$5,$6,$7)',[episode(n),actualAccount,`Catalog ${n}`,n<=24?'script_review':'waiting_input',instant,n===29||n===30?instant:null,n<=12?seriesVersion:null]);
   if(n<=24)await client.query("INSERT INTO public.review_packages(episode_id,stage,revision_number,context_snapshot) VALUES($1,'script_review',1,'{}')",[episode(n)]);
  }
  const blockers=Array.from({length:25},(_,i)=>({code:`catalog-${String(i+1).padStart(2,'0')}`,detail:'Contract blocker'}));
  for(const [n,status,result,at]of [[1,'blocked',{blockers},'2026-01-01T01:00:00Z'],[2,'failed',{},'2026-01-01T02:00:00Z'],[3,'running',{},'2026-01-01T03:00:00Z'],[4,'completed',{},'2026-01-01T04:00:00Z']]as const){
   await client.query("INSERT INTO public.tasks(episode_id,task_type,status,last_result,created_at) VALUES($1,'generate_a_roll',$2,$3,$4)",[episode(n),status,result,at]);
  }
  await client.query("INSERT INTO public.artifacts(episode_id,artifact_type,relative_path,sha256,file_size) VALUES($1,'fixture','catalog/a.txt',repeat('a',64),1),($1,'fixture','catalog/b.txt',repeat('b',64),1)",[episode(1)]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 handler=createLocalHandler({pool,origin,mediaRoot:deployment.mediaRoot});
 const login=async(id:string)=>{
  const response=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:`catalog-${id}@example.invalid`,password})});
  assert.equal(response.status,200);return response.headers.get('set-cookie')!.split(';')[0];
 };
 ownerCookie=await login(owner);otherCookie=await login(otherOwner);
});

afterAll(async()=>{
 if(server.listening){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 await pool.end();await admin.end();for(const bridge of bridges)bridge.kill();
 // Fixture rows remain only in the explicitly disposable clone. Production and
 // historical data are not rewritten; every rerun uses independent identifiers.
});

async function compare(parameters:Record<string,string>={},other=false){
 const query=new URLSearchParams(parameters),response=await fetch(origin+'/api/local/catalog?'+query,{headers:{Cookie:other?otherCookie:ownerCookie}});
 expect(response.status).toBe(200);const native=await response.json();
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SELECT set_config('loop.owner_id',$1,true)",[other?otherOwner:owner]);
  const identity=(await client.query('SELECT current_user,session_user,local_identity.owner_id() owner')).rows[0];
  expect(identity).toEqual({current_user:'loop_app',session_user:'loop_app',owner:other?otherOwner:owner});
  const retained=(await client.query(`SELECT ${schema}.read_episode_catalog($1,$2,$3,$4,$5,$6,$7) catalog`,[parameters.view??'episodes',Number(parameters.page??1),parameters.accountId??null,parameters.seriesId??'all',parameters.visibility??'active',Number(parameters.pendingPage??1),Number(parameters.blockedPage??1)])).rows[0].catalog;
  expect(contract(native)).toEqual(retained);await client.query('COMMIT');return native;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

it('keeps stable ordering, bounded pages, totals and independent account summaries',async()=>{
 const first=await compare();expect(first.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(0,20));
 expect(first).toMatchObject({total:28,page:1,pageSize:20,episodeCount:30,reviewCount:24,accountCounts:{[accountA]:26,[accountB]:4},stages:{script_review:24,waiting_input:4},artifactCounts:{[episode(1)]:2}});
 const second=await compare({page:'2'});expect(second.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(20));
 const last=await compare({page:'999'});expect(last.page).toBe(2);expect(last.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(20));
 const accounts=await compare({view:'accounts'});expect(accounts.episodes).toEqual([]);expect(accounts.total).toBe(28);expect(accounts.accounts.map((a:{id:string})=>a.id).sort()).toEqual([accountA,accountB].sort());
});

it('preserves account, series, archived and review filters without changing global counts',async()=>{
 const byAccount=await compare({accountId:accountB});expect(byAccount.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(24));expect(byAccount.total).toBe(4);
 const bySeries=await compare({seriesId:series});expect(bySeries.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(0,12));expect(bySeries.total).toBe(12);
 const unassigned=await compare({seriesId:'unassigned'});expect(unassigned.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(12));expect(unassigned.total).toBe(16);
 expect((await compare({seriesId:'unavailable'})).total).toBe(0);
 const historical=await compare({visibility:'archived'});expect(historical.episodes.map((e:{id:string})=>e.id)).toEqual(archived);expect(historical.total).toBe(2);expect(historical.episodeCount).toBe(30);
 expect((await compare({visibility:'all',page:'2'})).episodes.map((e:{id:string})=>e.id)).toEqual([...active.slice(20),...archived]);
 const reviews=await compare({view:'reviews',visibility:'all',page:'2'});expect(reviews.total).toBe(24);expect(reviews.episodes.map((e:{id:string})=>e.id)).toEqual(active.slice(20,24));
});

it('keeps independently paged pending reviews, blockers and Worker summary',async()=>{
 const first=await compare({view:'operations'});expect(first.pending.total).toBe(24);expect(first.pending.items.map((e:{id:string})=>e.id)).toEqual(active.slice(0,20));
 expect(first.blocked.total).toBe(25);expect(first.blocked.items).toHaveLength(20);
 expect(first.worker).toMatchObject({running:1,blocked:1,failed:1,latestCompleted:true,latest:{task_type:'generate_a_roll',at:'2026-01-01T04:00:00+00:00'}});
 expect(first.operationRows.find((row:{episodeId:string})=>row.episodeId===episode(1))).toMatchObject({reviewRevision:1,reviewPending:true,blockerCount:25});
 const second=await compare({view:'operations',page:'2',pendingPage:'2',blockedPage:'2'});
 expect(second.pending.items.map((e:{id:string})=>e.id)).toEqual(active.slice(20,24));expect(second.pending.page).toBe(2);expect(second.blocked.items).toHaveLength(5);expect(second.blocked.page).toBe(2);
 expect(second.blocked.items.every((item:{episode:{id:string}})=>item.episode.id===episode(1))).toBe(true);
 const last=await compare({view:'operations',pendingPage:'999',blockedPage:'999'});expect(last.pending.page).toBe(2);expect(last.blocked.page).toBe(2);
});

it('isolates Owners and excludes non-Owner memberships through both actual database roles',async()=>{
 const own=await compare({},true);expect(own.episodes.map((e:{id:string})=>e.id)).toEqual([foreign]);expect(own.episodeCount).toBe(1);expect(own.accounts.map((a:{id:string})=>a.id)).toEqual([foreignAccount]);
 for(const [accountId,asOther]of [[foreignAccount,false],[accountA,true],[memberAccount,false]]as const){
  const hidden=await compare({accountId},asOther);expect(hidden.total).toBe(0);expect(hidden.episodes).toEqual([]);expect(hidden.pending.total).toBe(0);expect(hidden.blocked.total).toBe(0);
 }
 const unauthenticated=await fetch(origin+'/api/local/catalog');expect(unauthenticated.status).toBe(401);
 const invalid=await fetch(origin+'/api/local/catalog?view=invalid',{headers:{Cookie:ownerCookie}});expect(invalid.status).toBe(400);
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id',$1,true)",[owner]);
  expect((await client.query('SELECT id FROM public.episodes WHERE id=$1',[foreign])).rows).toEqual([]);
  expect((await client.query('SELECT count(*)::int n FROM public.episodes WHERE id=ANY($1::uuid[])',[[foreign,member]])).rows[0].n).toBe(1); // RLS permits members; catalog deliberately requires Owner.
  const publicRpc=(await client.query("SELECT to_regprocedure('public.read_episode_catalog(text,integer,uuid,text,text,integer,integer)') rpc")).rows[0].rpc;expect(publicRpc).toBeNull();
  await client.query('ROLLBACK');
  expect((await client.query('SELECT local_identity.owner_id() owner')).rows[0].owner).toBeNull();
  await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id','',true)");
  expect((await client.query('SELECT id FROM public.episodes LIMIT 1')).rows).toEqual([]);
  const anonymous=(await client.query(`SELECT ${schema}.read_episode_catalog() catalog`)).rows[0].catalog;
  expect(anonymous.episodes).toEqual([]);expect(anonymous.episodeCount).toBe(0);expect(anonymous.accountCounts).toEqual({});
  await client.query('ROLLBACK');
 }finally{client.release();}
});
