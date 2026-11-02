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
 await act(async()=>{render(<LocalCatalogApp/>);});const nav=within(screen.getByRole('complementary',{name:'主导航'}));for(const name of['工作台','生产单','账号','连接配置','历史资料'])expect(nav.getByRole('button',{name})).toBeTruthy();expect(nav.queryByRole('button',{name:'审核'})).toBeNull();
 fireEvent.click(nav.getByRole('button',{name:'生产单'}));await screen.findByRole('table',{name:'生产单'});expect(await screen.findByText('普通长度完整生产单')).toBeTruthy();expect(screen.getAllByRole('columnheader').map(e=>e.textContent)).toEqual(['生产单','当前阶段','状态','最近更新','花费（元）','阶段用时','生成次数','操作']);const actions=document.querySelector('.workspace-page-heading .workspace-actions');expect(actions?.querySelector('button:last-of-type')?.textContent).toBe('新建生产单');expect(document.querySelector('.page-header-actions')?.textContent).not.toContain('新建生产单');expect(document.querySelector('.episode-list-toolbar .summary-count')).toBeNull();expect(document.querySelector('.episode-list-footer')?.textContent).toContain('41 张生产单');expect(screen.queryByRole('button',{name:'刷新'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(requests.some(p=>p.includes('page=2'))).toBe(true));
 fireEvent.click(await screen.findByText('普通长度完整生产单'));await screen.findByText('已打开 '+episode);expect(location.search).toContain(episode);
 expect(document.querySelector('.app-shell')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'切换至深色模式'}));expect(document.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('dark');
 expect(requests.every(p=>p.startsWith('/api/local/'))).toBe(true);
});
it('保留安全弹窗焦点，将维护入口统一为侧栏且跨页保留连接草稿',async()=>{
 const user=userEvent.setup(),requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  requests.push(path);
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,episodes:[]});
  if(path.endsWith('/deletion-cleanups'))return Response.json([]);
  if(path.includes('/history-episodes?'))return Response.json({items:[],total:0,page:1,pageSize:30,selected:null,files:[],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,recordTotal:0}});
  if(path.includes('/history?'))return Response.json({summary:{versions:'0',files:'0'},sources:[],source:null,versions:[],files:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,versionTotal:0},sourceCounts:{active:0,archived:0}});
  return Response.json({connections:[],versions:[],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 const owner=screen.getByRole('button',{name:'所有者设置'});
 await user.click(owner);expect(screen.getAllByRole('menuitem').map(item=>item.textContent)).toEqual(['个人偏好','通知','登录与安全','退出登录']);
 await user.click(screen.getByRole('menuitem',{name:'登录与安全'}));
 const security=screen.getByRole('dialog',{name:'登录与安全'}),password=within(security).getByRole('form',{name:'登录与安全'});
 expect(within(security).getByRole('region',{name:'当前登录身份'}).textContent).toContain('owner@example.test');
 expect(Boolean(screen.getByRole('region',{name:'当前登录身份'}).compareDocumentPosition(screen.getByLabelText('新密码'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
 expect(password.querySelector('form')).toBeNull();expect(screen.queryByRole('region',{name:'本地连接'})).toBeNull();
 expect(requests.some(path=>/history|deletion-cleanups/.test(path))).toBe(false);
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(owner));
 const nav=within(screen.getByRole('complementary',{name:'主导航'}));
 await user.click(nav.getByRole('button',{name:'连接配置'}));
 const maintenance=screen.getByRole('region',{name:'连接配置内容'});
 await within(maintenance).findByRole('region',{name:'本地连接'});
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByRole('tab',{name:'连接管理'})).toBeNull();
 expect(screen.queryByLabelText('新密码')).toBeNull();expect(requests.some(path=>path.includes('/history?'))).toBe(false);
 await user.click(within(maintenance).getByRole('button',{name:'新建连接'}));
 await user.type(await screen.findByRole('textbox',{name:'连接名称'}),'未提交的连接草稿');
 await user.click(screen.getByRole('button',{name:'关闭连接窗口'}));
 await user.click(nav.getByRole('button',{name:'历史资料'}));
 await within(maintenance).findByText('没有匹配的历史生产单。可修改搜索或关闭“仅显示有生产内容的条目”。');
 expect(screen.queryByRole('tab',{name:'历史资料'})).toBeNull();
 expect(screen.queryByRole('textbox',{name:'连接名称'})).toBeNull();
 await user.click(nav.getByRole('button',{name:'连接配置'}));
 await user.click(within(maintenance).getByRole('button',{name:'新建连接'}));
 expect((screen.getByRole('textbox',{name:'连接名称'})as HTMLInputElement).value).toBe('未提交的连接草稿');
 await user.click(screen.getByRole('button',{name:'关闭连接窗口'}));
 await user.click(nav.getByRole('button',{name:'历史资料'}));
 expect(requests.filter(path=>path.includes('/history-episodes?'))).toHaveLength(1);
});

it.each([false,true])('cleanupPending=%s: confirms the actual directory and exact title, then reports unfinished file cleanup',async(cleanupPending)=>{
 const user=userEvent.setup(),commands:Array<{command:string;data:unknown}>=[];
 let deleted=false;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'delete-csrf',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,total:deleted?0:1,episodeCount:deleted?0:1,accountCounts:{[id]:deleted?0:1},episodes:deleted?[]:[{...data.episodes[0],is_test:false,archived_at:at}]});
  if(path.endsWith('/episode-lifecycle')){
   expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('delete-csrf');
   const body=JSON.parse(String(init?.body));commands.push(body);
   if(body.command==='planDeletion')return Response.json({path:'/fixture/episodes/'+episode,paths:['/fixture/episodes/'+episode,'/external/account/episodes/'+episode],revision:'fixture-revision',confirmation:'普通长度完整生产单'});
   expect(body).toMatchObject({command:'deleteEpisode',data:{episodeId:episode,confirmation:'普通长度完整生产单',expectedPath:'/fixture/episodes/'+episode,expectedPaths:['/fixture/episodes/'+episode,'/external/account/episodes/'+episode],expectedRevision:'fixture-revision'}});
   deleted=true;return Response.json({cleanupPending});
  }
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 await user.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));
 await user.selectOptions(await screen.findByRole('combobox',{name:'归档范围'}),'archived');
 await user.click(await screen.findByRole('button',{name:'生产单操作：普通长度完整生产单'}));
 await user.click(screen.getByRole('menuitem',{name:'永久删除'}));
 const modal=screen.getByRole('form',{name:'永久删除生产单'}),confirm=within(modal).getByRole('button',{name:'确认永久删除'});
 expect((confirm as HTMLButtonElement).disabled).toBe(true);
 expect(await within(modal).findByText('/fixture/episodes/'+episode)).toBeTruthy();
 expect(within(modal).getByText('/external/account/episodes/'+episode)).toBeTruthy();
 expect(within(modal).getByRole('list',{name:'已核查的生产单目录'}).children).toHaveLength(2);
 await user.type(within(modal).getByLabelText('永久删除确认文本'),'错误标题');
 expect((confirm as HTMLButtonElement).disabled).toBe(true);expect(commands.map(c=>c.command)).toEqual(['planDeletion']);
 await user.clear(within(modal).getByLabelText('永久删除确认文本'));
 await user.type(within(modal).getByLabelText('永久删除确认文本'),'普通长度完整生产单');
 await user.click(confirm);
 await waitFor(()=>expect(screen.queryByRole('form',{name:'永久删除生产单'})).toBeNull());
 expect(commands.map(c=>c.command)).toEqual(['planDeletion','deleteEpisode']);
 expect(screen.queryByText('普通长度完整生产单')).toBeNull();
 if(cleanupPending)expect(screen.getByRole('alert').textContent).toContain('文件清理尚未完成');
});

it.each(['plan','delete'])('shows a %s failure inside the confirmation dialog instead of leaving the click without feedback',async(failureAt)=>{
 const user=userEvent.setup(),commands:string[]=[];
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'plan-error-csrf',owner:{id,email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json({...data,total:1,episodes:[{...data.episodes[0],title:'测试',is_test:false,archived_at:at}]});
  if(path.endsWith('/episode-lifecycle')){const body=JSON.parse(String(init?.body));commands.push(body.command);if(body.command==='planDeletion'&&failureAt==='delete')return Response.json({path:'/mapped/episodes/'+episode,revision:'revision',confirmation:'测试'});return Response.json({error:failureAt==='plan'?'本地生产单不可见。':'生产单有运行任务，暂时不能删除。'},{status:failureAt==='plan'?404:409});}
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 await user.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));
 await user.selectOptions(await screen.findByRole('combobox',{name:'归档范围'}),'archived');
 await user.click(await screen.findByRole('button',{name:'生产单操作：测试'}));
 await user.click(screen.getByRole('menuitem',{name:'永久删除'}));
 const modal=screen.getByRole('form',{name:'永久删除生产单'});
 if(failureAt==='delete'){await within(modal).findByText('/mapped/episodes/'+episode);await user.type(within(modal).getByLabelText('永久删除确认文本'),'测试');await user.click(within(modal).getByRole('button',{name:'确认永久删除'}));}
 expect((await within(modal).findByRole('alert')).textContent).toContain(failureAt==='plan'?'本地生产单不可见。':'生产单有运行任务');
 expect(screen.getByRole('form',{name:'永久删除生产单'})).toBeTruthy();
 if(failureAt==='plan')expect((within(modal).getByRole('button',{name:'确认永久删除'}) as HTMLButtonElement).disabled).toBe(true);
 expect(commands).toEqual(failureAt==='plan'?['planDeletion']:['planDeletion','deleteEpisode']);
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
