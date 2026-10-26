import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
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
