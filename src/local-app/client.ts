const inFlight=new Map<string,Promise<unknown>>();
let csrf='',sessionGeneration=0;
export async function localRequest(path:string,init?:RequestInit){
 if(path==='login'||path==='logout'){sessionGeneration++;csrf='';inFlight.clear();}
 const session=sessionGeneration;
 // HMR can reload this helper while the authenticated app remains mounted.
 // Restore a missing token before the mutation; never replay a rejected write.
 if(init?.method&&init.method.toUpperCase()!=='GET'&&path!=='login'&&!new Headers(init.headers).get('X-CSRF-Token')){
  if(!csrf)await localRequest('session');
  if(session!==sessionGeneration||!csrf)throw new Error('会话已变化，请重新打开后操作。');
  const headers=new Headers(init.headers);headers.set('X-CSRF-Token',csrf);init={...init,headers};
 }
 const response=await fetch('/api/local/'+path,init);const value=await response.json();
 init?.signal?.throwIfAborted();
 if(!response.ok){if(response.status===401&&path!=='login'&&session===sessionGeneration){sessionGeneration++;csrf='';inFlight.clear();window.dispatchEvent(new Event('loop-local-session-expired'));}throw Object.assign(new Error(String(value.error??'本机请求失败。').replaceAll('秘密','密钥')),{status:response.status,...(typeof value.code==='string'?{code:value.code}:{}),...(value.preflight?{preflight:value.preflight}:{})});}
 if(session===sessionGeneration&&typeof value.csrfToken==='string')csrf=value.csrfToken;return value;
}
export async function localCommand<T>(command:string,data:unknown,expectedRevision?:string,endpoint='configuration'):Promise<T>{
 const body={command,data,...(expectedRevision?{expectedRevision}:{})};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(endpoint==='configuration'?body:{endpoint,...body}))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const existing=inFlight.get(digest);if(existing)return existing as Promise<T>;
 const key='loop.local.pending.'+digest;
 let idempotencyKey=sessionStorage.getItem(key);if(!idempotencyKey){idempotencyKey=crypto.randomUUID();sessionStorage.setItem(key,idempotencyKey);}
 const operation={...body,idempotencyKey},recoverable=['configuration','episode-commands','episode-lifecycle','recycle-bin'].includes(endpoint)&&!['planRecyclePurge','retryDeletionCleanup','openDirectory','openStudio','openStandaloneStudio','openWorkspaceStudio'].includes(command);
 const pending=sessionStorage.getItem(key+'.uncertain')==='1';
 const unknown=(detail?:string)=>Object.assign(new Error((detail?detail+' ':'')+'本次操作结果暂未确认；请刷新核对已有任务或保存结果，不会自动重复执行。'),{code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 const readback=async()=>{
  const receipt=await localRequest('command-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,operation}),signal:AbortSignal.timeout(10000)});
  if(receipt.status!=='committed')throw unknown();return receipt.result;
 };
 const request=(async()=>{
  try{
   if(recoverable&&pending)return await readback();
   try{return await localRequest(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(operation)});}
   catch(error){
    const status=(error as {status?:number}).status;
    if(status&&status<500){sessionStorage.removeItem(key);throw error;}
    if(!recoverable)throw error;
    sessionStorage.setItem(key+'.uncertain','1');
    try{return await readback();}catch{throw unknown(status&&error instanceof Error?error.message:undefined);}
   }
  }catch(error){throw error;}
 })().then(value=>{sessionStorage.removeItem(key);sessionStorage.removeItem(key+'.uncertain');return value;}).finally(()=>inFlight.delete(digest));
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

/** Billing secrets stay in the request and component memory, never browser storage or a persisted digest. */
export async function localBillingCommand<T>(command:string,data:unknown,operationKey:string=crypto.randomUUID()):Promise<T>{
 const key='billing:'+operationKey,existing=inFlight.get(key);if(existing)return existing as Promise<T>;
 const request=localRequest('connection-billing',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,data,idempotencyKey:operationKey})}).finally(()=>inFlight.delete(key));
 inFlight.set(key,request);return request as Promise<T>;
}
