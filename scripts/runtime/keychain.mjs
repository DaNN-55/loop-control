import{readFileSync,existsSync}from'node:fs';import{spawnSync}from'node:child_process';import{join}from'node:path';import{createHash}from'node:crypto';import{root,assertPrivatePath}from'./environment.mjs';
function invokePrivate(helper,args,body){const r=spawnSync(helper,args,{input:JSON.stringify(body),encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000,maxBuffer:65536});if(r.status!==0||r.stderr)throw Error('Local Keychain unavailable');const value=JSON.parse(r.stdout);if(value.ok!==true)throw Error('Local Keychain unavailable');return value;}
export function bootstrapKeychain(operation,secret){const helper=join(root,'native/keychain-bootstrap');assertPrivatePath(helper);return invokePrivate(helper,[],{operation,...(secret===undefined?{}:{secret})});}
export function resolveRuntimeSecretReference(reference,aliases={}){
 if(!aliases||typeof aliases!=='object'||Array.isArray(aliases))throw Error('Invalid runtime secret aliases');
 const seen=new Set();
 while(true){
  if(typeof reference!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(reference))throw Error('Invalid runtime secret reference');
  if(seen.has(reference))throw Error('Cyclic runtime secret aliases');seen.add(reference);
  if(!Object.hasOwn(aliases,reference))return reference;
  reference=aliases[reference];
 }
}
export function historicalLiteralValue(reference,descriptor,content){
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(!descriptor||!Number.isSafeInteger(descriptor.catalogBytes)||descriptor.catalogBytes>2*1024*1024||content.length!==descriptor.catalogBytes||hash(content)!==descriptor.catalogSha256)throw Error('Historical literal catalog mismatch');
 const catalog=JSON.parse(content),entry=catalog.entries?.[reference];
 if(catalog.version!==1||!['template-literals','history-literals'].includes(catalog.kind)||!Object.hasOwn(catalog.entries??{},reference)||typeof entry?.value!=='string'||Buffer.byteLength(entry.value)!==descriptor.valueBytes||hash(entry.value)!==descriptor.valueSha256)throw Error('Historical literal value mismatch');
 return entry.value;
}
export function runtimeSecret(reference){
 if(!/^[a-f0-9-]{36}$/.test(reference??''))throw Error('Invalid runtime secret reference');
 const indexPath=join(root,'secret-index.json');let index={};
 if(existsSync(indexPath)){assertPrivatePath(indexPath);index=JSON.parse(readFileSync(indexPath));}
 const aliases=index.referenceAliases??{};
 reference=resolveRuntimeSecretReference(reference,aliases);
 // Immutable historical markers keep their UUID; confirmed public literals no longer use Keychain.
 if(Object.hasOwn(index.historicalLiterals??{},reference)){
  const descriptor=index.historicalLiterals[reference];if(!/^[a-f0-9]{64}$/.test(descriptor?.catalogSha256??''))throw Error('Invalid historical literal catalog');
  const path=join(root,'history/content',descriptor.catalogSha256);assertPrivatePath(path);
  return historicalLiteralValue(reference,descriptor,readFileSync(path));
 }
 const settings=JSON.parse(readFileSync(join(root,'deployment.json'))),helper=join(root,'native/keychain-helper'),keychain=join(root,'keychain/loop-control.keychain-db');
 assertPrivatePath(helper);assertPrivatePath(keychain);
 if(createHash('sha256').update(readFileSync(helper)).digest('hex')!==settings.connections.keychain.helperSha256)throw Error('Keychain helper identity changed');
 const value=invokePrivate(helper,['--keychain',keychain],{operation:'get',reference});if(typeof value.secret!=='string'||!value.secret)throw Error('Runtime secret unavailable');return value.secret;
}
export function hydrateDeploymentSecrets(d){
 for(const key of ['database','workerDatabase'])if(d[key]?.passwordRef){if(d[key].password!==undefined)throw Error('Ambiguous database secret');d={...d,[key]:{...d[key],password:runtimeSecret(d[key].passwordRef)}};delete d[key].passwordRef;}
 return d;
}
export function keychainState(operation){const helper=join(root,'native/keychain-control');assertPrivatePath(helper);const invoke=body=>{const r=spawnSync(helper,[],{input:JSON.stringify(body),encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000});if(r.status!==0)throw Error('Daily application Keychain unavailable');return JSON.parse(r.stdout);};
 if(operation==='unlock'){if(!invoke({operation:'status'}).unlocked){let password=bootstrapKeychain('get').secret;invoke({operation:'unlock',password});password='';}}
 else if(operation==='lock')invoke({operation:'lock'});else throw Error('Unknown application Keychain operation');
}
