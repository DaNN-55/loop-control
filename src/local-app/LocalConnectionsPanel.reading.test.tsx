import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
import {localRequest} from './client';
const connection={id:'reading-c',name:'Images',provider:'openai',adapter:'openai_images',current_version_id:'reading-v',status:'verified'};
const models={connectionId:connection.id,versionId:connection.current_version_id,revision:'r1',enabledModels:['gpt-image-2'],models:[{id:'gpt-image-2',adapted:true,listed:false,capability:'图片'}],discovery:{supported:true,detail:'目录',readAt:null}};
const catalog=(name='Images')=>({connections:[{...connection,name}],versions:[],serviceCatalog:{groups:[{capability:'image',services:[{id:'images',connectionId:connection.id,provider:'openai',adapter:'openai_images',mode:'generation',connectionVersionId:'reading-v',models:['gpt-image-2'],executable:true}]}]},capabilities:{secrets:'keychain',verification:'live',externalReady:true}});
beforeEach(async()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({csrfToken:'fixture'})));await localRequest('session');});
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('keeps an acknowledged model save in the fixed pane despite a failed directory read and retry only reads',async()=>{
 let offline=false,posts=0,modelReads=0,directoryReads=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){expect(JSON.parse(String(init.body)).command).toBe('save');posts++;offline=true;return Response.json({...models,revision:'r2',enabledModels:[]});}
  if(path.includes('connection-models')){modelReads++;return Response.json(models);}
  directoryReads++;return offline?Response.json({error:'目录暂时断开'},{status:503}):Response.json(catalog());
 }));
 const user=userEvent.setup();render(<LocalConnectionsPanel settingsLayout/>);await user.click(await screen.findByRole('button',{name:'Images'}));await user.click(screen.getByRole('tab',{name:'模型'}));
 await user.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));await user.click(screen.getByRole('button',{name:'保存'}));
 await waitFor(()=>{expect(screen.getByRole('button',{name:'保存'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'保存'}).getAttribute('data-loading')).not.toBe('true');});expect(screen.getByRole('tab',{name:'模型'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('alert').textContent).toContain('模型设置已保存');expect(screen.getByRole('alert').textContent).not.toContain('操作未确认完成');
 await user.click(screen.getByRole('button',{name:'重新读取连接'}));expect(screen.getByRole('alert').textContent).toContain('模型设置已保存');expect(posts).toBe(1);
 offline=false;await user.click(screen.getByRole('button',{name:'重新读取连接'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(screen.getByRole('tab',{name:'模型'}).getAttribute('aria-selected')).toBe('true');expect(posts).toBe(1);expect(modelReads).toBe(1);expect(directoryReads).toBe(4);
});
it.each(['success','failure'])('does not let an earlier %s replace a newer directory or its feedback',async(late)=>{
 const reads:Array<{signal?:AbortSignal|null;finish:(response:Response)=>void}>=[];let first=true;
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{if(first){first=false;return Response.json({error:'首次读取失败'},{status:503});}return new Promise<Response>(finish=>reads.push({signal:init?.signal,finish}));}));
 render(<LocalConnectionsPanel settingsLayout/>);const retry=await screen.findByRole('button',{name:'重新读取连接'});
 fireEvent.click(retry);fireEvent.click(retry);expect(reads).toHaveLength(2);
 await act(async()=>reads[1].finish(Response.json(catalog('新目录'))));await screen.findByRole('button',{name:'新目录'});
 await act(async()=>reads[0].finish(late==='success'?Response.json(catalog('旧目录')):Response.json({error:'旧读取错误'},{status:503})));
 expect(screen.getByRole('button',{name:'新目录'})).toBeTruthy();expect(screen.queryByRole('button',{name:'旧目录'})).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
it('retains a rejected model edit and retries the same unacknowledged write instead of claiming success',async()=>{
 const keys:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){keys.push(JSON.parse(String(init.body)).idempotencyKey);return keys.length===1?Response.json({error:'保存暂未确认'},{status:503}):Response.json({...models,revision:'r2',enabledModels:[]});}
  return Response.json(path.includes('connection-models')?models:catalog());
 }));
 const user=userEvent.setup();render(<LocalConnectionsPanel settingsLayout/>);await user.click(await screen.findByRole('button',{name:'Images'}));await user.click(screen.getByRole('tab',{name:'模型'}));
 await user.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));await user.click(screen.getByRole('button',{name:'保存'}));
 expect((await screen.findByRole('alert')).textContent).toContain('暂未确认');expect((screen.getByRole('checkbox',{name:'gpt-image-2'}) as HTMLInputElement).checked).toBe(false);
 await user.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>{expect(screen.getByRole('button',{name:'保存'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'保存'}).getAttribute('data-loading')).not.toBe('true');});expect(screen.getByRole('tab',{name:'模型'}).getAttribute('aria-selected')).toBe('true');expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);
});
it('aborts the directory request when leaving and keeps a reopened visit independent of the late result',async()=>{
 let finish!:(response:Response)=>void,signal:AbortSignal|null|undefined;
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>new Promise<Response>(resolve=>{finish=resolve;signal=init?.signal;})));
 const view=render(<LocalConnectionsPanel settingsLayout/>);view.unmount();expect(signal?.aborted).toBe(true);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(catalog('重新进入'))));render(<LocalConnectionsPanel settingsLayout/>);await screen.findByRole('button',{name:'重新进入'});
 await act(async()=>finish(Response.json(catalog('已关闭访问'))));expect(screen.queryByRole('button',{name:'已关闭访问'})).toBeNull();expect(screen.getByRole('button',{name:'重新进入'})).toBeTruthy();
});
it('accepts a model acknowledgement before a held follow-up read finishes',async()=>{
 let saved=false,finish!:(r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){saved=true;return Response.json({...models,revision:'r2',enabledModels:[]});}
  if(path.includes('connection-models'))return Response.json(models);
  return saved?new Promise<Response>(resolve=>{finish=resolve;}):Response.json(catalog());
 }));
 const user=userEvent.setup();render(<LocalConnectionsPanel settingsLayout/>);await user.click(await screen.findByRole('button',{name:'Images'}));await user.click(screen.getByRole('tab',{name:'模型'}));
 await user.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));await user.click(screen.getByRole('button',{name:'保存'}));
 await waitFor(()=>{expect(screen.getByRole('button',{name:'保存'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'保存'}).getAttribute('data-loading')).not.toBe('true');});expect(screen.getByRole('tab',{name:'模型'}).getAttribute('aria-selected')).toBe('true');
 await act(async()=>finish(Response.json({error:'读取断开'},{status:503})));expect(screen.getByRole('alert').textContent).toContain('模型设置已保存');expect(screen.getByRole('alert').textContent).not.toContain('操作未确认完成');
});
