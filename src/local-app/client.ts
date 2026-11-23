import {episodeBatchLifecycleCommand} from './episodeBatchLifecycleTypes';

const inFlight=new Map<string,Promise<unknown>>();
let csrf='',ownerScope='',sessionGeneration=0;
function requestNotSent(cause:unknown){return Object.assign(new Error(cause instanceof Error?cause.message:'会话确认失败，请重试。',{cause}),cause instanceof Error?cause:{},{requestSent:false});}
async function prepareMutationSession(generation:number){
 try{if(!csrf)await localRequest('session');if(generation!==sessionGeneration||!csrf)throw Error('会话已变化，请重新打开后操作。');return ownerScope;}
 catch(cause){throw requestNotSent(cause);}
}
export async function localRequest(path:string,init?:RequestInit){
 if(path==='login'||path==='logout'){sessionGeneration++;csrf='';ownerScope='';inFlight.clear();}
 const session=sessionGeneration;
 // HMR can reload this helper while the authenticated app remains mounted.
 // Restore a missing token before the mutation; never replay a rejected write.
 if(init?.method&&init.method.toUpperCase()!=='GET'&&path!=='login'&&!new Headers(init.headers).get('X-CSRF-Token')){
  // A failed session read precedes the requested mutation's fetch.
  await prepareMutationSession(session);
  const headers=new Headers(init.headers);headers.set('X-CSRF-Token',csrf);init={...init,headers};
 }
 const response=await fetch('/api/local/'+path,init);const value=await response.json();
 init?.signal?.throwIfAborted();
 if(!response.ok){if(response.status===401&&path!=='login'&&session===sessionGeneration){sessionGeneration++;csrf='';ownerScope='';inFlight.clear();window.dispatchEvent(new Event('loop-local-session-expired'));}throw Object.assign(new Error(String(value.error??'本机请求失败。').replaceAll('秘密','密钥')),{status:response.status,...(typeof value.code==='string'?{code:value.code}:{}),...(value.preflight?{preflight:value.preflight}:{})});}
 if(session===sessionGeneration&&value!==null){if(typeof value.csrfToken==='string')csrf=value.csrfToken;if((path==='session'||path==='login')&&typeof value.owner?.id==='string')ownerScope=value.owner.id;if(path==='logout'){csrf='';ownerScope='';}}return value;
}
export async function localCommand<T>(command:string,data:unknown,expectedRevision?:string,endpoint='configuration'):Promise<T>{
 const generation=sessionGeneration;
 const body={command,data,...(expectedRevision?{expectedRevision}:{})};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(endpoint==='configuration'?body:{endpoint,...body}))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const unknown=(detail?:string)=>Object.assign(new Error((detail?detail+' ':'')+'本次操作结果暂未确认；请刷新核对已有任务或保存结果，不会自动重复执行。'),{code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 let owner:string;
 try{owner=await prepareMutationSession(generation);}catch(error){
  // A failed session read cannot establish which Owner owns a prior intent.
  // Preserve its uncertainty without dispatching or discarding that intent.
  const pending=Array.from({length:sessionStorage.length},(_,index)=>sessionStorage.key(index)).some(key=>key?.startsWith('loop.local.pending.')&&(key==='loop.local.pending.'+digest||(key.endsWith('.'+digest+'.uncertain')&&sessionStorage.getItem(key)==='1')));
  if(pending)throw unknown();throw error;
 }
 if(generation!==sessionGeneration||owner!==ownerScope)throw requestNotSent(Error('会话已变化，请重新打开后操作。'));
 const flight=owner+'\0'+digest,existing=inFlight.get(flight);if(existing)return existing as Promise<T>;
 const scopedKey='loop.local.pending.owner.'+encodeURIComponent(owner||'unbound')+'.'+digest,legacyKey='loop.local.pending.'+digest;
 // An old unscoped intent has no provable Owner. Only read its receipt; never
 // infer that an absent receipt permits dispatching a new write.
 const legacy=!sessionStorage.getItem(scopedKey)&&!!sessionStorage.getItem(legacyKey),key=legacy?legacyKey:scopedKey;
 let idempotencyKey=sessionStorage.getItem(key);if(!idempotencyKey){idempotencyKey=crypto.randomUUID();sessionStorage.setItem(key,idempotencyKey);}
 const operation={...body,idempotencyKey},recoverable=['configuration','episode-commands','episode-lifecycle','recycle-bin'].includes(endpoint)&&!['planRecyclePurge','retryDeletionCleanup','openDirectory','openStandaloneStudio','openWorkspaceStudio'].includes(command);
 const pending=legacy||sessionStorage.getItem(key+'.uncertain')==='1';
 // Each batch item changes only local metadata and commits its receipt in the
 // same locked transaction. An explicit retry can submit the exact same key.
 const replayable=endpoint==='episode-lifecycle'&&command===episodeBatchLifecycleCommand;
 const readback=async()=>{
  const receipt=await localRequest('command-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,operation}),signal:AbortSignal.timeout(10000)});
  if(receipt.status!=='committed')throw unknown();return receipt.result;
 };
 const request=(async()=>{
  try{
   if(legacy||(recoverable&&pending&&!replayable)){try{return await readback();}catch{throw unknown();}}
   try{return await localRequest(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(operation)});}
   catch(error){
    if((error as {requestSent?:boolean}).requestSent===false){sessionStorage.removeItem(key);throw error;}
    const status=(error as {status?:number}).status;
    if(status&&status<500){sessionStorage.removeItem(key);sessionStorage.removeItem(key+'.uncertain');throw error;}
    if(!recoverable)throw error;
    sessionStorage.setItem(key+'.uncertain','1');
    try{return await readback();}catch{throw unknown(status&&error instanceof Error?error.message:undefined);}
   }
  }catch(error){throw error;}
 })().then(value=>{sessionStorage.removeItem(key);sessionStorage.removeItem(key+'.uncertain');return value;}).finally(()=>{if(inFlight.get(flight)===request)inFlight.delete(flight);});
 inFlight.set(flight,request);return request as Promise<T>;
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
