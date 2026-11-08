import {act,cleanup,configure,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {defaultOwnerPreferences} from '../preferences/preferences';
import {LocalCatalogApp} from './LocalCatalogApp';
import {draftOwner,draftEpisode,draftCatalog,draftSnapshot,draftWorkspace} from './fixtures/workspaceDraftFixture';
configure({asyncUtilTimeout:8000});
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/');});
function fixture(){const reads:URLSearchParams[]=[],writes:string[]=[];vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(init?.method==='POST'){writes.push(path);return Response.json({error:'No writes allowed'},{status:400});}if(path.endsWith('/session'))return Response.json({csrfToken:'synthetic',owner:{id:draftOwner}});if(path.includes('/catalog?')){reads.push(new URL(path,'http://localhost').searchParams);return Response.json(draftCatalog);}if(path.endsWith('/workspace'))return Response.json({workspace:draftWorkspace(new URL(path,'http://localhost').pathname.split('/')[4])});if(path.includes('?known='))return Response.json({hashes:{},sections:draftSnapshot(new URL(path,'http://localhost').pathname.split('/')[4])});if(path.includes('/workspace/project?'))return Response.json({project:null});return Response.json({connections:[],versions:[],capabilities:{secrets:'synthetic',verification:'disabled',externalReady:false},serviceCatalog:{groups:[]}});}));return {reads,writes};}
it('opens and reloads the URL list context while keeping unsubmitted search out of navigation',async()=>{
 history.replaceState(null,'','/?view=episodes&accountId=account&q=金山&visibility=archived&status=blocked&sort=title&page=3');const {reads,writes}=fixture();let app=render(<LocalCatalogApp/>);
 const search=within(await screen.findByRole('search',{name:'搜索生产单'}));expect((search.getByRole('textbox') as HTMLInputElement).value).toBe('金山');expect(reads.at(-1)?.get('page')).toBe('3');expect((screen.getByRole('combobox',{name:'归档范围'}) as HTMLSelectElement).value).toBe('archived');
 fireEvent.change(search.getByRole('textbox'),{target:{value:'未搜索'}});expect(new URLSearchParams(location.search).get('q')).toBe('金山');fireEvent.submit(search.getByRole('textbox').closest('form')!);await waitFor(()=>expect(new URLSearchParams(location.search).get('q')).toBe('未搜索'));
 app.unmount();app=render(<LocalCatalogApp/>);expect((await screen.findByRole('search',{name:'搜索生产单'})).querySelector('input')?.value).toBe('未搜索');expect(writes).toEqual([]);
});
it('restores episode delivery on direct opening without issuing production commands',async()=>{
 history.replaceState(null,'',`/?view=episodes&episode=${draftEpisode}&step=delivery&tab=sound`);const {writes}=fixture();render(<LocalCatalogApp/>);await screen.findByLabelText('标题');expect(screen.getByRole('button',{name:'检查与交付，当前查看'})).toBeTruthy();expect(writes).toEqual([]);
});
it('moves through list, episode and viewing steps with browser Back and Forward',async()=>{
 history.replaceState(null,'','/?view=episodes');const {writes}=fixture();render(<LocalCatalogApp/>);fireEvent.click(await screen.findByText('草稿验证生产单'));await screen.findByLabelText('主脚本');fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));await screen.findByLabelText('标题');
 act(()=>history.back());await screen.findByRole('button',{name:'脚本确认，当前查看'});await waitFor(()=>expect(new URLSearchParams(location.search).get('step')).not.toBe('delivery'));act(()=>history.back());await waitFor(()=>expect(screen.queryByRole('complementary',{name:'当前生产单详情'})).toBeNull());act(()=>history.forward());await screen.findByRole('button',{name:'脚本确认，当前查看'});act(()=>history.forward());await screen.findByRole('button',{name:'检查与交付，当前查看'});expect(writes).toEqual([]);
});
it('cancels browser Back with the draft and address intact, then keeps and completes the deferred navigation',async()=>{
 history.replaceState(null,'','/?view=episodes');const {writes}=fixture();render(<LocalCatalogApp/>);fireEvent.click(await screen.findByText('草稿验证生产单'));fireEvent.change(await screen.findByLabelText('主脚本'),{target:{value:'后退前草稿'}});await waitFor(()=>expect(new URLSearchParams(location.search).get('episode')).toBe(draftEpisode));const before=location.search;
 act(()=>history.back());await screen.findByRole('dialog',{name:'保留未提交内容'});expect(location.search).toBe(before);fireEvent.click(screen.getByRole('button',{name:'继续编辑'}));expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('后退前草稿');expect(location.search).toBe(before);
 act(()=>history.back());await screen.findByRole('dialog',{name:'保留未提交内容'});fireEvent.click(screen.getByRole('button',{name:'保留草稿并离开'}));await waitFor(()=>expect(screen.queryByRole('complementary',{name:'当前生产单详情'})).toBeNull());act(()=>history.forward());await screen.findByRole('button',{name:'脚本确认，当前查看'});await waitFor(()=>expect(new URLSearchParams(location.search).get('episode')).toBe(draftEpisode));expect((await screen.findByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('后退前草稿');expect(writes).toEqual([]);
});
it('restores account series selection',async()=>{
 history.replaceState(null,'','/?view=accounts&account=account&rulesSeries=series-one');fixture();const original=globalThis.fetch;vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.includes('/catalog?'))return Response.json({...draftCatalog,blueprints:[{id:'blueprint',account_id:'account',version:1,is_snapshot:false,policy:{positioning:'账号规则'}}],series:[{id:'series-one',account_id:'account',name:'被选中系列'}],seriesVersions:[]});return original(path,init);}));render(<LocalCatalogApp/>);expect((await screen.findByRole('button',{name:'被选中系列'})).getAttribute('aria-current')).toBe('page');
});
it('opens an old production-history link on the sources page without loading the removed view',async()=>{
 history.replaceState(null,'','/?view=history&historyTab=episodes&historyEpisode=history-one');
 const {writes}=fixture(),original=globalThis.fetch;
 const read=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.includes('/history?'))return Response.json({summary:{versions:'0',files:'0'},sources:[],source:null,versions:[],files:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,versionTotal:0},sourceCounts:{active:0,archived:0}});
  return original(path,init);
 });
 vi.stubGlobal('fetch',read);
 render(<LocalCatalogApp/>);
 await screen.findByRole('table',{name:'资料来源列表'});
 expect(screen.queryByRole('tab',{name:'生产单历史'})).toBeNull();
 expect(read.mock.calls.some(([path])=>path.includes('/history-episodes?'))).toBe(false);
 expect(writes.filter(path=>path.includes('/history'))).toEqual([]);
});
it('restores only the connection viewing dialog and list filters, keeping credentials and edit forms ephemeral',async()=>{
 history.replaceState(null,'','/?view=connections&connectionsQ=主&capability=video&connectionStatus=verified&connection=connection-one');const {writes}=fixture();const original=globalThis.fetch;vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.endsWith('/connections'))return Response.json({connections:[{id:'connection-one',name:'主 Pexels',provider:'pexels',adapter:'pexels_video',status:'verified',description:'查看恢复',current_version_id:null}],versions:[],capabilities:{secrets:'synthetic',verification:'disabled',externalReady:false,verificationAvailable:false}});return original(path,init);}));render(<LocalCatalogApp/>);await screen.findByRole('dialog',{name:'主 Pexels'});fireEvent.click(screen.getByRole('button',{name:'关闭连接窗口'}));expect((screen.getByLabelText('查找已存连接') as HTMLInputElement).value).toBe('主');expect((screen.getByRole('combobox',{name:'生产能力'}) as HTMLSelectElement).value).toBe('video');expect(screen.queryByRole('textbox',{name:/API Key/})).toBeNull();expect(writes).toEqual([]);
});
it('does not reopen a previous Owner location after the session identity changes',async()=>{
 history.replaceState({loopCatalogNavigation:{index:0,owner:'previous-owner'}},'',`/?view=episodes&episode=${draftEpisode}&step=delivery`);fixture();render(<LocalCatalogApp/>);await screen.findByRole('button',{name:'新建生产单'});await waitFor(()=>expect(new URLSearchParams(location.search).get('episode')).toBeNull());expect(screen.queryByRole('complementary',{name:'当前生产单详情'})).toBeNull();expect(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'工作台'}).getAttribute('aria-current')).toBe('page');
});
it('handles an unavailable production order through the authorized read boundary with a usable close action',async()=>{
 history.replaceState(null,'','/?view=episodes&episode=unavailable&step=delivery');const {writes}=fixture();const original=globalThis.fetch;vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>path.includes('/episodes/unavailable')?Response.json({error:'生产单不存在或不可读取。'},{status:404}):original(path,init)));render(<LocalCatalogApp/>);await screen.findByText('生产单不存在或不可读取。');fireEvent.click(screen.getByRole('button',{name:'关闭生产单详情'}));await waitFor(()=>expect(new URLSearchParams(location.search).get('episode')).toBeNull());expect(writes).toEqual([]);
});
it('opens sources directly and restores a legacy source link through reads only',async()=>{
 history.replaceState(null,'','/?view=history&historyTab=sources&source=source-one&sourceQ=文稿&sourcesQ=备份&sourceCategory=business&sourceScope=archived&sourceFilesPage=2');const {writes}=fixture();const original=globalThis.fetch,requests:URLSearchParams[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.includes('/history-episodes?'))return Response.json({items:[],selected:null,total:0,page:1,pageSize:30,files:[],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,recordTotal:0}});if(path.includes('/history?')){const p=new URL(path,'http://localhost').searchParams;requests.push(p);const source={id:'source-one',title:'已选备份来源',kind:'backup',label:'fixture',imported_at:'2026-11-02',rows:'1',files:'0',archived_at:'2026-11-02',category:'business'};return Response.json({sources:[source],source:p.get('source')?source:null,summary:{versions:'1',files:'0'},versions:[],files:[],pagination:{filesPage:2,recordsPage:1,fileTotal:60,versionTotal:0},sourceCounts:{active:0,archived:1}});}return original(path,init);}));Element.prototype.scrollIntoView=vi.fn();render(<LocalCatalogApp/>);await screen.findByRole('region',{name:'来源资料'});expect(screen.queryByRole('tablist',{name:'历史资料分类'})).toBeNull();expect(vi.mocked(fetch).mock.calls.some(([path])=>String(path).includes('/history-episodes?'))).toBe(false);expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({source:'source-one',q:'文稿',sourcesQ:'备份',category:'business',state:'archived',filesPage:'2'});expect(writes).toEqual([]);
});
it('explains stale account and series list scopes and returns to readable filters',async()=>{
 history.replaceState(null,'','/?view=episodes&accountId=gone-account&seriesId=gone-series');fixture();render(<LocalCatalogApp/>);await screen.findByText('原账号或系列已不可用，已清除对应筛选。');await waitFor(()=>expect(new URLSearchParams(location.search).has('accountId')).toBe(false));expect(new URLSearchParams(location.search).has('seriesId')).toBe(false);
});
it('ignores an older catalog response after browser Back restores the original query',async()=>{
 history.replaceState(null,'','/?view=episodes');fixture();const original=globalThis.fetch;let release:(value:Response)=>void=()=>{},waiting=false;vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.includes('/catalog?')&&new URL(path,'http://localhost').searchParams.get('q')==='slow'){waiting=true;return new Promise<Response>(resolve=>{release=resolve;});}return original(path,init);}));render(<LocalCatalogApp/>);const search=within(await screen.findByRole('search',{name:'搜索生产单'}));fireEvent.change(search.getByRole('textbox'),{target:{value:'slow'}});fireEvent.submit(search.getByRole('textbox').closest('form')!);await waitFor(()=>expect(waiting).toBe(true));await waitFor(()=>expect(new URLSearchParams(location.search).get('q')).toBe('slow'));act(()=>history.back());await waitFor(()=>expect(new URLSearchParams(location.search).get('q')).toBeNull());await screen.findByText('草稿验证生产单');await act(async()=>{release(Response.json({...draftCatalog,episodes:[{...draftCatalog.episodes[0],title:'不应显示的旧响应'}]}));});expect(screen.queryByText('不应显示的旧响应')).toBeNull();expect(screen.getByText('草稿验证生产单')).toBeTruthy();
});
it('restores the editing viewing position without opening or rebuilding a native project',async()=>{
 history.replaceState(null,'',`/?view=episodes&episode=${draftEpisode}&step=editing`);const {writes}=fixture();render(<LocalCatalogApp/>);await screen.findByText('剪辑工作台尚未连接。');expect(screen.getByRole('button',{name:'剪辑工作台，当前查看'})).toBeTruthy();expect(writes).toEqual([]);
});

it('preserves archived production navigation and legacy history bookmarks without exposing history entry points',async()=>{
 history.replaceState(null,'','/?view=history&historyQ=旧作&historyPage=2&sourcesQ=保留&sourceCategory=diagnostics&sourceScope=all&sourceFilesPage=3&sourceRecordsPage=2&outside=kept');
 const {reads,writes}=fixture(),original=globalThis.fetch;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.includes('/history-episodes?'))return Response.json({totalHistory:1,scopeCounts:{active:1,archived:0},items:[],total:0,page:1,pageSize:30,selected:null,files:[],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,recordTotal:0}});
  if(path.includes('/history?'))return Response.json({summary:{versions:'1',files:'0'},sources:[],source:null,versions:[],files:[],pagination:{filesPage:3,recordsPage:2,fileTotal:0,versionTotal:0},sourceCounts:{active:1,archived:0},categoryCounts:{diagnostics:1}});
  return original(path,init);
 }));
 render(<LocalCatalogApp/>);await screen.findByText('没有匹配的资料来源。');
 fireEvent.mouseDown(screen.getByRole('combobox',{name:'显示范围'}),{button:0});
 const scopeOptions=screen.getByRole('listbox',{name:'显示范围'});
 const archivedList=screen.getByRole('button',{name:'查看归档生产单列表'});
 expect(scopeOptions.contains(archivedList)).toBe(false);
 fireEvent.click(archivedList);
 await screen.findByRole('search',{name:'搜索生产单'});
 await waitFor(()=>expect(reads.at(-1)?.get('visibility')).toBe('archived'));
 expect((screen.getByRole('combobox',{name:'归档范围'}) as HTMLSelectElement).value).toBe('archived');
 expect(screen.queryByRole('button',{name:'查找独立历史资料'})).toBeNull();
 expect(within(screen.getByRole('complementary',{name:'主导航'})).queryByRole('button',{name:'历史资料'})).toBeNull();
 act(()=>history.back());
 await screen.findByText('没有匹配的资料来源。');
 const p=new URLSearchParams(location.search);expect(p.get('view')).toBe('history');
 expect(p.get('sourcesQ')).toBe('保留');expect(p.get('sourceCategory')).toBe('diagnostics');expect(p.get('sourceFilesPage')).toBe('3');expect(p.get('sourceRecordsPage')).toBe('2');expect(p.get('historyQ')).toBe('旧作');expect(p.get('historyPage')).toBe('2');expect(p.get('outside')).toBe('kept');expect(writes).toEqual([]);
});

it('shows the preference save error when the topbar appearance change is rejected',async()=>{
 fixture();
 const original=globalThis.fetch;
 const save=vi.fn(async()=>Response.json({error:'所有者权限不足。'},{status:403}));
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/preferences'))return init?.method==='POST'?save():Response.json({...defaultOwnerPreferences,appearance:'dark'});
  return original(path,init);
 }));
 render(<LocalCatalogApp/>);
 fireEvent.click(await screen.findByRole('button',{name:'切换至浅色模式'}));
 await waitFor(()=>expect(screen.getByText('外观偏好未保存。所有者权限不足。')).toBeTruthy());
 expect(save).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'切换至浅色模式'}).getAttribute('aria-pressed')).toBe('true');
});

it('clears one applied production filter while keeping the other filters and returning to page one',async()=>{
 history.replaceState(null,'','/?view=episodes&accountId=account&seriesId=series-one&q=金山&status=blocked&visibility=archived&sort=title&page=3');
 const {reads,writes}=fixture(),original=globalThis.fetch;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  const response=await original(path,init);
  if(!path.includes('/catalog?'))return response;
  return Response.json({...await response.json(),series:[{id:'series-one',account_id:'account',name:'城市日常'}],seriesEpisodeCounts:{'series-one':1}});
 }));
 render(<LocalCatalogApp/>);
 const summary=within(await screen.findByRole('group',{name:'已应用筛选'},{timeout:1500}));
 fireEvent.change(screen.getByRole('textbox',{name:'搜索标题或编号'}),{target:{value:'未提交搜索'}});
 expect(summary.getByRole('button',{name:'清除搜索筛选：金山'})).toBeTruthy();
 fireEvent.click(summary.getByRole('button',{name:/^清除账号筛选/}));
 await waitFor(()=>{
  const query=reads.at(-1);
  expect(query?.get('accountId')??'').toBe('');
  expect(query?.get('seriesId')).toBe('series-one');
  expect(query?.get('q')).toBe('金山');
  expect(query?.get('status')).toBe('blocked');
  expect(query?.get('visibility')).toBe('archived');
  expect(query?.get('sort')).toBe('title');
  expect(query?.get('page')).toBe('1');
 },{timeout:1500});
 expect(summary.getByRole('button',{name:'清除系列筛选：城市日常'})).toBeTruthy();
 fireEvent.click(summary.getByRole('button',{name:'清空筛选'}));
 await waitFor(()=>expect(screen.queryByRole('group',{name:'已应用筛选'})).toBeNull(),{timeout:1500});
 expect(writes).toEqual([]);
});
