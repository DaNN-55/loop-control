import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';import{join}from'node:path';import{root,assertPrivatePath}from'./environment.mjs';
export function keychainState(operation){const helper=join(root,'native/keychain-control');assertPrivatePath(helper);const invoke=body=>{const r=spawnSync(helper,[],{input:JSON.stringify(body),encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:5000});if(r.status!==0)throw Error('Daily application Keychain unavailable');return JSON.parse(r.stdout);};
 if(operation==='unlock'){if(!invoke({operation:'status'}).unlocked){const file=join(root,'keychain-password-private.json');assertPrivatePath(file);let password=JSON.parse(readFileSync(file)).password;invoke({operation:'unlock',password});password='';}}
 else if(operation==='lock')invoke({operation:'lock'});else throw Error('Unknown application Keychain operation');
}
