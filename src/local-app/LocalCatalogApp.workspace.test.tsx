import userEvent from '@testing-library/user-event';
import{act,cleanup,fireEvent,render,screen,within,waitFor}from'@testing-library/react';import{afterEach,it,expect,vi}from'vitest';import{webcrypto}from'node:crypto';import{LocalCatalogApp}from'./LocalCatalogApp';import type{LocalCatalog}from'./catalog';
vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
vi.mock('./LocalEpisodeDetail',()=>({LocalEpisodeDetail:({episodeId,preparationEntry}:{episodeId:string;preparationEntry?:{shotId?:string;targetItemId?:string}})=><p>已打开 {episodeId}{preparationEntry&&<span>返回镜头 {preparationEntry.shotId} {preparationEntry.targetItemId}</span>}</p>}));
const id='10000000-0000-4000-8000-000000000001',episode='20000000-0000-4000-8000-000000000001',at='2026-10-26T00:00:00Z';
const data={accounts:[{id,name:'日常账号',slug:'daily',timezone:'Asia/Shanghai',created_at:at,archived_at:null,current_blueprint_version_id:id}],blueprints:[{id,account_id:id,version:1,policy:{},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[id]:'a'.repeat(32)},episodes:[{id:episode,account_id:id,blueprint_version_id:id,stage:'production_completed',title:'普通长度完整生产单',created_at:at,updated_at:at,archived_at:null,is_test:true}],series:[],seriesVersions:[],promptVersions:[],sourceCreatedAt:at,importedAt:at,page:1,pageSize:20,total:41,episodeCount:41,accountCounts:{[id]:41},reviewCount:2,stages:{production_completed:41},artifactCounts:{[episode]:39},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]}as unknown as LocalCatalog;
afterEach(()=>{cleanup();vi.unstubAllGlobals();history.replaceState(null,'','/');localStorage.clear();sessionStorage.clear();});
it('opens standalone OpenChatCut from the initial account page without selecting a production order',async()=>{
 const replace=vi.fn(),close=vi.fn();vi.spyOn(window,'open').mockReturnValue({location:{replace},close} as unknown as Window);
 const requests:Array<{path:string;method:string}>=[];
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  requests.push({path,method:init?.method??'GET'});
  if(path.endsWith('/session'))return Response.json({csrfToken:'studio-csrf',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json(data);
  if(path.endsWith('/episode-commands')){
   expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('studio-csrf');
   expect(JSON.parse(String(init?.body))).toMatchObject({command:'openStandaloneStudio',data:{}});
   return Response.json({studioUrl:'http://127.0.0.1:5175/'});
  }
  return Response.json({connections:[],versions:[]});
 }));
 try{
  await act(async()=>{render(<LocalCatalogApp/>);});
  const button=screen.getByRole('button',{name:/OpenChatCut/});
  expect((button as HTMLButtonElement).disabled).toBe(false);fireEvent.click(button);
  await waitFor(()=>expect(replace).toHaveBeenCalledWith('http://127.0.0.1:5175/'));
  expect(close).not.toHaveBeenCalled();expect(requests.filter(r=>r.method!=='GET')).toEqual([{path:'/api/local/episode-commands',method:'POST'}]);
 }finally{vi.mocked(window.open).mockRestore();}
});
it('uses the approved navigation with real table paging and a contextual production workspace',async()=>{
 vi.stubGlobal('crypto',webcrypto);const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{requests.push(path);if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});if(path.includes('/catalog?')){const q=new URL(path,'http://localhost').searchParams;return Response.json({...data,page:Number(q.get('page'))});}return Response.json({connections:[],versions:[]});}));
 await act(async()=>{render(<LocalCatalogApp/>);});const nav=within(screen.getByRole('complementary',{name:'主导航'}));for(const name of['工作台','生产单','账号'])expect(nav.getByRole('button',{name})).toBeTruthy();expect(nav.queryByRole('button',{name:'审核'})).toBeNull();
 fireEvent.click(nav.getByRole('button',{name:'生产单'}));await screen.findByRole('table',{name:'生产单'});expect(await screen.findByText('普通长度完整生产单')).toBeTruthy();expect(screen.getAllByRole('columnheader').map(e=>e.textContent)).toEqual(['生产单','当前阶段','状态','最近更新','花费（元）','后台任务用时','生成次数','操作']);const actions=document.querySelector('.workspace-page-heading .workspace-actions');expect(actions?.querySelector('button:last-of-type')?.textContent).toBe('新建生产单');expect(document.querySelector('.page-header-actions')?.textContent).not.toContain('新建生产单');expect(document.querySelector('.episode-list-toolbar .summary-count')).toBeNull();expect(document.querySelector('.episode-list-footer')?.textContent).toContain('第 1 / 3 页 · 共 41 条');expect(screen.queryByRole('button',{name:'刷新'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(requests.some(p=>p.includes('page=2'))).toBe(true));
 fireEvent.click(await screen.findByText('普通长度完整生产单'));await screen.findByText('已打开 '+episode);expect(location.search).toContain(episode);
 expect(document.querySelector('.app-shell')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'切换至深色模式'}));expect(document.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('dark');
 expect(requests.every(p=>p.startsWith('/api/local/'))).toBe(true);
});
it('保留安全弹窗焦点，从所有者菜单打开连接配置且跨页保留连接草稿',async()=>{
 const user=userEvent.setup(),requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  requests.push(path);
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,episodes:[]});
  if(path.endsWith('/recycle-bin'))return Response.json({items:[],limitBytes:5e9,settingsRevision:1,usedBytes:0,pendingBytes:0,overLimit:false});if(path.endsWith('/deletion-cleanups'))return Response.json([]);
  return Response.json({connections:[],versions:[],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 const owner=screen.getByRole('button',{name:'所有者设置'});
 await user.click(owner);expect(screen.getAllByRole('menuitem').map(item=>item.textContent)).toEqual(['个人偏好','通知','登录与安全','日志','回收站','连接配置','退出登录']);
 await user.click(screen.getByRole('menuitem',{name:'登录与安全'}));
 const security=screen.getByRole('dialog',{name:'登录与安全'}),password=within(security).getByRole('form',{name:'登录与安全'});
 expect(within(security).getByRole('region',{name:'当前登录身份'}).textContent).toContain('owner@example.test');
 expect(Boolean(screen.getByRole('region',{name:'当前登录身份'}).compareDocumentPosition(screen.getByLabelText('新密码'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
 expect(password.querySelector('form')).toBeNull();expect(screen.queryByRole('region',{name:'本地连接'})).toBeNull();
 expect(requests.some(path=>/history|deletion-cleanups/.test(path))).toBe(false);
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(owner));
 await user.click(owner);
 await user.click(screen.getByRole('menuitem',{name:'连接配置'}));
 let maintenance=screen.getByRole('dialog',{name:'连接配置'});
 await within(maintenance).findByRole('region',{name:'本地连接'});
 expect(screen.queryByRole('tab',{name:'连接管理'})).toBeNull();
 expect(screen.queryByLabelText('新密码')).toBeNull();expect(requests.some(path=>path.includes('/history?'))).toBe(false);
 await user.click(within(maintenance).getByRole('button',{name:'新建连接'}));
 await user.type(await screen.findByRole('textbox',{name:'连接名称'}),'未提交的连接草稿');
 await user.click(screen.getByRole('button',{name:'返回连接列表'}));
 await user.click(screen.getByRole('button',{name:'保留修改并离开'}));
 await user.click(within(maintenance).getByRole('button',{name:'关闭连接配置'}));
 expect(screen.queryByRole('dialog',{name:'连接配置'})).toBeNull();
 expect(screen.getByRole('heading',{name:'内容工作台'})).toBeTruthy();
 expect(document.activeElement).toBe(owner);
 expect(screen.queryByRole('textbox',{name:'连接名称'})).toBeNull();
 await user.click(owner);
 await user.click(screen.getByRole('menuitem',{name:'连接配置'}));
 maintenance=await screen.findByRole('dialog',{name:'连接配置'});
 await user.click(await within(maintenance).findByRole('button',{name:'新建连接'}));
 expect((screen.getByRole('textbox',{name:'连接名称'})as HTMLInputElement).value).toBe('未提交的连接草稿');
 await user.click(screen.getByRole('button',{name:'返回连接列表'}));
 await user.click(screen.getByRole('button',{name:'保留修改并离开'}));
 await user.keyboard('{Escape}');
 expect(screen.queryByRole('dialog',{name:'连接配置'})).toBeNull();
 expect(requests.filter(path=>path.includes('/history-episodes?'))).toHaveLength(0);
});

it.each([true,false])('moves archived=%s production orders to the recycle bin without archiving or permanently deleting',async(initiallyArchived)=>{
 const user=userEvent.setup(),commands:Array<{command:string;data:unknown}>=[];let recycled=false;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'delete-csrf',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,total:recycled?0:1,episodes:recycled?[]:[{...data.episodes[0],is_test:false,archived_at:initiallyArchived?at:null}]});
  if(path.endsWith('/recycle-bin')){expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('delete-csrf');const body=JSON.parse(String(init?.body));commands.push(body);expect(body).toMatchObject({command:'recycleEpisode',data:{episodeId:episode}});recycled=true;return Response.json({recycled:true,revision:'member-revision',sizeBytes:1200});}
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});await user.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));
 if(initiallyArchived)await user.selectOptions(await screen.findByRole('combobox',{name:'归档范围'}),'archived');
 await user.click(await screen.findByRole('button',{name:'生产单操作：普通长度完整生产单'}));await user.click(screen.getByRole('menuitem',{name:'删除生产单'}));
 const modal=screen.getByRole('dialog',{name:'移入回收站'});expect(commands).toHaveLength(0);expect(within(modal).getByText(/可恢复到原账号与系列/)).toBeTruthy();
 expect(screen.queryByRole('textbox',{name:'永久删除确认文本'})).toBeNull();await user.click(within(modal).getByRole('button',{name:'移入回收站'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'移入回收站'})).toBeNull());await waitFor(()=>expect(screen.queryByText('普通长度完整生产单')).toBeNull());expect(commands.map(c=>c.command)).toEqual(['recycleEpisode']);
});

it.each([404,409])('keeps a rejected recycle operation (%s) inside its confirmation for retry',async(status)=>{
 const user=userEvent.setup(),commands:string[]=[];let calls=0;vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'recycle-csrf',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,total:1,episodes:[{...data.episodes[0],title:'测试',archived_at:null}]});
  if(path.endsWith('/recycle-bin')){commands.push(JSON.parse(String(init?.body)).command);calls++;return calls===1?Response.json({error:status===404?'本地生产单不可见。':'生产单有运行任务，暂时不能删除。'},{status}):Response.json({recycled:true});}
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});await user.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));await user.click(await screen.findByRole('button',{name:'生产单操作：测试'}));await user.click(screen.getByRole('menuitem',{name:'删除生产单'}));
 const modal=screen.getByRole('dialog',{name:'移入回收站'});await user.click(within(modal).getByRole('button',{name:'移入回收站'}));expect((await within(modal).findByRole('alert')).textContent).toContain(status===404?'本地生产单不可见':'生产单有运行任务');expect(document.querySelector('.floating-notices')).toBeNull();
 await user.click(within(modal).getByRole('button',{name:'移入回收站'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'移入回收站'})).toBeNull());expect(commands).toEqual(['recycleEpisode','recycleEpisode']);
});

it('keeps one topbar instance and places the Owner menu after theme in workspace and episode',async()=>{
 const user=userEvent.setup();vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json(data);
  if(path.includes('/workspace-search?'))return Response.json({query:'普通',episodes:[{id:episode,kind:'episode',title:'普通长度完整生产单',subtitle:'日常账号',episodeId:episode}],accounts:[],materials:[],hasMore:{episodes:false,accounts:false,materials:false}});
  return Response.json({connections:[],versions:[]});
 }));
 render(<LocalCatalogApp/>);await screen.findByRole('button',{name:'所有者设置'});
 expect(screen.getAllByRole('group',{name:'工作区工具'})).toHaveLength(1);
 expect(within(screen.getByRole('complementary',{name:'主导航'})).queryByRole('button',{name:'所有者设置'})).toBeNull();
 const theme=screen.getByRole('button',{name:'切换至深色模式'}),owner=screen.getByRole('button',{name:'所有者设置'});
 expect(Boolean(theme.compareDocumentPosition(owner)&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
 await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));await user.type(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}),'普通');
 await user.click(await within(screen.getByRole('region',{name:'工作区搜索结果'})).findByRole('button',{name:/普通长度完整生产单 日常账号/}));await screen.findByText('已打开 '+episode);
 expect(screen.getAllByRole('group',{name:'工作区工具'})).toHaveLength(1);expect(within(screen.getByRole('complementary',{name:'当前生产单详情'})).getByRole('button',{name:'所有者设置'})).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'所有者设置'}));await user.click(screen.getByRole('menuitem',{name:'登录与安全'}));await screen.findByRole('dialog',{name:'登录与安全'});await user.keyboard('{Escape}');await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'所有者设置'})));
});

it('恢复失败留在确认框内且可重试，成功后关闭；操作错误不显示重复全局通知',async()=>{
 const user=userEvent.setup();let calls=0,restored=false;vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'archive-csrf',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,total:restored?0:1,episodes:restored?[]:[{...data.episodes[0],archived_at:at,title:'待恢复旧单'}]});
  if(path.endsWith('/episode-lifecycle')){
   expect(JSON.parse(String(init?.body))).toMatchObject({command:'archiveEpisode',data:{episodeId:episode,archived:false}});
   calls++;if(calls===1)return Response.json({error:'恢复未完成，请重试。'},{status:409});restored=true;return Response.json({id:episode,archived_at:null});
  }
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 await user.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));
 await user.selectOptions(await screen.findByRole('combobox',{name:'归档范围'}),'archived');
 await user.click(await screen.findByRole('button',{name:'生产单操作：待恢复旧单'}));await user.click(screen.getByRole('menuitem',{name:'恢复'}));
 const modal=screen.getByRole('form',{name:'恢复生产单'});await user.click(within(modal).getByRole('button',{name:'确认恢复'}));
 expect((await within(modal).findByRole('alert')).textContent).toBe('恢复未完成，请重试。');expect(document.querySelector('.floating-notices')).toBeNull();
 expect((within(modal).getByRole('button',{name:'确认恢复'}) as HTMLButtonElement).disabled).toBe(false);
 await user.click(within(modal).getByRole('button',{name:'确认恢复'}));await waitFor(()=>expect(screen.queryByRole('form',{name:'恢复生产单'})).toBeNull());expect(calls).toBe(2);
});
it('opens durable file cleanup from the Owner menu, preserves list context and restores focus on close',async()=>{
 history.replaceState(null,'','/?view=episodes&page=2');vi.stubGlobal('crypto',webcrypto);const requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{requests.push(path);if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});if(path.includes('/catalog?'))return Response.json(data);if(path.endsWith('/recycle-bin'))return Response.json({items:[],limitBytes:5e9,settingsRevision:1,usedBytes:0,pendingBytes:0,overLimit:false});if(path.endsWith('/deletion-cleanups'))return Response.json([{cleanupKey:'pending-one',title:'待清理样例',path:'/fixture/episode',stagingPaths:['/fixture/staged']}]);return Response.json({connections:[],versions:[]});}));
 const user=userEvent.setup();await act(async()=>{render(<LocalCatalogApp/>);});expect(requests.some(path=>path.endsWith('/deletion-cleanups'))).toBe(false);
 const owner=screen.getByRole('button',{name:'所有者设置'});await user.click(owner);await user.click(screen.getByRole('menuitem',{name:'回收站'}));const dialog=await screen.findByRole('dialog',{name:'回收站'});await user.click(within(dialog).getByText('文件恢复与清理'));await within(dialog).findByRole('article',{name:'待清理样例'});await waitFor(()=>expect(location.search).toContain('cleanupOpen=1'));expect(location.search).toContain('page=2');
 await user.click(within(dialog).getByRole('button',{name:'关闭回收站'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'回收站'})).toBeNull());expect(document.activeElement).toBe(owner);expect(location.search).not.toContain('cleanupOpen');
 await user.click(owner);await user.click(screen.getByRole('menuitem',{name:'回收站'}));await screen.findByRole('dialog',{name:'回收站'});await waitFor(()=>expect(location.search).toContain('cleanupOpen=1'));await act(async()=>{history.back();});await waitFor(()=>expect(screen.queryByRole('dialog',{name:'回收站'})).toBeNull());expect(location.search).toContain('page=2');
});

it('opens the full associated catalog from an account deletion blocker and clears stale scope filters',async()=>{
 const requests:string[]=[];vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
 requests.push(path);if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});
 if(path.includes('/account-deletion-status?'))return Response.json({episodeCount:25,archivedEpisodeCount:24,creationCount:0,deletionCount:0,cleanupKey:null});
 if(path.includes('/catalog?'))return Response.json(data);return Response.json({connections:[],versions:[]});
 }));history.replaceState(null,'','/?view=accounts&account='+id+'&accountId='+id+'&q=old&status=blocked&visibility=active&page=3&seriesId=unassigned');
 const user=userEvent.setup();await act(async()=>{render(<LocalCatalogApp/>);});await user.click(await screen.findByRole('button',{name:'账号设置'}));await user.click(screen.getByRole('button',{name:'删除账号'}));await screen.findByText('25 个生产单（含 24 个已归档）');await user.click(screen.getByRole('button',{name:'查看生产单'}));
 await waitFor(()=>{const last=requests.filter(path=>path.includes('/catalog?')).at(-1)!;const q=new URL(last,'http://localhost').searchParams;expect(q.get('view')).toBe('episodes');expect(q.get('accountId')).toBe(id);expect(q.get('visibility')).toBe('all');expect(q.get('seriesId')).toBe('all');expect(q.get('q')).toBe('');expect(q.get('status')).toBe('all');expect(q.get('page')).toBe('1');});
});

it('opens the workbench for retired history bookmarks without mounting old pages or requesting their APIs',async()=>{
 vi.stubGlobal('crypto',webcrypto);const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>{requests.push(path);if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});if(path.includes('/catalog?'))return Response.json(data);return Response.json({connections:[],versions:[]});}));history.replaceState(null,'','/?view=history&source=old&historyTab=sources');await act(async()=>{render(<LocalCatalogApp/>);});await screen.findByRole('heading',{name:'内容工作台'});expect(screen.queryByRole('region',{name:'历史资料'})).toBeNull();expect(requests.some(path=>/\/history(?:[?/-]|$)/.test(path))).toBe(false);await waitFor(()=>expect(location.search).not.toContain('source='));expect(location.search).toContain('view=operations');
});
