import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
beforeEach(()=>{vi.resetModules();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>vi.unstubAllGlobals());
it('recovers a committed command through read-only receipt lookup without replaying POST',async()=>{
 const calls:string[]=[];let original:Record<string,unknown>|undefined;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push(path);
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-token'});
  if(path.endsWith('/command-receipt')){expect(JSON.parse(String(init?.body))).toEqual({endpoint:'episode-commands',operation:original});return Response.json({status:'committed',result:{id:'saved-task'}});}
  original=JSON.parse(String(init?.body));throw TypeError('connection lost after commit');
 }));
 const {localCommand}=await import('./client');
 await expect(localCommand('prepareWorkspace',{episodeId:'fixture'},undefined,'episode-commands')).resolves.toEqual({id:'saved-task'});
 expect(calls.filter(c=>c.endsWith('/episode-commands'))).toHaveLength(1);expect(calls.filter(c=>c.endsWith('/command-receipt'))).toHaveLength(1);expect(sessionStorage.length).toBe(0);
});
it('keeps an absent receipt uncertain across module reload; another click reads and never resubmits',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{calls.push(path);if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-token'});if(path.endsWith('/command-receipt'))return Response.json({status:'unknown'});return Response.json({error:'unconfirmed'},{status:503});}));
 let client=await import('./client');await expect(client.localCommand('renameAccount',{accountId:'a',name:'b'})).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 vi.resetModules();client=await import('./client');await expect(client.localCommand('renameAccount',{accountId:'a',name:'b'})).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 expect(calls.filter(c=>c.endsWith('/configuration'))).toHaveLength(1);expect(calls.filter(c=>c.endsWith('/command-receipt'))).toHaveLength(2);
});
it('does not query a receipt or retry after definite validation rejection',async()=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{calls.push(path);return path.endsWith('/session')?Response.json({csrfToken:'fixture-token'}):Response.json({error:'invalid input'},{status:400});}));
 const {localCommand}=await import('./client');await expect(localCommand('renameAccount',{})).rejects.toMatchObject({status:400});expect(calls.some(c=>c.endsWith('/command-receipt'))).toBe(false);expect(sessionStorage.length).toBe(0);
});

it('keeps a prior write uncertain when session preparation for receipt lookup fails, then recovers without resubmitting',async()=>{
 let phase:'initial'|'session-unavailable'|'recover'='initial',writes=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return phase==='session-unavailable'?Response.json({error:'session unavailable'},{status:503}):Response.json({csrfToken:'fixture-token'});
  if(path.endsWith('/command-receipt'))return Response.json(phase==='recover'?{status:'committed',result:{id:'saved-task'}}:{status:'unknown'});
  writes++;throw TypeError('write outcome unknown');
 }));
 let client=await import('./client');await expect(client.localCommand('prepareWorkspace',{episodeId:'fixture'},undefined,'episode-commands')).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 vi.resetModules();client=await import('./client');phase='session-unavailable';
 await expect(client.localCommand('prepareWorkspace',{episodeId:'fixture'},undefined,'episode-commands')).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 expect(sessionStorage.length).toBe(2);expect(writes).toBe(1);
 phase='recover';await expect(client.localCommand('prepareWorkspace',{episodeId:'fixture'},undefined,'episode-commands')).resolves.toEqual({id:'saved-task'});
 expect(writes).toBe(1);expect(sessionStorage.length).toBe(0);
});

it('isolates uncertain writes across Owners and still recovers the original Owner after reload',async()=>{
 let owner='A',recoverA=false;const writes:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/login')){owner=JSON.parse(String(init?.body)).owner;return Response.json({owner:{id:owner},csrfToken:'token-'+owner});}
  if(path.endsWith('/session'))return Response.json({owner:{id:owner},csrfToken:'token-'+owner});
  if(path.endsWith('/command-receipt'))return Response.json(owner==='A'&&recoverA?{status:'committed',result:{owner:'A'}}:{status:'unknown'});
  writes.push(owner);if(owner==='A')throw TypeError('A write outcome unknown');return Response.json({owner});
 }));
 let client=await import('./client');const data={name:'same account',slug:'same-account'};
 await expect(client.localCommand('createAccount',data)).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 await client.localRequest('login',{method:'POST',body:JSON.stringify({owner:'B'})});
 await expect(client.localCommand('createAccount',data)).resolves.toEqual({owner:'B'});expect(writes).toEqual(['A','B']);
 owner='A';recoverA=true;vi.resetModules();client=await import('./client');
 await expect(client.localCommand('createAccount',data)).resolves.toEqual({owner:'A'});expect(writes).toEqual(['A','B']);expect(sessionStorage.length).toBe(0);
});

it.each(['committed','unknown'] as const)('reads a legacy unscoped %s intent without dispatching another write',async status=>{
 const body={command:'renameAccount',data:{accountId:'a',name:'b'}};
 const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)))).toString('hex');
 const key='loop.local.pending.'+digest;sessionStorage.setItem(key,'prior-intent');
 const writes:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:'A'},csrfToken:'token-A'});
  if(path.endsWith('/command-receipt')){expect(JSON.parse(String(init?.body)).operation.idempotencyKey).toBe('prior-intent');return Response.json({status,result:{id:'saved'}});}
  writes.push(path);return Response.json({id:'unexpected'});
 }));
 const {localCommand}=await import('./client');const request=localCommand(body.command,body.data);
 if(status==='committed'){await expect(request).resolves.toEqual({id:'saved'});expect(sessionStorage.length).toBe(0);}
 else{await expect(request).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});expect(sessionStorage.getItem(key)).toBe('prior-intent');}
 expect(writes).toEqual([]);
});

it('does not replay a legacy unscoped cleanup intent even though cleanup commands are not receipt-recoverable',async()=>{
 const body={command:'retryDeletionCleanup',data:{deletionKey:'old-cleanup'}},endpoint='episode-lifecycle';
 const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({endpoint,...body})))).toString('hex');
 const key='loop.local.pending.'+digest;sessionStorage.setItem(key,'prior-cleanup-intent');
 const writes:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:'A'},csrfToken:'token-A'});
  if(path.endsWith('/command-receipt'))return Response.json({status:'unknown'});
  writes.push(path);return Response.json({cleanupPending:false});
 }));
 const {localCommand}=await import('./client');
 await expect(localCommand(body.command,body.data,undefined,endpoint)).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
 expect(writes).toEqual([]);expect(sessionStorage.getItem(key)).toBe('prior-cleanup-intent');
});
