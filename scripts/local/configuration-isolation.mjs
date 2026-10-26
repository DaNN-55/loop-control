import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {hashPassword} from '../../dist/local-app/local-app/password.js';
import {root,appPort,sql,writePrivateFile} from './environment.mjs';
const id=randomUUID(),password=randomBytes(32).toString('hex'),email=`t13-${id}@example.invalid`,digest=await hashPassword(password),base=`http://127.0.0.1:${appPort}`;
try{
 sql(`begin;insert into local_identity.owners(id,email) values('${id}','${email}');insert into local_identity.credentials(owner_id,password_digest) values('${id}','${JSON.stringify(digest)}');commit;`);
 const login=await fetch(base+'/api/local/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken;
 const main='644f8c5a-b668-48a3-8a25-94c4e502fa04';
 const artifact=JSON.parse(sql(`select to_jsonb(a) from public.artifacts a join public.episodes e on e.id=a.episode_id where exists(select 1 from public.account_memberships m where m.account_id=e.account_id and m.user_id='${main}' and m.role='owner') order by a.id limit 1`));
 const catalog=await (await fetch(base+'/api/local/catalog',{headers:{Cookie:cookie}})).json();assert.equal(catalog.accounts.length,0);assert.equal(catalog.episodes.length,0);
 assert.equal((await fetch(base+'/api/local/episodes/'+artifact.episode_id,{headers:{Cookie:cookie}})).status,404);
 assert.equal((await fetch(base+'/api/local/artifacts/'+artifact.id,{headers:{Cookie:cookie}})).status,404);
 assert.ok(!readFileSync(join(root,'logs/app.log'),'utf8').includes(password));
 const fixture=JSON.parse(readFileSync(join(root,'state/t14-http.json')));
 const denied=await fetch(base+'/api/local/configuration',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command:'renameAccount',idempotencyKey:randomUUID(),data:{accountId:fixture.accountId,name:'must not rename'}})});assert.equal(denied.status,404);
 const result={ticket:120,crossOwnerCommand:404,realLocalLogin:true,syntheticUnrelatedOwner:true,unrelatedOwnerAccounts:0,crossOwnerEpisode:404,crossOwnerArtifact:404,secretAbsentFromAppLog:true};writePrivateFile(join(root,'state/t14-isolation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{sql(`begin;delete from local_identity.sessions where owner_id='${id}';delete from local_identity.credentials where owner_id='${id}';delete from local_identity.owners where id='${id}';commit;`);}
