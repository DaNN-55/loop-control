import {expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
it('uses Harness native owner transport without expecting or disclosing a Loop CSRF credential',async()=>{
 vi.resetModules();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);
 const {attachNativeSurface}=await import('./nativeSurface');
 const release=attachNativeSurface(document.createElement('div'),'/api/team-loop-control/native');
 const paths:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{const original=new URL(path,'http://localhost').searchParams.get('path');paths.push(original!);if(original==='/api/local/session')return Response.json({owner:{id:'owner'}});expect(init?.method).toBe('POST');expect(new Headers(init?.headers).get('X-CSRF-Token')).toBeNull();return Response.json({ok:true});}));
 try{const {localCommand}=await import('./client');await expect(localCommand('start',{episodeId:'episode'},undefined,'episode-commands')).resolves.toEqual({ok:true});expect(paths).toEqual(['/api/local/session','/api/local/episode-commands']);}finally{release();vi.unstubAllGlobals();}
});

it('recovers an uncertain native file import through its own Host route without changing the canonical receipt',async()=>{
 vi.resetModules();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);
 const {attachNativeSurface}=await import('./nativeSurface');
 const release=attachNativeSurface(document.createElement('div'),'/api/team-loop-control/native');
 const data={episodeId:'episode',sourceKind:'file',sourcePath:'local.png',materialType:'image',mimeType:'image/png',contentBase64:'A'.repeat(300*1024),isMainScript:false,materialPurpose:'visual_reference'};
 let operation:unknown,lookup=0,writes=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.includes('?path='))return Response.json({owner:{id:'owner'}});
  const payload=JSON.parse(String(init?.body));
  if(path==='/api/team-loop-control/native-material-upload'){writes++;operation=payload;expect(payload).toMatchObject({command:'importMaterial',data,idempotencyKey:expect.any(String)});throw Error('lost response');}
  expect(path).toBe('/api/team-loop-control/native-material-upload-receipt');
  expect(payload).toEqual({endpoint:'episode-commands',operation});
  return Response.json(++lookup===1?{status:'unknown'}:{status:'committed',result:{id:'material'}});
 }));
 try{
  const {localCommand}=await import('./client');
  const submit=()=>localCommand('importMaterial',data,undefined,'episode-commands');
  await expect(submit()).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
  expect(Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.key(i)).every(key=>key?.startsWith('loop.local.pending.owner.owner.'))).toBe(true);
  await expect(submit()).resolves.toEqual({id:'material'});
  expect(writes).toBe(1);expect(lookup).toBe(2);expect(sessionStorage.length).toBe(0);
 }finally{release();vi.unstubAllGlobals();sessionStorage.clear();}
});
