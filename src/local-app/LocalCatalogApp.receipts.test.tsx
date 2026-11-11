import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import userEvent from '@testing-library/user-event';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import {draftCatalog,draftSnapshot,draftWorkspace} from './fixtures/workspaceDraftFixture';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});
it.each(['retry','dismiss'])('accepts the created order after refresh failure and supports %s without another write',async(action)=>{
 let created=false,offline=false,posts=0;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:'receipt-owner'},csrfToken:'fixture'});
  if(init?.method==='POST'){expect(JSON.parse(String(init.body)).command).toBe('create');posts++;created=true;offline=true;return Response.json({id:'created-episode'});}
  if(path.includes('/catalog?')){if(offline)return Response.json({error:'列表暂时断开'},{status:503});return Response.json({...draftCatalog,episodes:created?[{...draftCatalog.episodes[0],id:'created-episode',title:'已确认创建'}]:[],total:created?1:0});}
  if(path.endsWith('/workspace'))return Response.json({workspace:draftWorkspace('created-episode')});
  if(path.includes('?known='))return Response.json({hashes:{},sections:{...draftSnapshot(),episode:{...draftCatalog.episodes[0],id:'created-episode',title:'已确认创建'}}});
  return Response.json({connections:[],versions:[],serviceCatalog:{groups:[]}});
 }));
 render(<LocalCatalogApp/>);fireEvent.click(await screen.findByRole('button',{name:'新建生产单'}));
 fireEvent.change(screen.getByRole('textbox',{name:'工作标题（可留空）'}),{target:{value:'已确认创建'}});fireEvent.click(screen.getByRole('button',{name:'创建生产单'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'新建生产单'})).toBeNull());
 expect(screen.getByRole('alert').textContent).toContain('生产单已创建');expect(posts).toBe(1);
 if(action==='dismiss'){fireEvent.click(screen.getByRole('button',{name:'关闭错误通知'}));expect(screen.queryByRole('alert')).toBeNull();}
 offline=false;await act(async()=>{if(action==='retry')fireEvent.click(screen.getByRole('button',{name:'重新读取'}));else document.dispatchEvent(new Event('visibilitychange'));});
 await screen.findByRole('heading',{name:'已确认创建'});expect(posts).toBe(1);expect(within(document.body).queryByText('列表暂时断开')).toBeNull();
});
it('accepts archive acknowledgement even when the following read fails and only retries the read',async()=>{
 let archived=false,offline=false,posts=0;history.replaceState(null,'','/?view=episodes');vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:'archive-owner'},csrfToken:'fixture'});
  if(init?.method==='POST'){expect(JSON.parse(String(init.body)).command).toBe('archiveEpisode');posts++;archived=true;offline=true;return Response.json({archived:true});}
  if(path.includes('/catalog?'))return offline?Response.json({error:'目录暂不可用'},{status:503}):Response.json({...draftCatalog,episodes:archived?[]:[draftCatalog.episodes[0]],total:archived?0:1});
  return Response.json({connections:[],versions:[],serviceCatalog:{groups:[]}});
 }));
 const user=userEvent.setup();render(<LocalCatalogApp/>);await user.click(await screen.findByRole('button',{name:'生产单操作：草稿验证生产单'}));await user.click(screen.getByRole('menuitem',{name:'归档'}));
 await user.click(within(screen.getByRole('dialog',{name:'归档生产单'})).getByRole('button',{name:'确认归档'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'归档生产单'})).toBeNull());expect(screen.getByRole('alert').textContent).toContain('操作已保存');
 offline=false;await user.click(screen.getByRole('button',{name:'重新读取'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'草稿验证生产单'})).toBeNull());expect(posts).toBe(1);
});
it.each(['operations','episodes'])('from %s, closes creation on acknowledgement while directory reading is pending',async(view)=>{
 history.replaceState(null,'','/?view='+view);
 let written=false;const waiting:Array<(r:Response)=>void>=[];vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:'pending-read-owner'},csrfToken:'fixture'});
  if(init?.method==='POST'){written=true;return Response.json({id:'new-order'});}
  if(path.includes('/catalog?'))return written?new Promise<Response>(resolve=>waiting.push(resolve)):Response.json({...draftCatalog,episodes:[]});
  if(path.includes('?known='))return Response.json({hashes:{},sections:{...draftSnapshot(),episode:{...draftCatalog.episodes[0],id:'new-order'}}});
  if(path.endsWith('/workspace'))return Response.json({workspace:draftWorkspace('new-order')});
  return Response.json({connections:[],versions:[]});
 }));
 render(<LocalCatalogApp/>);fireEvent.click(await screen.findByRole('button',{name:'新建生产单'}));fireEvent.click(screen.getByRole('button',{name:'创建生产单'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'新建生产单'})).toBeNull());expect(waiting.length).toBeGreaterThan(0);
 await act(async()=>{for(const finish of waiting)finish(Response.json({error:'只读超时'},{status:503}));});expect(screen.getByRole('alert').textContent).toContain('生产单已创建');
});
