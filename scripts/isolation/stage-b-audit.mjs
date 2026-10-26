import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {config,env,sql,inventorySql,digest,readBackup} from './backup.mjs';
import {securityInventorySql} from './security-inventory.mjs';
import {targetConfiguration,targetContainer,targetId} from './restore.mjs';
import {writePrivateFile,projectRoot} from './environment.mjs';
const c=targetConfiguration(),{root}=JSON.parse(readFileSync(join(config.stateRoot,'latest-backup.json'))),m=readBackup(root);
assert.deepEqual(JSON.parse(sql(inventorySql())),m.inventory);
assert.deepEqual(JSON.parse(sql(securityInventorySql())),m.schemaSecurity);
const sourceSecrets=JSON.parse(sql("select coalesce(json_agg(decrypted_secret),'[]') from vault.decrypted_secrets"));
const owner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json')));
const plain=execFileSync('docker',['exec','-i',targetContainer,'pg_restore','--file=-'],{env,input:readFileSync(join(root,'business.dump')),maxBuffer:64*1024*1024});
const evidenceFiles=[];
function scan(path){for(const name of readdirSync(path)){const p=join(path,name);if(statSync(p).isDirectory())scan(p);else evidenceFiles.push(p);}}
scan(join(projectRoot,'docs/verification/stage-b'));
for(const secret of [...sourceSecrets,owner.password]){assert.ok(!plain.includes(Buffer.from(secret)));for(const p of evidenceFiles)assert.ok(!readFileSync(p).includes(Buffer.from(secret)),`secret found in ${p}`);}
const production=execFileSync('git',['-C','/Users/dan/Programs/loop-control','status','--short'],{encoding:'utf8'}).trim();assert.equal(production,'?? docs/architecture-map/');
const productionBranch=execFileSync('git',['-C','/Users/dan/Programs/loop-control','branch','--show-current'],{encoding:'utf8'}).trim();assert.equal(productionBranch,'codex/project-architecture-map');
const listeners=execFileSync('lsof',['-nP','-iTCP:5173','-iTCP:5678','-sTCP:LISTEN','-t'],{encoding:'utf8'}).trim().split(/\s+/).sort();assert.deepEqual(listeners,['28387','28388']);
const network=execFileSync('lsof',['-nP','-iTCP:55173','-iTCP:55174','-iTCP:55175','-iTCP:55176','-iTCP:55431','-iTCP:55432','-iTCP:55441','-iTCP:55442','-iTCP:55451','-iTCP:55452','-iTCP:55461','-iTCP:55462','-sTCP:LISTEN'],{encoding:'utf8'});for(const line of network.split('\n').slice(1).filter(Boolean))assert.match(line,/TCP 127\.0\.0\.1:/);
const requiredPorts=[config.ports.console,config.ports.api,config.ports.database,c.ports.console,c.ports.api,c.ports.database];for(const port of requiredPorts)assert.ok(network.includes(`127.0.0.1:${port} `),`expected source/final listener ${port}`);
const result={checkedAt:new Date().toISOString(),sourceDataMatchesBackup:true,sourceSecurityMatchesBackup:true,sourceTables:Object.keys(m.inventory).length,sourceRows:Object.values(m.inventory).reduce((n,t)=>n+t.count,0),sourceMigrations:Number(sql('select count(*) from supabase_migrations.schema_migrations')),target:targetId,targetMigrations:Number(sql('select count(*) from supabase_migrations.schema_migrations',targetContainer)),allSourceVaultSecretsExcluded:true,sourcePasswordExcluded:true,reviewedEvidenceFiles:evidenceFiles.length,productionBranch,productionPids:listeners,productionStatus:production,allTestListenersLoopback:true,requiredListeningPorts:requiredPorts,finalBackupArchiveSha256:m.archiveSha256,mediaFiles:m.media.length};
writePrivateFile(join(c.stateRoot,'boundary-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
