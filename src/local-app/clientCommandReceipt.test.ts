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
