import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root,configuration,sql,writePrivateFile} from './environment.mjs';
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
 const result={ticket:118,syntheticAuth:true,realHttp:true,realDatabase:true,populatedSeries:true,seriesVersionPreserved:true,otherOwnerSeesNoAccounts:true};writePrivateFile(join(root,'state/t12-series-isolation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 server.closeAllConnections();await new Promise(r=>server.close(()=>r()));await pool.end();
 sql(`begin;delete from public.series_versions where id='${version}';delete from public.series where id='${series}';delete from local_identity.owners where id='${other}';commit;`);
}
