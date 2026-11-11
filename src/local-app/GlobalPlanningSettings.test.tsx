import {webcrypto} from 'node:crypto';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {GlobalPlanningSettings} from './GlobalPlanningSettings';

afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
const harness={id:'10000000-0000-4000-8000-000000000001',name:'事实规划',slug:'planning-v1',version:1,summary:'保留事实',instructions:'保持原文',is_active:true};
function setup(){
 vi.stubGlobal('crypto',webcrypto);
 let revision=0,reads=0,writes=0;
 const selection={provider:'codex',adapter:'codex',model:'fixture-model',harnessId:harness.id,allowedTools:['read','write'],budgetCents:null};
 const draft=()=>({planningSelection:{revision,selection,promptVersions:[harness]}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST'){writes++;revision++;return Response.json(draft());}
  reads++;return reads===1?Response.json(draft()):Response.json({error:'读取连接中断'},{status:503});
 }));
 render(<GlobalPlanningSettings/>);
 return {get writes(){return writes;},get reads(){return reads;}};
}
it('accepts the confirmed defaults response even when a subsequent GET would fail',async()=>{
 const f=setup();await screen.findByRole('textbox',{name:'分镜规划 模型'});
 fireEvent.click(screen.getByRole('button',{name:'保存默认设置'}));
 await screen.findByText('已保存全局默认设置');
 expect(f.writes).toBe(1);expect(f.reads).toBe(1);
});
it('continues only the list read after a Harness version was created',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const created={...harness,id:'20000000-0000-4000-8000-000000000002',name:'新版本',version:2};
 let reads=0,creates=0;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST'){creates++;return Response.json({id:created.id});}
  reads++;
  if(reads===2)return Response.json({error:'列表暂不可读'},{status:503});
  return Response.json({planningSelection:{revision:0,selection:null,promptVersions:reads===1?[harness]:[created,harness]}});
 }));
 render(<GlobalPlanningSettings/>);await screen.findByRole('textbox',{name:'分镜规划 模型'});
 fireEvent.change(screen.getByRole('textbox',{name:'版本名称'}),{target:{value:'新版本'}});
 fireEvent.change(screen.getByRole('textbox',{name:'版本摘要'}),{target:{value:'保留事实'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Harness 内容'}),{target:{value:'新事实规划'}});
 fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));
 await screen.findByText(/列表暂不可读/);
 fireEvent.click(screen.getByRole('button',{name:'重新读取版本'}));
 await screen.findByText('新版本已登记并选中，保存默认设置后生效。');
 expect(creates).toBe(1);expect(reads).toBe(3);
 expect((screen.getByRole('radio',{name:/新版本/}) as HTMLInputElement).checked).toBe(true);
 expect((screen.getByRole('textbox',{name:'版本名称'}) as HTMLInputElement).value).toBe('');
});

it('does not start a list read after a registration visit has ended',async()=>{
 vi.stubGlobal('crypto',webcrypto);let finish!:(response:Response)=>void;let reads=0;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST')return new Promise<Response>(resolve=>{finish=resolve;});
  reads++;return Response.json({planningSelection:{revision:0,selection:null,promptVersions:[harness]}});
 }));
 const view=render(<GlobalPlanningSettings/>);await screen.findByRole('textbox',{name:'版本名称'});
 fireEvent.change(screen.getByRole('textbox',{name:'版本名称'}),{target:{value:'新版本'}});
 fireEvent.change(screen.getByRole('textbox',{name:'版本摘要'}),{target:{value:'摘要'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Harness 内容'}),{target:{value:'内容'}});
 fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 view.unmount();
 await act(async()=>{finish(Response.json({id:harness.id}));await new Promise(resolve=>setTimeout(resolve,0));});
 expect(reads).toBe(1);
});
it('serializes two same-turn registration submits before React renders pending',async()=>{
 vi.stubGlobal('crypto',webcrypto);let reads=0,creates=0;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST'){creates++;return Response.json({id:harness.id});}
  reads++;return Response.json({planningSelection:{revision:0,selection:null,promptVersions:[harness]}});
 }));
 render(<GlobalPlanningSettings/>);const field=await screen.findByRole('textbox',{name:'版本名称'});
 fireEvent.change(field,{target:{value:'新版本'}});fireEvent.change(screen.getByRole('textbox',{name:'版本摘要'}),{target:{value:'摘要'}});fireEvent.change(screen.getByRole('textbox',{name:'Harness 内容'}),{target:{value:'内容'}});
 act(()=>{fireEvent.submit(field.closest('form')!);fireEvent.submit(field.closest('form')!);});
 await screen.findByText('新版本已登记并选中，保存默认设置后生效。');
 expect(creates).toBe(1);expect(reads).toBe(2);
});
it('keeps a reopened defaults visit independent from a late save response',async()=>{
 vi.stubGlobal('crypto',webcrypto);let finish!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST')return new Promise<Response>(resolve=>{finish=resolve;});
  return Response.json({planningSelection:{revision:0,selection:{model:'current-model',harnessId:harness.id},promptVersions:[harness]}});
 }));
 const first=render(<GlobalPlanningSettings/>);await screen.findByRole('textbox',{name:'分镜规划 模型'});fireEvent.click(screen.getByRole('button',{name:'保存默认设置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));first.unmount();
 render(<GlobalPlanningSettings/>);await screen.findByDisplayValue('current-model');
 await act(async()=>{finish(Response.json({planningSelection:{revision:1,selection:{model:'old-saved',harnessId:harness.id},promptVersions:[harness]}}));});
 expect(screen.queryByText('已保存全局默认设置')).toBeNull();expect(screen.getByDisplayValue('current-model')).toBeTruthy();
});
