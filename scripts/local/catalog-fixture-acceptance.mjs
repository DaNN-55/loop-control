import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root,configuration,sql,writePrivateFile,env,container} from './environment.mjs';
import {createLocalDatabase,readLocalCatalog} from '../../dist/local-app/local-app/catalog.js';
import {createCatalogHandler} from '../../dist/local-app/local-app/catalogRoute.js';
const owner='644f8c5a-b668-48a3-8a25-94c4e502fa04',other=randomUUID(),series=randomUUID(),version=randomUUID();
const account=sql(`select account_id from public.account_memberships where user_id='${owner}' and role='owner' order by account_id limit 1`);
const pool=createLocalDatabase(configuration().database);
// Synthetic authentication here tests the HTTP/DB boundary only. Actual T12
// Supabase Owner authentication is separately exercised by catalog-acceptance.mjs.
const server=createServer(createCatalogHandler({origin:'http://127.0.0.1:55177',authenticate:async r=>r.headers.authorization==='fixture-owner'?owner:r.headers.authorization==='fixture-other'?other:null,catalog:id=>readLocalCatalog(pool,id)}));
try{
 sql(`begin;insert into local_identity.owners(id,email) values('${other}','t12-isolation@example.invalid');insert into public.series(id,account_id,name) values('${series}','${account}','T12 synthetic series');insert into public.series_versions(id,account_id,series_id,version,rules,created_by) values('${version}','${account}','${series}',1,'{"tone":"T12 synthetic"}','${owner}');commit;`);
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const a=await (await fetch(`${base}/api/local/catalog`,{headers:{Authorization:'fixture-owner'}})).json();
 assert.equal(a.series.find(s=>s.id===series)?.name,'T12 synthetic series');assert.deepEqual(a.seriesVersions.find(v=>v.id===version)?.rules,{tone:'T12 synthetic'});
 const b=await (await fetch(`${base}/api/local/catalog`,{headers:{Authorization:'fixture-other'}})).json();
 for(const key of ['accounts','blueprints','episodes','series','seriesVersions'])assert.equal(b[key].length,0);
 // Two app transactions retain independent identities and a stable snapshot
 // while a separate real writer commits a new version of the synthetic row.
 const ca=await pool.connect(),cb=await pool.connect();
 try{
  await ca.query('begin isolation level repeatable read read only');await cb.query('begin isolation level repeatable read read only');
  await ca.query("select set_config('loop.owner_id',$1,true)",[owner]);await cb.query("select set_config('loop.owner_id',$1,true)",[other]);
  assert.equal((await ca.query('select name from public.series where id=$1',[series])).rows[0].name,'T12 synthetic series');
  assert.equal((await cb.query('select name from public.series where id=$1',[series])).rowCount,0);
  sql(`update public.series set name='T12 committed concurrently' where id='${series}'`);
  assert.equal((await ca.query('select name from public.series where id=$1',[series])).rows[0].name,'T12 synthetic series');
  await ca.query('commit');await cb.query('commit');
  await ca.query('begin');await ca.query("select set_config('loop.owner_id',$1,true)",[owner]);
  assert.equal((await ca.query('select name from public.series where id=$1',[series])).rows[0].name,'T12 committed concurrently');await ca.query('commit');
 }finally{await ca.query('rollback');await cb.query('rollback');ca.release();cb.release();}
 // Real row-lock contention: the competitor must time out, never overwrite.
 const holder=spawn('docker',['exec','-i',container,'psql','-XqAt','-U','postgres','-d','loop_imported','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:holder.stdout});const ready=once(lines,'line');
 try{
  holder.stdin.write(`begin;select id from public.series where id='${series}' for update;\n`);
  await Promise.race([ready,once(holder,'exit').then(()=>{throw Error('Lock holder exited');})]);
  assert.throws(()=>sql(`begin;set local lock_timeout='150ms';update public.series set name='must not commit' where id='${series}';commit;`),e=>String(e.stderr).includes('lock timeout'));
 }finally{const done=once(holder,'exit');holder.stdin.end('rollback;\n');await done;lines.close();}
 const simultaneous=await Promise.all(Array.from({length:12},(_,i)=>fetch(`${base}/api/local/catalog`,{headers:{Authorization:i%2?'fixture-owner':'fixture-other'}}).then(r=>r.json())));
 simultaneous.forEach((r,i)=>assert.equal(r.accounts.length,i%2?a.accounts.length:0));
 const result={ticket:118,syntheticAuth:true,realHttp:true,realDatabase:true,populatedSeries:true,seriesVersionPreserved:true,otherOwnerSeesNoAccounts:true,concurrentHttpRequests:12,independentTransactionOwners:true,repeatableReadSnapshot:true,rowLockCompetitorTimedOut:true};writePrivateFile(join(root,'state/t12-series-isolation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 server.closeAllConnections();await new Promise(r=>server.close(()=>r()));await pool.end();
 sql(`begin;delete from public.series_versions where id='${version}';delete from public.series where id='${series}';delete from local_identity.owners where id='${other}';commit;`);
}
