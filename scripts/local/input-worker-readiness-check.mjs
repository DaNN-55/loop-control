// Real bad-password readiness check against the same isolated DB. No Provider I/O.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {root,projectRoot,configuration,sql} from './environment.mjs';
import {createLocalDatabase} from '../../dist/local-app/local-app/catalog.js';
import {createWorkerDatabase,assertNativeWorkerDatabase} from '../../dist/local-app/local-app/workerDatabase.js';
import {startNativeWorkerService} from '../../dist/local-app/local-app/localWorkerService.js';
import {LocalEpisodeCommands} from '../../dist/local-app/local-app/episodeCommands.js';
import {ConfigurationError} from '../../dist/local-app/local-app/configurationCommands.js';
import {createLocalHandler} from '../../dist/local-app/local-app/localRoute.js';
const run=join(root,'state/t16-20261024'),fixture=JSON.parse(readFileSync(join(run,'fixture.json'))),boundary=JSON.parse(readFileSync(join(run,'boundary-result.json'))),good=JSON.parse(readFileSync(join(root,'worker-database.json'))),bad={...good,password:randomBytes(32).toString('hex')};
const {host,port,database}=configuration().database,applicationDatabase={host,port,database},base={projectRoot,applicationDatabase,mediaRoot:join(root,'media'),mountPath:fixture.mountPath,minimumFreeBytes:0,concurrency:1,actualCostCents:0,visualCommand:[process.execPath,join(run,'fixture-visual.mjs')],environment:{PATH:process.env.PATH,HOME:join(run,'home')}};
let startupRejected=false,bindingRejected=false;
try{await startNativeWorkerService({...base,database:bad});}catch(e){assert.equal(e.status,503);assert.match(e.message,/Worker数据库/);startupRejected=true;}
try{await startNativeWorkerService({...base,database:{...good,port:good.port+1}});}catch(e){assert.match(e.message,/绑定不一致/);bindingRejected=true;}
assert(startupRejected&&bindingRejected);
for(const pool of [createLocalDatabase(configuration().database),createWorkerDatabase(good)]){
 try{const pid=(await pool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  assert.equal(sql(`select pg_terminate_backend(${Number(pid)})`),'t');
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal((await pool.query('SELECT 1 ready')).rows[0].ready,1);
 }finally{await pool.end();}
}
const app=createLocalDatabase(configuration().database),worker=createWorkerDatabase(bad),server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
let activeWorker=worker;
const goodWorker=createWorkerDatabase(good);
const episodes=new LocalEpisodeCommands(app,join(root,'media'),{mountPath:fixture.mountPath,minimumFreeBytes:0,async ready(){try{await assertNativeWorkerDatabase(activeWorker,database);}catch{throw new ConfigurationError(503,'Worker数据库连接或身份检查失败，请检查本机Worker配置。');}},wake(){throw Error('Must not wake on failed preflight');},async checkReferences(){throw Error('Not used');}});
server.on('request',createLocalHandler({origin,pool:app,mediaRoot:join(root,'media'),episodes}));
const before=sql(`select jsonb_build_object('count',(select count(*) from public.episodes where account_id='${fixture.accountId}'),'episode',(select to_jsonb(e) from public.episodes e where id='${boundary.episodeId}'),'enabled',(select enabled from local_identity.input_episodes where episode_id='${boundary.episodeId}'))`);
let headers;try{
 const r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:readFileSync(join(root,'state/t13-owner.json'),'utf8')});assert.equal(r.status,200);headers={Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrfToken};
 for(const [command,data]of [['create',{accountId:fixture.accountId,title:'Wrong Worker password'}],['start',{episodeId:boundary.episodeId}]]){const response=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:randomUUID()})}),value=await response.json();assert.equal(response.status,503);assert.match(value.error,/Worker数据库/);assert.equal(value.preflight.version,'worker-preflight/v2');assert.equal(value.preflight.checks[0].scope,'worker');}
 activeWorker=goodWorker;
 sql('REVOKE EXECUTE ON FUNCTION local_identity.plan_input_tasks(uuid) FROM loop_worker');
 try{
  await assert.rejects(startNativeWorkerService({...base,database:good}),e=>e.status===503);
  for(const [command,data]of [['create',{accountId:fixture.accountId,title:'Missing planner permission'}],['start',{episodeId:boundary.episodeId}]]){const response=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command,data,idempotencyKey:randomUUID()})}),value=await response.json();assert.equal(response.status,503);assert.equal(value.preflight.version,'worker-preflight/v2');}
 }finally{sql('GRANT EXECUTE ON FUNCTION local_identity.plan_input_tasks(uuid) TO loop_worker');}
 const after=sql(`select jsonb_build_object('count',(select count(*) from public.episodes where account_id='${fixture.accountId}'),'episode',(select to_jsonb(e) from public.episodes e where id='${boundary.episodeId}'),'enabled',(select enabled from local_identity.input_episodes where episode_id='${boundary.episodeId}'))`);assert.equal(after,before);
 writeFileSync(join(run,'worker-readiness-result.json'),JSON.stringify({at:new Date().toISOString(),appAndWorkerIdleDisconnectRecovered:true,missingPlannerPrivilegeStartupAndCreateStart503:true,actualNativePostgresBadPassword:true,startupRejected,bindingRejectedBeforePoolCreation:bindingRejected,create503:true,start503:true,currentPreflightVersion:'worker-preflight/v2',actionableWorkerScope:true,episodeAndActivationUnchanged:true,noEpisodeCreated:true,noWake:true,noOnlineRequests:true,passed:true},null,2)+'\n',{mode:0o600});console.log({passed:true,startupRejected,bindingRejected,createAndStart503:true});
}finally{if(headers)await fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});server.closeAllConnections();await new Promise(r=>server.close(r));await app.end();await worker.end();await goodWorker.end();}
