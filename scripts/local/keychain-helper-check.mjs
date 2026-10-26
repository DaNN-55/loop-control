// Only the protocol-only binary is executed. It cannot link to Security APIs.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,chmodSync,mkdirSync,openSync,closeSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url)),build=join(project,'.loop-control/stage-d/native');
mkdirSync(build,{recursive:true,mode:0o700});chmodSync(build,0o700);
const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:process.env.TMPDIR??'/tmp',CLANG_MODULE_CACHE_PATH:join(build,'module-cache')};
function run(command,args,input){const result=spawnSync(command,args,{env,input,encoding:'utf8',timeout:30000,maxBuffer:131072});if(result.error)throw Error('Local helper tool failed');return result;}
const source=join(project,'native/keychain-helper.m'),candidate=join(build,'keychain-helper'),protocol=join(build,'keychain-protocol-only');
const evidencePath=process.argv[2]?resolve(process.argv[2]):join(project,'docs/verification/stage-d-t15/protocol.json');
if(process.argv[2]&&!evidencePath.startsWith(join(project,'.loop-control/stage-d/state/')))throw Error('Alternate evidence must remain in the private D state directory');
for(const [target,flags] of [[candidate,[]],[protocol,['-DLOOP_KEYCHAIN_PROTOCOL_ONLY=1']]]){
 const keychain=join(project,'.loop-control/stage-d/keychain/t15-synthetic.keychain-db');
 const result=run('/usr/bin/xcrun',['clang','-fobjc-arc','-Wall','-Wextra','-Werror','-DLOOP_KEYCHAIN_PATH='+JSON.stringify(keychain),...flags,source,'-framework','Foundation','-framework','Security','-o',target]);
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
// Exercise the actual deployment adapter's asynchronous spawn/end seam.
for(const operation of ['put','get','remove']){
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(protocol,['--validate-only'],{env,stdio:['pipe','pipe','pipe']});let output='',diagnostics='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Async IPC timed out'));},5000);
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>diagnostics+=chunk);child.stdin.on('error',()=>{});
  child.once('error',reject);child.once('close',status=>{clearTimeout(timer);resolve({status,output,diagnostics});});
  child.stdin.end(JSON.stringify({operation,reference,...(operation==='put'?{secret}:{})}));
 });
 assert.equal(result.diagnostics,'');assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.output),{ok:true,code:'validated'});assert(!result.output.includes(secret));checked++;
}
// Real negative descriptors: closed/unconnected local sockets must not turn
// into accepted inputs; a connected loopback TCP stream is still not IPC.
const fixtureSource=join(build,'ipc-negative.c'),fixture=join(build,'ipc-negative');
writeFileSync(fixtureSource,`#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <string.h>
int main(int argc,char **argv){
 if(argc!=3)return 2;int fd=-1;
 if(!strcmp(argv[2],"unconnected"))fd=socket(AF_UNIX,SOCK_STREAM,0);
 if(!strcmp(argv[2],"datagram")){int p[2];if(socketpair(AF_UNIX,SOCK_DGRAM,0,p))return 3;fd=p[0];}
 if(!strcmp(argv[2],"tcp")){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);socklen_t n=sizeof(a);if(bind(s,(struct sockaddr*)&a,n)||listen(s,1)||getsockname(s,(struct sockaddr*)&a,&n))return 4;int c=socket(AF_INET,SOCK_STREAM,0);if(connect(c,(struct sockaddr*)&a,n))return 5;fd=accept(s,0,0);}
 if(fd<0||dup2(fd,0)<0)return 6;execl(argv[1],argv[1],"--validate-only",(char*)0);return 7;
}\n`,{mode:0o600});
const fixtureBuild=run('/usr/bin/xcrun',['clang','-Wall','-Wextra','-Werror',fixtureSource,'-o',fixture]);assert.equal(fixtureBuild.status,0,fixtureBuild.stderr);chmodSync(fixture,0o700);
for(const kind of ['unconnected','datagram','tcp']){const result=run(fixture,[protocol,kind],'{}');assert.equal(result.stderr,'');assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{ok:false,code:'pipe_required'});checked++;}
const evidence={ticket:121,at:new Date().toISOString(),candidateCompiled:true,candidateExecuted:false,protocolCases:checked,nodeStdioPipeAccepted:true,asynchronousNodeStdioAccepted:true,regularInputAndOutputFilesRejected:true,protocolBinaryHasNoKeychainImports:true,realKeychainOperations:0,providerCalls:0,sha256:createHash('sha256').update(readFileSync(candidate)).digest('hex'),passed:true};
writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
