import{readFileSync,existsSync,writeFileSync}from'node:fs';
import{join}from'node:path';import{randomUUID,createHash,timingSafeEqual}from'node:crypto';import{spawnSync}from'node:child_process';
import{root,assertPrivatePath}from'./environment.mjs';import{runtimeSecret,keychainState}from'./keychain.mjs';
const indexPath=()=>join(root,'secret-index.json');
export function secretIndex(){const p=indexPath();assertPrivatePath(p);return existsSync(p)?JSON.parse(readFileSync(p)):{version:1,entries:{}};}
const hash=s=>createHash('sha256').update(s).digest();
export function putNamedSecret(name,value){
 if(typeof name!=='string'||!name||name.length>2048||typeof value!=='string'||!value||Buffer.byteLength(value)>16384)throw Error('Invalid local secret');
 const index=secretIndex(),old=index.entries[name]??index.nameAliases?.[name]??index.historicalNameAliases?.[name];
 if(old&&timingSafeEqual(hash(runtimeSecret(old.reference)),hash(value)))return old.reference;
 const settings=JSON.parse(readFileSync(join(root,'deployment.json'))),helper=join(root,'native/keychain-helper'),keychain=join(root,'keychain/loop-control.keychain-db');assertPrivatePath(helper);assertPrivatePath(keychain);
 if(createHash('sha256').update(readFileSync(helper)).digest('hex')!==settings.connections.keychain.helperSha256)throw Error('Keychain helper changed');
 const reference=randomUUID(),r=spawnSync(helper,['--keychain',keychain],{input:JSON.stringify({operation:'put',reference,secret:value}),encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000,maxBuffer:65536});
 if(r.status!==0||r.stderr||JSON.parse(r.stdout).code!=='stored'||!timingSafeEqual(hash(runtimeSecret(reference)),hash(value)))throw Error('Local secret storage verification failed');
 index.entries[name]={reference,...(old?{previous:[...(old.previous??[]),old.reference]}:{}),updatedAt:new Date().toISOString()};
 if(index.nameAliases)delete index.nameAliases[name];
 if(index.historicalNameAliases)delete index.historicalNameAliases[name];
 writeFileSync(indexPath(),JSON.stringify(index,null,2)+'\n',{mode:0o600});return reference;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const args=process.argv.slice(2),index=secretIndex();
 if(args.length===0)for(const[name,value]of Object.entries(index.entries))console.log(JSON.stringify({name,reference:value.reference}));
 else if(args.length===2&&args[0]==='--copy'&&(index.entries[args[1]]??index.nameAliases?.[args[1]])){keychainState('unlock');const r=spawnSync('/usr/bin/pbcopy',[],{input:runtimeSecret((index.entries[args[1]]??index.nameAliases[args[1]]).reference),stdio:['pipe','ignore','pipe'],timeout:5000});if(r.status!==0)throw Error('Clipboard unavailable');console.log('已复制所选秘密；未在终端显示。');}
 else throw Error('Use npm run secrets:list or npm run secrets:copy -- <name>');
}
