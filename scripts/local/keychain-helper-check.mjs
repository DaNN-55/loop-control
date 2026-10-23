// Only the protocol-only binary is executed. It cannot link to Security APIs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,chmodSync,mkdirSync,openSync,closeSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url)),build=join(project,'.loop-control/stage-d/native');
mkdirSync(build,{recursive:true,mode:0o700});chmodSync(build,0o700);
const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:process.env.TMPDIR??'/tmp',CLANG_MODULE_CACHE_PATH:join(build,'module-cache')};
function run(command,args,input){const result=spawnSync(command,args,{env,input,encoding:'utf8',timeout:30000,maxBuffer:131072});if(result.error)throw Error('Local helper tool failed');return result;}
const source=join(project,'native/keychain-helper.m'),candidate=join(build,'keychain-helper'),protocol=join(build,'keychain-protocol-only');
for(const [target,flags] of [[candidate,[]],[protocol,['-DLOOP_KEYCHAIN_PROTOCOL_ONLY=1']]]){
 const result=run('/usr/bin/xcrun',['clang','-fobjc-arc','-Wall','-Wextra','-Werror',...flags,source,'-framework','Foundation','-framework','Security','-o',target]);
 assert.equal(result.status,0,result.stderr);chmodSync(target,0o700);
}
const symbols=run('/usr/bin/nm',['-u',protocol]);assert.equal(symbols.status,0);assert.doesNotMatch(symbols.stdout,/SecItem|SecKeychain|LAContext/,'executed protocol binary must have no Keychain API imports');
const reference=randomUUID(),secret='synthetic-protocol-only-secret-never-stored';let checked=0;
function check(input,args,code,ok=false){
 const result=run(protocol,args,typeof input==='string'?input:JSON.stringify(input));
 assert.equal(result.stderr,'');assert(!result.stdout.includes(secret),'protocol must never echo secret');
 const output=JSON.parse(result.stdout);assert.equal(output.code,code);assert.equal(output.ok,ok);assert.equal(result.status,ok?0:1);checked++;
}
for(const operation of ['put','get','remove'])check({operation,reference,...(operation==='put'?{secret}:{})},['--validate-only'],'validated',true);
for(const input of ['', 'null','[]','{',JSON.stringify({operation:'get',reference,secret}),JSON.stringify({operation:'put',reference,secret:''}),JSON.stringify({operation:'put',reference,secret:'x'.repeat(16385)}),JSON.stringify({operation:'get',reference:'../../other-service'}),JSON.stringify({operation:'list',reference}),JSON.stringify({operation:'get',reference,service:'other'}),JSON.stringify({operation:'put',reference,secret:42}),' '.repeat(65537)])check(input,['--validate-only'],'invalid_request');
check({operation:'get',reference},[],'disabled');
check({operation:'get',reference},['--keychain'],'disabled');
check({operation:'get',reference},['--validate-only','unexpected'],'disabled');
// Ordinary files must be rejected at the exact IPC seam also used by the
// candidate. These files contain only a nonsecret get request/error response.
const inputPath=join(build,'protocol-input.json'),outputPath=join(build,'protocol-output.json');
writeFileSync(inputPath,JSON.stringify({operation:'get',reference}),{mode:0o600});
let fd=openSync(inputPath,'r');
try{const result=spawnSync(protocol,['--validate-only'],{env,encoding:'utf8',stdio:[fd,'pipe','pipe'],timeout:10000});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).code,'pipe_required');assert.equal(result.stderr,'');checked++;}finally{closeSync(fd);rmSync(inputPath);}
fd=openSync(outputPath,'w',0o600);
try{const result=spawnSync(protocol,['--validate-only'],{env,input:JSON.stringify({operation:'get',reference}),stdio:['pipe',fd,'pipe'],timeout:10000});assert.equal(result.status,1);assert.equal(JSON.parse(readFileSync(outputPath,'utf8')).code,'pipe_required');assert.equal(String(result.stderr),'');checked++;}finally{closeSync(fd);rmSync(outputPath);}
const evidence={ticket:121,at:new Date().toISOString(),candidateCompiled:true,candidateExecuted:false,protocolCases:checked,nodeStdioPipeAccepted:true,regularInputAndOutputFilesRejected:true,protocolBinaryHasNoKeychainImports:true,realKeychainOperations:0,providerCalls:0,sha256:createHash('sha256').update(readFileSync(candidate)).digest('hex'),passed:true};
writeFileSync(join(project,'docs/verification/stage-d-t15/protocol.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
