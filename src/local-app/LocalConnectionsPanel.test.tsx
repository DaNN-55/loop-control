import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('labels a closed-network rotation as save-only and clears its secret without verification',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const commands:string[]=[];
 const connection={id:'10000000-0000-4000-8000-000000000001',name:'Closed Pexels',provider:'pexels',adapter:'pexels_video',status:'retryable',current_version_id:'10000000-0000-4000-8000-000000000002'};
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){commands.push(JSON.parse(String(init.body)).command);return Response.json({connection});}
  return Response.json({connections:[connection],versions:[],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});
 }));
 render(<LocalConnectionsPanel/>);await screen.findByRole('heading',{name:'外部连接'});
 fireEvent.click(screen.getByText('轮换认证版本'));
 const secret=screen.getByLabelText('Closed Pexels 新的认证材料') as HTMLInputElement;
 fireEvent.change(secret,{target:{value:'synthetic-rotation-secret'}});
 const rotate=screen.getByRole('button',{name:'仅保存新版本'});
 expect((screen.getByRole('button',{name:'重新测试'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(rotate);
 await waitFor(()=>expect(secret.value).toBe(''));
 expect(commands).toEqual(['rotate']);
 expect(document.body.textContent).not.toContain('synthetic-rotation-secret');
});
it('keeps one locked rotation in flight and reuses its operation ID after an unconfirmed failure',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const connection={id:'10000000-0000-4000-8000-000000000011',name:'Retry Pexels',provider:'pexels',adapter:'pexels_video',status:'retryable'};
 const posts:{command:string;idempotencyKey:string;data:{secret:string}}[]=[];
 let fail!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){
   posts.push(JSON.parse(String(init.body)));
   if(posts.length===1)return new Promise<Response>(resolve=>{fail=resolve;});
   return Response.json({connection,replayed:true});
  }
  return Response.json({connections:[connection],versions:[],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});
 }));
 render(<LocalConnectionsPanel/>);await screen.findByRole('heading',{name:'外部连接'});
 fireEvent.click(screen.getByText('轮换认证版本'));
 const secret=screen.getByLabelText('Retry Pexels 新的认证材料') as HTMLInputElement;
 fireEvent.change(secret,{target:{value:'synthetic-retry-secret'}});
 const rotate=screen.getByRole('button',{name:'仅保存新版本'}) as HTMLButtonElement;
 fireEvent.click(rotate);fireEvent.click(rotate);
 await waitFor(()=>expect(posts).toHaveLength(1));
 expect(rotate.disabled).toBe(true);
 expect(Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.getItem(sessionStorage.key(i)!)).join('')).not.toContain('synthetic-retry-secret');
 fail(Response.json({error:'Unconfirmed local operation'},{status:503}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('未确认完成'));
 expect(secret.value).toBe('synthetic-retry-secret');expect(rotate.disabled).toBe(false);
 fireEvent.click(rotate);
 await waitFor(()=>expect(secret.value).toBe(''));
 expect(posts.map(p=>p.command)).toEqual(['rotate','rotate']);
 expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
 expect(sessionStorage.length).toBe(0);
 expect(screen.getByRole('alert').textContent).toContain('未再次写入秘密');
});
it('restores a missing binding in locked mode without testing or promoting its qualification',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('confirm',vi.fn().mockReturnValue(true));
 const connection={id:'10000000-0000-4000-8000-000000000021',name:'Unbound Pexels',provider:'pexels',adapter:'pexels_video',status:'retryable'};
 const version={id:'10000000-0000-4000-8000-000000000022',connection_id:connection.id,provider:'pexels',adapter:'pexels_video',status:'unverified',version:1,is_current:true,revoked_at:null,secretState:'unbound'};
 const commands:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){commands.push(JSON.parse(String(init.body)).command);return Response.json({rebound:true});}
  return Response.json({connections:[connection],versions:[version],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});
 }));
 render(<LocalConnectionsPanel/>);await screen.findByRole('heading',{name:'外部连接'});
 fireEvent.click(screen.getByText('连接版本（1）'));fireEvent.click(screen.getByText('恢复缺失的秘密绑定'));
 const secret=screen.getByLabelText('v1 恢复认证材料') as HTMLInputElement;
 const restore=screen.getByRole('button',{name:'重新绑定此版本'}) as HTMLButtonElement;
 expect(restore.disabled).toBe(true);
 fireEvent.change(secret,{target:{value:'synthetic-rebind-secret'}});fireEvent.click(restore);
 await waitFor(()=>expect(secret.value).toBe(''));
 expect(commands).toEqual(['rebind']);
 expect(restore.disabled).toBe(true);
 expect(screen.getByText('v1 · 未测试 · 当前')).toBeTruthy();
 expect((screen.getByRole('button',{name:'重新测试'}) as HTMLButtonElement).disabled).toBe(true);
});
it('saves a closed-network credential without issuing a verify command and clears the password',async()=>{
 vi.stubGlobal('crypto',webcrypto);const commands:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{if(init?.method==='POST'){commands.push(JSON.parse(String(init.body)).command);return Response.json({connection:{id:'synthetic-connection',name:'Test',provider:'pexels',adapter:'pexels_video',status:'retryable'}});}return Response.json({connections:[],versions:[],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});}));
 render(<LocalConnectionsPanel/>);await screen.findByRole('heading',{name:'外部连接'});fireEvent.change(screen.getByRole('textbox',{name:'连接名称'}),{target:{value:'Test'}});const field=screen.getByLabelText('Pexels API Key') as HTMLInputElement;fireEvent.change(field,{target:{value:'synthetic-private-entry'}});fireEvent.click(screen.getByRole('button',{name:'仅保存凭据'}));await waitFor(()=>expect(field.value).toBe(''));expect(commands).toEqual(['create']);expect(screen.getByRole('status').textContent).toContain('在线验证已锁定');expect(document.body.textContent).not.toContain('synthetic-private-entry');
});
it('keeps unconfirmed material in a password draft and persists only a random operation ID',async()=>{
 const secret='synthetic-ui-only-secret';let postBody='';
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){postBody=String(init.body);return new Response(JSON.stringify({error:'Keychain disabled'}),{status:503});}
  return new Response(JSON.stringify({connections:[],versions:[],pending:[],capabilities:{secrets:'disabled',verification:'disabled',externalReady:false}}));
 }));
 render(<LocalConnectionsPanel/>);await screen.findByRole('heading',{name:'外部连接'});
 fireEvent.change(screen.getByRole('textbox',{name:'连接名称'}),{target:{value:'Synthetic'}});
 const input=screen.getByLabelText('Pexels API Key') as HTMLInputElement;fireEvent.change(input,{target:{value:secret}});
 fireEvent.click(screen.getByRole('button',{name:'保存并测试'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('未确认完成'));
 expect(input.type).toBe('password');expect(input.value).toBe(secret);expect(document.body.textContent).not.toContain(secret);expect(JSON.parse(postBody).data.secret).toBe(secret);
 expect(sessionStorage.length).toBe(1);const key=sessionStorage.key(0)!;expect(key).not.toContain(secret);expect(sessionStorage.getItem(key)).toMatch(/^[0-9a-f-]{36}$/);expect(screen.getByRole('status').textContent).toContain('尚未启用');
});
