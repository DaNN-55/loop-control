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
