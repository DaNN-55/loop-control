import {spawn} from 'node:child_process';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {SecretStoreError,disabledSecretStore,type SecretStore} from './connectionPorts.js';
interface KeychainConfiguration {approved:boolean;runtimeRoot:string;helperSha256:string}
// Deployment-only configuration. HTTP/UI can never enable or select this port.
export function configuredKeychainStore(config:KeychainConfiguration):SecretStore{
 if(!config.approved)return disabledSecretStore;
 const helper=join(config.runtimeRoot,'native/keychain-helper'),keychain=join(config.runtimeRoot,'keychain/t15-synthetic.keychain-db');
 async function validate(){
  try{
   for(const path of [config.runtimeRoot,join(config.runtimeRoot,'native'),join(config.runtimeRoot,'keychain'),helper,keychain]){
    const info=await lstat(path);if(info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||await realpath(path)!==path)throw Error();
   }
   if(!(await lstat(helper)).isFile()||!(await lstat(keychain)).isFile()||!config.runtimeRoot.endsWith('/.loop-control/stage-d'))throw Error();
   if(createHash('sha256').update(await readFile(helper)).digest('hex')!==config.helperSha256)throw Error();
  }catch{throw new SecretStoreError('unavailable');}
 }
 async function invoke(operation:'put'|'get',reference:string,secret?:string):Promise<{code:string;secret?:string}>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reference))throw new SecretStoreError('unavailable');
  await validate();
  return new Promise((resolve,reject)=>{
   const child=spawn(helper,['--keychain',keychain],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
   let output='',invalid=false;
   const fail=()=>{invalid=true;child.kill();};
   const timer=setTimeout(fail,5000);
   child.stdout.on('data',chunk=>{output+=String(chunk);if(Buffer.byteLength(output)>65536)fail();});
   child.stderr.on('data',fail);child.stdin.on('error',()=>{invalid=true;});
   child.once('error',()=>{clearTimeout(timer);reject(new SecretStoreError('unavailable'));});
   child.once('close',status=>{
    clearTimeout(timer);
    try{
     if(invalid)throw Error();const value=JSON.parse(output);
     if(status===0&&value.ok===true&&value.code===(operation==='get'?'resolved':'stored')&&(operation!=='get'||typeof value.secret==='string'&&Buffer.byteLength(value.secret)>0&&Buffer.byteLength(value.secret)<=16384)){resolve(value);return;}
     if(value.ok===false&&status===1){const code=value.code==='missing'?'missing':value.code==='locked_or_denied'?'denied':value.code==='already_exists'?'conflict':'unavailable';reject(new SecretStoreError(code));return;}
     throw Error();
    }catch{reject(new SecretStoreError('unavailable'));}
   });
   child.stdin.end(JSON.stringify({operation,reference,...(secret===undefined?{}:{secret})}));
  });
 }
 return {mode:'keychain',async get(reference){return (await invoke('get',reference)).secret!;},async putImmutable(reference,secret){
  if(!secret||Buffer.byteLength(secret)>4096)throw new SecretStoreError('unavailable');
  try{await invoke('put',reference,secret);}catch(error){
   if(!(error instanceof SecretStoreError)||error.code!=='conflict')throw error;
   const existing=(await invoke('get',reference)).secret!;
   const hash=(value:string)=>createHash('sha256').update(value).digest();
   if(!timingSafeEqual(hash(existing),hash(secret)))throw new SecretStoreError('conflict');
  }
 }};
}
