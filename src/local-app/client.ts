const inFlight=new Map<string,Promise<unknown>>();
let csrf='',sessionGeneration=0;
export async function localRequest(path:string,init?:RequestInit){
 if(path==='login'||path==='logout'){sessionGeneration++;csrf='';inFlight.clear();}
 const session=sessionGeneration;
 const response=await fetch('/api/local/'+path,init);const value=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.error??'本机请求失败。'),value.preflight?{preflight:value.preflight}:{});
 if(session===sessionGeneration&&typeof value.csrfToken==='string')csrf=value.csrfToken;return value;
}
export async function localCommand<T>(command:string,data:unknown,expectedRevision?:string,endpoint='configuration'):Promise<T>{
 const body={command,data,...(expectedRevision?{expectedRevision}:{})};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(endpoint==='configuration'?body:{endpoint,...body}))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const existing=inFlight.get(digest);if(existing)return existing as Promise<T>;
 const key='loop.local.pending.'+digest;
 let idempotencyKey=sessionStorage.getItem(key);if(!idempotencyKey){idempotencyKey=crypto.randomUUID();sessionStorage.setItem(key,idempotencyKey);}
 const request=localRequest(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({...body,idempotencyKey})}).then(value=>{sessionStorage.removeItem(key);return value;}).finally(()=>inFlight.delete(digest));
 inFlight.set(digest,request);return request as Promise<T>;
}
export async function localConnectionCommand<T>(command:string,data:Record<string,unknown>,resumeKey?:string):Promise<T>{
 // Persist only a random intent ID under NONSECRET metadata. Neither plaintext
 // nor a low-entropy secret hash belongs in browser storage.
 const metadata={command,data:Object.fromEntries(Object.entries(data).filter(([key])=>key!=='secret'))};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(metadata))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const storageKey='loop.local.connection.'+digest;
 const active=inFlight.get(storageKey);if(active)return active as Promise<T>;
 let idempotencyKey=resumeKey??sessionStorage.getItem(storageKey);if(!idempotencyKey)idempotencyKey=crypto.randomUUID();sessionStorage.setItem(storageKey,idempotencyKey);
 const request=localRequest('connections',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,data,idempotencyKey})}).then(value=>{sessionStorage.removeItem(storageKey);return value;}).finally(()=>inFlight.delete(storageKey));
 inFlight.set(storageKey,request);return request as Promise<T>;
}
