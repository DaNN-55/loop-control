const inFlight=new Map<string,Promise<unknown>>();
let csrf='';
export async function localRequest(path:string,init?:RequestInit){
 const response=await fetch('/api/local/'+path,init);const value=await response.json();
 if(!response.ok)throw new Error(value.error??'本机请求失败。');
 if(typeof value.csrfToken==='string')csrf=value.csrfToken;return value;
}
export async function localCommand<T>(command:string,data:unknown,expectedRevision?:string):Promise<T>{
 const body={command,data,...(expectedRevision?{expectedRevision}:{})};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const existing=inFlight.get(digest);if(existing)return existing as Promise<T>;
 const key='loop.local.pending.'+digest;
 let idempotencyKey=sessionStorage.getItem(key);if(!idempotencyKey){idempotencyKey=crypto.randomUUID();sessionStorage.setItem(key,idempotencyKey);}
 const request=localRequest('configuration',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({...body,idempotencyKey})}).then(value=>{sessionStorage.removeItem(key);return value;}).finally(()=>inFlight.delete(digest));
 inFlight.set(digest,request);return request as Promise<T>;
}
