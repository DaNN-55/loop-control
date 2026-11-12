// Normal authenticated Owner HTTP, used for read-only verification and explicit API edge cases.
import{readFile,writeFile}from'node:fs/promises';
import{join}from'node:path';
import{randomUUID}from'node:crypto';
import{csrfFor}from'../../../dist/local-app/local-app/sessions.js';
export async function client(){
 const privateRoot=join(process.cwd(),'.scratch/live-production'),origin='http://127.0.0.1:5217';
 let cookie;
 try{cookie=(JSON.parse(await readFile(join(privateRoot,'http-session.json'),'utf8'))).cookie;
  if(!(await fetch(origin+'/api/local/session',{headers:{Cookie:cookie}})).ok)cookie=undefined;
 }catch{}
 if(!cookie){
  const login=JSON.parse(await readFile(join(privateRoot,'login.json'),'utf8'));
  const r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:login.email,password:login.password})});
  if(!r.ok)throw Error('Isolated Owner login failed');cookie=r.headers.get('set-cookie').split(';')[0];
  await writeFile(join(privateRoot,'http-session.json'),JSON.stringify({cookie}),{mode:0o600});
 }
 const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(cookie.split('=')[1])};
 const request=async(path,body,overrides={})=>{const r=await fetch(origin+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),...overrides});return{status:r.status,body:await r.json()};};
 const get=async path=>{const r=await request(path);if(r.status!==200)throw Error(JSON.stringify(r));return r.body;};
 const command=(command,data,endpoint='episode-commands',key=randomUUID())=>request('/api/local/'+endpoint,{command,data,idempotencyKey:key});
 return{get,request,command,origin};
}
