import {useState} from 'react';
import {CatalogPanelNavigationContext,readCatalogNavigation} from './catalogNavigation';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkspaceTopbar} from './WorkspaceTopbar';
import type {WorkspaceSearchResponse} from './workspaceSearchTypes';

const episodeId='20000000-0000-4000-8000-000000000001';
const accountId='10000000-0000-4000-8000-000000000001';
const props={theme:'light' as const,onToggleTheme:vi.fn(),onOpenEpisode:vi.fn(),onOpenAccount:vi.fn(),onOpenCatalog:vi.fn()};
const empty=(query:string):WorkspaceSearchResponse=>({query,episodes:[],accounts:[],materials:[],hasMore:{episodes:false,accounts:false,materials:false}});
beforeEach(()=>{Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks();});

it('opens search with the keyboard, restores focus and does not query empty input',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<WorkspaceTopbar {...props}/>);const user=userEvent.setup();
 const trigger=screen.getByRole('textbox',{name:'查找生产单、账号或素材'});await user.click(trigger);await screen.findByRole('region',{name:'工作区搜索结果'});await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'查找生产单、账号或素材'})));expect(fetcher).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();expect(document.querySelector('.workspace-search-overlay')).toBeNull();
 await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull());await waitFor(()=>expect(document.activeElement).toBe(trigger));
 fireEvent.keyDown(document,{key:'k',ctrlKey:true});expect(await screen.findByRole('region',{name:'工作区搜索结果'})).toBeTruthy();expect(screen.queryByRole('button',{name:/模拟数据/})).toBeNull();await user.click(screen.getByRole('button',{name:'切换至深色模式'}));expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();
});

it('does not let an old response replace a newer search and opens the real result',async()=>{
 const finish=new Map<string,(response:Response)=>void>();
 vi.stubGlobal('fetch',vi.fn((url:string)=>new Promise<Response>(resolve=>finish.set(new URL(url,'http://localhost').searchParams.get('q')!,resolve))));
 render(<WorkspaceTopbar {...props}/>);await userEvent.setup().click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));const input=await screen.findByRole('textbox',{name:'查找生产单、账号或素材'});
 fireEvent.change(input,{target:{value:'first'}});await waitFor(()=>expect(finish.has('first')).toBe(true));
 fireEvent.change(input,{target:{value:'second'}});await waitFor(()=>expect(finish.has('second')).toBe(true));
 finish.get('second')!(Response.json({...empty('second'),episodes:[{id:episodeId,kind:'episode',episodeId,title:'最新结果',subtitle:'真实账号'}]}));await screen.findByRole('button',{name:/最新结果/});
 finish.get('first')!(Response.json({...empty('first'),episodes:[{id:'old',kind:'episode',episodeId,title:'旧搜索结果',subtitle:'真实账号'}]}));await waitFor(()=>expect(screen.queryByText('旧搜索结果')).toBeNull());
 await userEvent.setup().click(screen.getByRole('button',{name:/最新结果/}));expect(props.onOpenEpisode).toHaveBeenCalledWith(episodeId,{q:'second',category:'all',page:1,open:false});await waitFor(()=>expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull());
});

it('keeps registered files separate from preview, download and production navigation and pages all results',async()=>{
 const sha='a'.repeat(64),path=`episodes/${episodeId}/main-script.md`,requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{requests.push(url);if(url.startsWith('/_local-artifact'))return new Response('A real script preview');const p=new URL(url,'http://localhost').searchParams;return Response.json({...empty('fixture'),accounts:[{id:accountId,kind:'account',accountId,title:'真实账号',subtitle:'账号配置'}],materials:[{id:'material',kind:'material',episodeId,path,sha256:sha,title:p.get('page')==='2'?'second-script.md':'main-script.md',subtitle:'当前脚本',fileType:'script',typeLabel:'脚本'}],hasMore:{episodes:false,accounts:false,materials:p.get('page')!=='2'},pagination:{category:p.get('category')||'all',page:Number(p.get('page')||1),pageSize:8,total:{episodes:0,accounts:1,materials:9},pages:{episodes:1,accounts:1,materials:2}}});}));
 render(<WorkspaceTopbar {...props}/>);const user=userEvent.setup();await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));fireEvent.change(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}),{target:{value:'fixture'}});
 await screen.findByText('main-script.md');expect(props.onOpenEpisode).not.toHaveBeenCalled();const row=screen.getByText('main-script.md').closest('li')!;
 const download=within(row).getByRole('link',{name:'下载 main-script.md'});expect(download.getAttribute('href')).toBe('/_local-artifact?'+new URLSearchParams({episode:episodeId,path,sha256:sha})+'&download=1');
 await user.click(within(row).getByRole('button',{name:'预览 main-script.md'}));expect(await screen.findByText('A real script preview')).toBeTruthy();expect(props.onOpenEpisode).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'关闭预览'}));
 await user.click(screen.getByRole('button',{name:'查看全部素材（9）'}));await waitFor(()=>expect(requests.some(url=>url.includes('category=materials'))).toBe(true));await user.click(await screen.findByRole('button',{name:'下一页'}));await screen.findByText('second-script.md');expect(requests.some(url=>url.includes('page=2'))).toBe(true);expect(screen.queryByText('main-script.md')).toBeNull();
 await user.click(within(screen.getByText('second-script.md').closest('li')!).getByRole('button',{name:'打开所属生产单'}));expect(props.onOpenEpisode).toHaveBeenCalledWith(episodeId,{q:'fixture',category:'materials',page:2,open:false});
});

it('shows a readable search error and retries the same query',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?Response.json({error:'本机查询暂不可用'},{status:503}):Response.json(empty('retry'))));
 render(<WorkspaceTopbar {...props}/>);const user=userEvent.setup();await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));fireEvent.change(await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}),{target:{value:'retry'}});
 expect((await screen.findByRole('alert')).textContent).toContain('本机查询暂不可用');await user.click(screen.getByRole('button',{name:'重新搜索'}));await screen.findByText('没有匹配的结果。');expect(calls).toBe(2);
});

it('reads global pending work on demand, merges duplicate episodes and retains exact totals',async()=>{
 const episode={id:episodeId,title:'真实待处理作品'},requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{requests.push(url);return Response.json({pending:{total:21,items:[episode]},blocked:{total:2,items:[{episode,blocker:{detail:'连接未就绪'}},{episode,blocker:{detail:'字幕未对齐'}}]},worker:{failed:3}});}));
 render(<WorkspaceTopbar {...props}/>);expect(requests).toHaveLength(0);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'待处理通知'}));const dialog=await screen.findByRole('dialog',{name:'待处理通知'});
 const row=await within(dialog).findByRole('button',{name:/真实待处理作品/});expect(within(dialog).getAllByRole('button',{name:/真实待处理作品/})).toHaveLength(1);expect(row.textContent).toContain('待审核');expect(row.textContent).toContain('需处理');expect(within(dialog).getByText('当前显示首批事项，可打开全部列表继续查看。')).toBeTruthy();expect(requests[0]).toBe('/api/local/catalog?view=operations&visibility=active&page=1&pendingPage=1&blockedPage=1');
 await user.click(row);expect(props.onOpenEpisode).toHaveBeenCalledWith(episodeId);
 await user.click(screen.getByRole('button',{name:'待处理通知'}));await user.click(await screen.findByRole('button',{name:'全部待审核（21）'}));expect(props.onOpenCatalog).toHaveBeenCalledWith('review');
 await user.click(screen.getByRole('button',{name:'待处理通知'}));await user.click(await screen.findByRole('button',{name:'3 项任务失败'}));expect(props.onOpenCatalog).toHaveBeenCalledWith('blocked');
});

it('retries unavailable notifications and invokes the existing theme action',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?Response.json({error:'暂时离线'},{status:503}):Response.json({pending:{total:0,items:[]},blocked:{total:0,items:[]},worker:{failed:0}})));
 render(<WorkspaceTopbar {...props}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'切换至深色模式'}));expect(props.onToggleTheme).toHaveBeenCalledTimes(1);
 await user.click(screen.getByRole('button',{name:'待处理通知'}));expect((await screen.findByRole('alert')).textContent).toContain('暂时离线');await user.click(screen.getByRole('button',{name:'重新读取'}));await screen.findByText('暂无待处理事项。');
});
it('filters each category and opens completed packages and failed connections from recent reminders',async()=>{
 const connections=vi.fn(),user=userEvent.setup();
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('notification-events')?[
  {id:'delivery',event_type:'publish_package_verified',episode_id:episodeId,created_at:'2026-10-29T00:00:00Z',payload:{}},
  {id:'failure',event_type:'connection_verification_failed',episode_id:null,created_at:'2026-10-29T00:00:00Z',payload:{name:'连接A'}}
 ]:{pending:{total:1,items:[{id:'review',title:'审核作品'}]},blocked:{total:1,items:[{episode:{id:'blocked',title:'失败作品'},blocker:{detail:'失败'}}]},worker:{failed:2}})));
 const {rerender}=render(<WorkspaceTopbar {...props} onOpenConnections={connections} notificationEventsEnabled notificationPreferences={{review:false,failure:false,delivery:true}}/>);
 await user.click(screen.getByRole('button',{name:'待处理通知'}));await user.click(await screen.findByRole('button',{name:/交付包已完成/}));expect(props.onOpenEpisode).toHaveBeenCalledWith(episodeId);
 rerender(<WorkspaceTopbar {...props} onOpenConnections={connections} notificationEventsEnabled notificationPreferences={{review:false,failure:true,delivery:false}}/>);
 await user.click(screen.getByRole('button',{name:'待处理通知'}));await user.click(await screen.findByRole('button',{name:/连接A验证失败/}));expect(connections).toHaveBeenCalledOnce();
 await user.click(screen.getByRole('button',{name:'待处理通知'}));await screen.findByText('失败作品');expect(screen.getByText('审核作品')).toBeTruthy();expect(screen.queryByText('交付包已完成')).toBeNull();
});
it('keeps pending work and badge visible while all reminder channels and categories are muted',async()=>{
 const fetcher=vi.fn(async()=>Response.json({pending:{total:1,items:[{id:episodeId,title:'静音后的待审核作品'}]},blocked:{total:0,items:[]},worker:{failed:2}}));vi.stubGlobal('fetch',fetcher);render(<WorkspaceTopbar {...props} notificationEventsEnabled notificationPreferences={{review:false,failure:false,delivery:false,inApp:false,macOS:false}}/>);
 await userEvent.setup().click(screen.getByRole('button',{name:'待处理通知'}));await screen.findByText('静音后的待审核作品');expect(screen.getByRole('button',{name:'全部待审核（1）'})).toBeTruthy();expect(screen.getByRole('button',{name:'2 项任务失败'})).toBeTruthy();expect(document.querySelector('.workspace-attention-dot')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.queryByText('最近提醒')).toBeNull();
});
it.each([[false,false],[false,true],[true,false],[true,true]])('uses only the in-app channel for recent reminders (inApp=%s, macOS=%s)',async(inApp,macOS)=>{
 const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{requests.push(url);return Response.json(url.endsWith('notification-events')?[{id:'done',event_type:'publish_package_verified',episode_id:episodeId,created_at:'2026-11-02T00:00:00Z',payload:{}}]:{pending:{total:0,items:[]},blocked:{total:0,items:[]},worker:{failed:0}});}));
 render(<WorkspaceTopbar {...props} notificationEventsEnabled notificationPreferences={{review:true,failure:true,delivery:true,inApp,macOS}}/>);
 await userEvent.setup().click(screen.getByRole('button',{name:'待处理通知'}));
 if(inApp){expect(await screen.findByText('交付包已完成')).toBeTruthy();}else{await screen.findByText('暂无待处理事项。');expect(screen.queryByText('交付包已完成')).toBeNull();}
 expect(requests.some(url=>url.endsWith('notification-events'))).toBe(inApp);
});

it('clears visible results and pending responses when the Owner changes',async()=>{
 const finish=new Map<string,(response:Response)=>void>();vi.stubGlobal('fetch',vi.fn((url:string)=>new Promise<Response>(resolve=>finish.set(new URL(url,'http://localhost').searchParams.get('q')!,resolve))));
 const {rerender}=render(<WorkspaceTopbar {...props} ownerId="owner-a"/>);const user=userEvent.setup();await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));fireEvent.change(screen.getByRole('textbox'),{target:{value:'owner-a query'}});await waitFor(()=>expect(finish.has('owner-a query')).toBe(true));
 rerender(<WorkspaceTopbar {...props} ownerId="owner-b"/>);expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');finish.get('owner-a query')!(Response.json({...empty('owner-a query'),episodes:[{id:episodeId,kind:'episode',episodeId,title:'旧 Owner 私有作品',subtitle:'账号 A'}]}));await user.click(screen.getByRole('textbox'));expect(screen.queryByText('旧 Owner 私有作品')).toBeNull();expect(screen.queryByRole('button',{name:/打开所属/})).toBeNull();
});

it('keeps file preview failures in place and retries the same SHA-bound file without opening production',async()=>{
 const path=`episodes/${episodeId}/main-script.md`,sha='b'.repeat(64);let attempts=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.startsWith('/_local-artifact')?(++attempts===1?new Response('Unavailable',{status:409}):new Response('Recovered script')):Response.json({...empty('script'),materials:[{id:'script',kind:'material',episodeId,path,sha256:sha,title:'main-script.md',subtitle:'脚本',fileType:'script',typeLabel:'脚本'}]})));
 render(<WorkspaceTopbar {...props}/>);const user=userEvent.setup();await user.click(screen.getByRole('textbox'));fireEvent.change(screen.getByRole('textbox'),{target:{value:'script'}});await user.click(await screen.findByRole('button',{name:'预览 main-script.md'}));expect((await screen.findByRole('alert')).textContent).toContain('文件预览未能加载');expect(props.onOpenEpisode).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'重试预览'}));expect(await screen.findByText('Recovered script')).toBeTruthy();expect(attempts).toBe(2);await user.keyboard('{Escape}');expect(document.activeElement).toBe(screen.getByRole('textbox'));expect(screen.queryByText('Recovered script')).toBeNull();
});

it('keeps the full-search keyword and page but does not reopen the popup when production navigation remounts the header',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...empty('script'),materials:[{id:'file',kind:'material',episodeId,path:'script.md',sha256:'a'.repeat(64),title:'main-script.md',subtitle:'原生产单',fileType:'script'}],pagination:{category:'materials',page:2,pageSize:8,total:{episodes:0,accounts:0,materials:9},pages:{episodes:1,accounts:1,materials:2}}})));
 function App(){const[panels,setPanels]=useState(()=>readCatalogNavigation('?searchQ=script&searchCategory=materials&searchPage=2').panels),[destination,setDestination]=useState('list');return <CatalogPanelNavigationContext.Provider value={{value:panels,change:(key,patch)=>setPanels(current=>({...current,[key]:{...current[key],...patch}}))}}><p>{destination}</p><WorkspaceTopbar key={destination} {...props} onOpenEpisode={(_id,search)=>{if(search)setPanels(current=>({...current,search}));setDestination('production');}}/></CatalogPanelNavigationContext.Provider>;}
 render(<App/>);const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'打开所属生产单'}));expect(screen.getByText('production')).toBeTruthy();expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('script');await user.click(screen.getByRole('textbox'));expect(await screen.findByText('main-script.md')).toBeTruthy();expect(screen.getByText('共 9 项 · 第 2 / 2 页')).toBeTruthy();
});
