import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {Pool} from 'pg';
import {root,projectRoot,appPort,configuration,verifiedSource,docker,sql,writePrivateFile} from './environment.mjs';
const source=verifiedSource(),c=configuration(),base=`http://127.0.0.1:${appPort}`;
const owner=JSON.parse(readFileSync(join(source.stateRoot,'owner-644f8c5a-b668-48a3-8a25-94c4e502fa04.json')));
const auth=createClient(source.apiUrl,source.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await auth.auth.signInWithPassword({email:owner.email,password:owner.password});
if(error)throw Error('T12 test Owner login failed (details suppressed)');
const headers={Authorization:`Bearer ${data.session.access_token}`};
assert.equal((await fetch(`${base}/api/local/catalog`)).status,401);
assert.equal((await fetch(`${base}/api/local/catalog`,{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
assert.equal((await fetch(`${base}/api/local/catalog`,{method:'POST',headers})).status,405);
assert.equal((await fetch(`${base}/_episode-dispatch`,{method:'POST',headers})).status,404);
const response=await fetch(`${base}/api/local/catalog`,{headers});assert.equal(response.status,200);
assert.equal(response.headers.get('cache-control'),'no-store');
const catalog=await response.json();
const restoreRecord=JSON.parse(readFileSync(join(projectRoot,'docs/verification/stage-c-t11/stage-c-restore.json')));
const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort().map(([k,v])=>[k,normalize(v)])):typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():value;
const samples={};
for(const [key,table] of Object.entries({accounts:'accounts',blueprints:'account_blueprint_versions',episodes:'episodes',series:'series',seriesVersions:'series_versions'})){
 const predicate=table==='accounts'?`id in (select account_id from public.account_memberships where user_id='${owner.id}' and role='owner')`:`account_id in (select account_id from public.account_memberships where user_id='${owner.id}' and role='owner')`;
 const q=`select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.${table} t where ${predicate}`;
 const expected=JSON.parse(docker(['exec','supabase_db_loop-control-stage-b-verified','psql','-XqAt','-U','postgres','-d',restoreRecord.database,'-c',q]));
 assert.ok(JSON.stringify(normalize([...catalog[key]].sort((a,b)=>a.id.localeCompare(b.id))))===JSON.stringify(normalize(expected)), `HTTP ${key} differs from frozen backup sample`);
 samples[key]={count:expected.length,sampleIds:expected.slice(0,3).map(x=>x.id)};
}
// Real least-privilege connection cannot mutate or invoke legacy privileged RPCs.
const pool=new Pool(c.database);
try{
 await assert.rejects(pool.query("update public.accounts set name='unauthorized'"),e=>e.code==='42501');
 await assert.rejects(pool.query("select public.bootstrap_platform('no','no','UTC','{}')"),e=>e.code==='42501');
 const client=await pool.connect();
 try{
  await client.query('begin');await client.query("select set_config('loop.owner_id',$1,true)",[owner.id]);
  assert.equal((await client.query('select count(*) from public.accounts')).rows[0].count,String(catalog.accounts.length));
  await client.query('commit');
  assert.equal((await client.query('select count(*) from public.accounts')).rows[0].count,'0');
 }finally{client.release();}
}finally{await pool.end();}
// The underlying native instance has neither platform service schemas nor secrets.
assert.equal(sql("select count(*) from pg_namespace where nspname in ('auth','vault')"),'0');
assert.equal(sql("select count(*) from pg_constraint where contype='f' and confrelid='local_identity.owners'::regclass"),'21');
const result={ticket:118,passed:true,at:new Date().toISOString(),nativePostgres:true,sourceCreatedAt:catalog.sourceCreatedAt,importedAt:catalog.importedAt,samples,http:{anonymous:401,crossOrigin:403,write:405,unmigratedCommand:404,catalog:200},leastPrivilege:true,transactionIdentityCleared:true,authVaultSchemasAbsent:true,identityForeignKeys:21,identityBridge:'verified isolated Supabase Auth only; T13 removes this dependency',allBusinessReads:'native PostgreSQL; no fallback'};
writePrivateFile(join(root,'state/t12-http.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
