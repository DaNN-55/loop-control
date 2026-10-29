import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';

vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:({embedded}:{embedded?:boolean})=>embedded?<section aria-label="系统报告"/>:null}));
vi.mock('./LocalEpisodeDetail',()=>({LocalEpisodeDetail:({episodeId}:{episodeId:string})=><p>实际生产单 {episodeId}</p>}));
const accountId='10000000-0000-4000-8000-000000000001';
const seriesId='30000000-0000-4000-8000-000000000001';
const seriesVersionId='30000000-0000-4000-8000-000000000002';
const at='2026-10-28T00:00:00Z';
const uuid=(index:number)=>`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
function episode(index:number,title='生产单') {return {id:uuid(index),account_id:accountId,blueprint_version_id:accountId,series_version_id:seriesVersionId,stage:'script_review',title:`${title} ${index}`,created_at:at,updated_at:at,archived_at:null,is_test:false};}
function batch(page:number,total:number,title:string,offset=0) {return Array.from({length:Math.min(20,Math.max(0,total-(page-1)*20))},(_,index)=>episode(offset+(page-1)*20+index+1,title));}
function fixture(query:URLSearchParams):LocalCatalog {
  const page=Number(query.get('page')??1),pendingPage=Number(query.get('pendingPage')??1),blockedPage=Number(query.get('blockedPage')??1);
  const episodes=batch(page,61,'生产单');
  return {accounts:[{id:accountId,name:'原始账号',slug:'original',timezone:'Asia/Shanghai',created_at:at,archived_at:null,current_blueprint_version_id:accountId}],blueprints:[{id:accountId,account_id:accountId,version:1,policy:{},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[accountId]:'a'.repeat(32)},episodes,series:[{id:seriesId,account_id:accountId,name:'原始系列',created_at:at,archived_at:null}],seriesVersions:[{id:seriesVersionId,series_id:seriesId,version:1,rules:{},created_at:at}],promptVersions:[],sourceCreatedAt:at,importedAt:at,page,pageSize:20,total:61,episodeCount:78,accountCounts:{[accountId]:78},reviewCount:52,statusCounts:{all:61,review:45,running:2,blocked:3,done:0},stages:{script_review:61},artifactCounts:{},pending:{page:pendingPage,total:45,items:batch(pendingPage,45,'审核包',100).map(item=>({...item,revision_number:3}))},blocked:{page:blockedPage,total:43,items:batch(blockedPage,43,'阻塞生产单',200).map(item=>({episode:item,blocker:{code:'CONFIGURATION_REQUIRED',detail:'请补全冻结配置。',taskId:`task-${item.id}`}}))},worker:{running:2,blocked:3,failed:1,latestCompleted:false},operationRows:episodes.map(item=>({episodeId:item.id,reviewRevision:3,reviewPending:true,blockerCount:0}))} as unknown as LocalCatalog;
}
function setup(options:{studioFails?:boolean}={}) {
  const queries:URLSearchParams[]=[];
  const posts:Array<{path:string;body:Record<string,unknown>;headers:Headers}>=[];
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
    if(path.endsWith('/session'))return Response.json({csrfToken:'navigation-fixture-csrf',owner:{id:accountId,email:'owner@example.test'}});
    if(path.includes('/catalog?')){const query=new URL(path,'http://localhost').searchParams;queries.push(query);return Response.json(fixture(query));}
    if(init?.method==='POST'){posts.push({path,body:JSON.parse(String(init.body)),headers:new Headers(init.headers)});return options.studioFails?Response.json({error:'Studio 工作区不可用，请重试。'},{status:503}):Response.json({});}
    if(path.endsWith('/deletion-cleanups'))return Response.json([]);
    if(path.includes('/history-episodes?'))return Response.json({items:[],total:0,page:1,pageSize:30,selected:null,files:[],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,recordTotal:0}});
    if(path.includes('/history?'))return Response.json({summary:{versions:'0',files:'0'},sources:[],source:null,versions:[],files:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,versionTotal:0},sourceCounts:{active:0,archived:0}});
    return Response.json({connections:[],versions:[],pending:[],capabilities:{secrets:'keychain',verification:'live',externalReady:false,networkAvailable:false}});
  }));
  return {queries,posts,lastQuery:()=>queries.at(-1)!};
}
const nav=()=>within(screen.getByRole('complementary',{name:'主导航'}));
async function mount(){await act(async()=>{render(<LocalCatalogApp/>);});await screen.findByRole('heading',{name:'工作台',level:1});}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();history.replaceState(null,'','/');localStorage.clear();sessionStorage.clear();});

it('待审核合并到生产单，工作台审核入口使用真实目录筛选',async()=>{
 const {queries,lastQuery}=setup();await mount();
 expect(lastQuery().get('view')).toBe('operations');
 expect(nav().queryByRole('button',{name:'待审核'})).toBeNull();
 expect(nav().getByRole('button',{name:'生产单'}).textContent).toContain('45');
 fireEvent.click(screen.getByRole('button',{name:'查看待审核'}));
 await screen.findByRole('table',{name:'生产单'});
 expect(lastQuery().get('view')).toBe('episodes');expect(lastQuery().get('status')).toBe('review');
 expect(screen.getByRole('tab',{name:'待审核'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tab',{name:'待审核'}).textContent).toContain('45');
 const count=queries.length;
 for(const label of ['连接配置','历史资料']){fireEvent.click(nav().getByRole('button',{name:label}));await screen.findByRole('heading',{name:label,level:1});}
 expect(queries).toHaveLength(count);
 fireEvent.click(nav().getByRole('button',{name:'账号蓝图'}));await waitFor(()=>expect(lastQuery().get('view')).toBe('accounts'));
 expect(queries.every(q=>['accounts','episodes','operations'].includes(q.get('view')??''))).toBe(true);
 expect(queries.every(q=>Array.from(q.keys()).sort().join(',')==='accountId,blockedPage,page,pendingPage,q,seriesId,sort,status,view,visibility')).toBe(true);
});

it('工作台生产单和阻塞队列独立服务端分页，筛选重置页码',async()=>{
 const {lastQuery}=setup();await mount();
 fireEvent.click(within(screen.getByRole('region',{name:'系列生产单'})).getByRole('button',{name:'下一页'}));
 await waitFor(()=>expect(lastQuery().get('page')).toBe('2'));
 await screen.findByRole('complementary',{name:'当前作品'});
 expect(within(screen.getByRole('region',{name:'系列生产单'})).getByText('生产单 21')).toBeTruthy();
 let blocked=screen.getByRole('heading',{name:'阻塞项',level:3}).closest('section')!;
 fireEvent.click(within(blocked).getByRole('button',{name:'下一页'}));
 await waitFor(()=>expect(lastQuery().get('blockedPage')).toBe('2'));
 expect(lastQuery().get('page')).toBe('2');expect(lastQuery().get('pendingPage')).toBe('1');
 await screen.findByText('阻塞生产单 221');
 fireEvent.change(screen.getByRole('combobox',{name:'运营系列筛选'}),{target:{value:seriesId}});
 await waitFor(()=>expect(lastQuery().get('seriesId')).toBe(seriesId));
 expect(['page','pendingPage','blockedPage'].map(key=>lastQuery().get(key))).toEqual(['1','1','1']);
 await screen.findByRole('complementary',{name:'当前作品'});
 expect(within(screen.getByRole('region',{name:'系列生产单'})).getByText('生产单 1')).toBeTruthy();
});

it('选择作品更新下一步，打开及返回详情保留第二页上下文',async()=>{
 const {lastQuery,queries}=setup();await mount();
 fireEvent.click(within(screen.getByRole('region',{name:'系列生产单'})).getByRole('button',{name:'下一页'}));
 await waitFor(()=>expect(lastQuery().get('page')).toBe('2'));
 await screen.findByRole('complementary',{name:'当前作品'});
 fireEvent.click(within(screen.getByRole('region',{name:'系列生产单'})).getByText('生产单 22'));
 const current=screen.getByRole('complementary',{name:'当前作品'});expect(within(current).getByRole('heading',{name:'生产单 22'})).toBeTruthy();
 const before=lastQuery().toString(),count=queries.length;
 fireEvent.click(within(current).getByRole('button',{name:'继续审核'}));
 await screen.findByText('实际生产单 '+uuid(22));
 expect(document.getElementById('main-content')?.hasAttribute('inert')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'返回工作区'}));
 expect(document.getElementById('main-content')?.hasAttribute('inert')).toBe(false);
 expect(location.search).toBe('');expect(lastQuery().toString()).toBe(before);expect(queries).toHaveLength(count);
 expect(within(screen.getByRole('complementary',{name:'当前作品'})).getByRole('heading',{name:'生产单 22'})).toBeTruthy();
});

it('搜索、状态和排序全部送服务端，切换范围重置分页且不写业务数据',async()=>{
 const {lastQuery,posts}=setup();await mount();fireEvent.click(nav().getByRole('button',{name:'生产单'}));await screen.findByRole('table',{name:'生产单'});
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(lastQuery().get('page')).toBe('2'));await screen.findByRole('row',{name:/生产单 21/});
 fireEvent.change(screen.getByRole('textbox',{name:'搜索标题或编号'}),{target:{value:'指定标题'}});fireEvent.submit(screen.getByRole('search',{name:'搜索生产单'}));
 await waitFor(()=>expect(lastQuery().get('q')).toBe('指定标题'));expect(lastQuery().get('page')).toBe('1');
 await screen.findByRole('table',{name:'生产单'});
 fireEvent.change(screen.getByRole('combobox',{name:'生产单排序'}),{target:{value:'title'}});await waitFor(()=>expect(lastQuery().get('sort')).toBe('title'));
 await screen.findByRole('table',{name:'生产单'});fireEvent.click(screen.getByRole('tab',{name:'待审核'}));await waitFor(()=>expect(lastQuery().get('status')).toBe('review'));
 expect(lastQuery().get('visibility')).toBe('active');expect(lastQuery().get('q')).toBe('指定标题');
 fireEvent.keyDown(screen.getByRole('tab',{name:'待审核'}),{key:'ArrowRight'});await waitFor(()=>expect(lastQuery().get('status')).toBe('running'));expect(posts).toHaveLength(0);
});

it('侧栏分组和底部工具保持已认可设计，Owner焦点与状态不丢',async()=>{
 setup();await mount();
 expect(within(nav().getByRole('group',{name:'生产工作'})).getAllByRole('button').map(b=>b.getAttribute('aria-label'))).toEqual(['工作台','生产单']);
 expect(within(nav().getByRole('group',{name:'配置与资料'})).getAllByRole('button').map(b=>b.getAttribute('aria-label'))).toEqual(['连接配置','历史资料']);
 expect(nav().getByRole('button',{name:/OpenChatCut/}).closest('.sidebar-footer')).toBeTruthy();
 fireEvent.click(nav().getByRole('button',{name:'切换至深色模式'}));expect(nav().getByRole('button',{name:'切换至浅色模式'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(nav().getByRole('button',{name:'收起侧栏'}));expect(nav().getByRole('button',{name:'展开侧栏'}).getAttribute('aria-pressed')).toBe('true');
 const owner=nav().getByRole('button',{name:'所有者设置'});fireEvent.click(owner);fireEvent.click(await screen.findByRole('menuitem',{name:'登录与安全'}));await screen.findByRole('dialog',{name:'登录与安全'});expect(owner.getAttribute('data-active')).toBe('true');
});

it('制作区Studio失败通知仍在可操作区域并保留CSRF',async()=>{
 const {posts}=setup({studioFails:true});const close=vi.fn();vi.spyOn(window,'open').mockReturnValue({close,location:{replace:vi.fn()}}as unknown as Window);await mount();
 fireEvent.click(within(screen.getByRole('complementary',{name:'当前作品'})).getByRole('button',{name:'继续审核'}));await screen.findByText('实际生产单 '+uuid(1));
 fireEvent.click(nav().getByRole('button',{name:'打开 OpenChatCut 独立剪辑'}));const alert=await screen.findByRole('alert');expect(alert.textContent).toContain('Studio 工作区不可用');expect(alert.closest('[inert]')).toBeNull();expect(close).toHaveBeenCalledOnce();
 expect(posts[0].body).toMatchObject({command:'openStandaloneStudio',data:{}});expect(posts[0].headers.get('X-CSRF-Token')).toBe('navigation-fixture-csrf');
});
