import{flushSync}from'react-dom';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,act,within} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
import {localCommand} from './client';
async function productionButton(){return within(await screen.findByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'});}
function clickLogout(){if(!screen.queryByRole('menuitem',{name:'退出登录'}))flushSync(()=>{fireEvent.click(screen.getAllByRole('button',{name:'所有者设置'})[0]);});fireEvent.click(screen.getByRole('menuitem',{name:'退出登录'}));}
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('keeps a committed series save successful when its follow-up read fails',async()=>{
 const accountId='10000000-0000-4000-8000-000000000001',blueprintId='10000000-0000-4000-8000-000000000002',seriesId='10000000-0000-4000-8000-000000000003',ownerId='10000000-0000-4000-8000-000000000004',at='2026-10-23T00:00:00Z';
 const version={id:'10000000-0000-4000-8000-000000000005',account_id:accountId,series_id:seriesId,version:1,rules:{positioning:'before'},created_by:ownerId,created_at:at};
 const catalog:LocalCatalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts:[{id:accountId,slug:'fixture',name:'Fixture',timezone:'UTC',current_blueprint_version_id:blueprintId,created_at:at,archived_at:null}],blueprints:[{id:blueprintId,account_id:accountId,version:1,policy:{},is_active:true,created_at:at,archived_at:null,is_snapshot:false}],episodes:[],series:[{id:seriesId,account_id:accountId,name:'Fixture series',created_at:at}],seriesVersions:[version],promptVersions:[],blueprintRevisions:{[blueprintId]:'initial'},sourceCreatedAt:at,importedAt:at};
 let saved=false,readFailure=false,posts=0;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/session'))return json({owner:{id:ownerId},csrfToken:'synthetic-csrf'});
  if(path.endsWith('/configuration')){posts++;expect(JSON.parse(String(init?.body)).command).toBe('createSeriesVersion');saved=true;return json({...version,id:'10000000-0000-4000-8000-000000000006',version:2,rules:{positioning:'saved'}});}
  if(saved&&!readFailure){readFailure=true;return json({error:'induced catalog read failure'},503);}
  return json(saved?{...catalog,seriesVersions:[{...version,id:'10000000-0000-4000-8000-000000000006',version:2,rules:{positioning:'saved'}},version]}:catalog);
 }));
 // Finish asynchronous session/catalog initialization before switching account tabs.
 await act(async()=>{render(<LocalCatalogApp/>);});
 fireEvent.click(await screen.findByRole('tab',{name:'系列'}));
 fireEvent.change(screen.getByRole('textbox',{name:'系列定位'}),{target:{value:'saved'}});
 fireEvent.click(screen.getByRole('button',{name:'保存为 v2'}));
 fireEvent.click(screen.getByRole('button',{name:'确认保存为 v2'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('配置已保存'));
 expect(screen.queryByRole('dialog',{name:'确认保存系列版本'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Fixture series · 当前 v2'})).toBeTruthy());
 expect(posts).toBe(1);
});
function pagedCatalog(title:string,page=1):LocalCatalog{return{accounts:[],blueprints:[],episodes:[{id:title,title,stage:'qc_review',account_id:'fixture',blueprint_version_id:'fixture',series_version_id:null,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z',archived_at:null} as LocalCatalog['episodes'][number]],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:'2026-10-25',importedAt:'2026-10-25',page,pageSize:20,total:60,episodeCount:60,accountCounts:{},reviewCount:3,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};}
it('requests server pages and discards a late response from an earlier filter',async()=>{
 const waiting:Array<(value:Response)=>void>=[];let catalogs=0;const paths:string[]=[];const json=(v:unknown)=>new Response(JSON.stringify(v));
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/session'))return json({csrfToken:'synthetic'});if(path.includes('/catalog?')){paths.push(path);if(catalogs++===0)return json(pagedCatalog('initial'));return new Promise<Response>(resolve=>waiting.push(resolve));}return json({});}));
 render(<LocalCatalogApp/>);fireEvent.click(await productionButton());
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(waiting).toHaveLength(1));expect(paths.at(-1)).toContain('page=2');
 fireEvent.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'审核'}));await waitFor(()=>expect(waiting).toHaveLength(2));expect(paths.at(-1)).toContain('page=1');
 waiting[1](json(pagedCatalog('new-filter')));await screen.findByText(/new-filter/);waiting[0](json(pagedCatalog('stale-page',2)));
 await waitFor(()=>expect(screen.queryByText(/stale-page/)).toBeNull());expect(screen.getByText(/new-filter/)).toBeTruthy();
});
it('does not restore an old catalog after Owner logout',async()=>{
 let resolveLate!:(value:Response)=>void,catalogs=0;const json=(v:unknown)=>new Response(JSON.stringify(v));
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/session'))return json({csrfToken:'synthetic'});if(path.includes('/catalog?'))return catalogs++===0?json(pagedCatalog('before')):new Promise<Response>(r=>{resolveLate=r;});return json({});}));
 render(<LocalCatalogApp/>);await productionButton();fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));await waitFor(()=>expect(resolveLate).toBeTypeOf('function'));clickLogout();await screen.findByRole('button',{name:'使用密码登录'});resolveLate(json(pagedCatalog('old-owner')));await waitFor(()=>expect(screen.queryByRole('button',{name:'退出登录'})).toBeNull());
});
it('refreshes the current page on becoming visible and does not fetch while hidden',async()=>{
 let reads=0;const json=(v:unknown)=>new Response(JSON.stringify(v));
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/session'))return json({csrfToken:'synthetic'});if(path.includes('/catalog?')){reads++;return json(pagedCatalog('visible'));}return json({});}));
 render(<LocalCatalogApp/>);await productionButton();const before=reads;
 const hidden=vi.spyOn(document,'hidden','get');hidden.mockReturnValue(true);fireEvent(document,new Event('visibilitychange'));expect(reads).toBe(before);hidden.mockReturnValue(false);fireEvent(document,new Event('visibilitychange'));await waitFor(()=>expect(reads).toBe(before+1));hidden.mockRestore();
});
it('does not start a new catalog read while logout is pending',async()=>{
 let reads=0,finishLogout!:(value:Response)=>void;const json=(v:unknown)=>new Response(JSON.stringify(v));
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/session'))return json({csrfToken:'synthetic'});if(path.endsWith('/logout'))return new Promise<Response>(r=>{finishLogout=r;});if(path.includes('/catalog?')){reads++;return json(pagedCatalog('owner'));}return json({});}));
 render(<LocalCatalogApp/>);await productionButton();const before=reads;clickLogout();await waitFor(()=>expect(finishLogout).toBeTypeOf('function'));fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));expect(reads).toBe(before);finishLogout(json({}));await screen.findByRole('button',{name:'使用密码登录'});
});
it.each(['network','503'] as const)('returns to login after %s logout failure without accepting old reads, then restores writable CSRF on login',async fault=>{
 let reads=0,failLogout!:()=>void,resolveOld!:(response:Response)=>void;
 const currentCsrf='synthetic-p2-current-csrf',json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
 let loggedInAgain=false,writes=0;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return json({csrfToken:'synthetic-p2-old-csrf'});
  if(path.endsWith('/logout'))return new Promise<Response>((resolve,reject)=>{failLogout=()=>fault==='network'?reject(new TypeError('Controlled local transport failure')):resolve(json({error:'Controlled local service error'},503));});
  if(path.endsWith('/login')){loggedInAgain=true;return json({csrfToken:currentCsrf});}
  if(path.includes('/catalog?')){reads++;if(reads===2)return new Promise<Response>(resolve=>{resolveOld=resolve;});return json(pagedCatalog(loggedInAgain?'current-owner':'before-logout'));}
  if(path.endsWith('/configuration')){expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(currentCsrf);writes++;return json({saved:true});}
  return json({});
 }));
 render(<LocalCatalogApp/>);
 fireEvent.click(await productionButton());
 fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));
 await waitFor(()=>expect(resolveOld).toBeTypeOf('function'));
 clickLogout();
 await waitFor(()=>expect(failLogout).toBeTypeOf('function'));
 const before=reads;fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));expect(reads).toBe(before);
 await act(async()=>{failLogout();});
 expect(await screen.findByRole('button',{name:'使用密码登录'})).toBeTruthy();
 expect(screen.getByRole('alert').textContent).toContain('未能确认退出，请重新登录');
 expect(screen.queryByRole('complementary',{name:'主导航'})).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'邮箱'}),{target:{value:'owner@p2.invalid'}});
 fireEvent.change(screen.getByLabelText('密码'),{target:{value:'synthetic-p2-password'}});
 fireEvent.click(screen.getByRole('button',{name:'使用密码登录'}));
 fireEvent.click(await productionButton());
 await screen.findByText(/current-owner/);
 await act(async()=>{resolveOld(json(pagedCatalog('stale-owner')));});
 expect(screen.queryByText(/stale-owner/)).toBeNull();
 expect(screen.getByText(/current-owner/)).toBeTruthy();
 await expect(localCommand('renameAccount',{accountId:'10000000-0000-4000-8000-000000000001',name:'P2 fixture'})).resolves.toEqual({saved:true});
 expect(writes).toBe(1);
});
it.each([
 ['network','older-first'],['503','older-first'],
 ['network','newer-first'],['503','newer-first'],
] as const)('isolates concurrent %s logout failures in %s order from a fresh login',async(fault,order)=>{
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
 const failures:Array<()=>void>=[],logoutCsrf:string[]=[],currentCsrf='synthetic-concurrent-current-csrf';
 let reads=0,loggedInAgain=false,writes=0,resolveOld!:(response:Response)=>void;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return json({csrfToken:'synthetic-concurrent-old-csrf'});
  if(path.endsWith('/logout')){
   logoutCsrf.push(new Headers(init?.headers).get('X-CSRF-Token')??'');
   if(logoutCsrf.length>2)return json({loggedOut:true});
   return new Promise<Response>((resolve,reject)=>{failures.push(()=>fault==='network'?reject(new TypeError('Controlled concurrent transport failure')):resolve(json({error:'Controlled concurrent service failure'},503)));});
  }
  if(path.endsWith('/login')){loggedInAgain=true;return json({csrfToken:currentCsrf});}
  if(path.includes('/catalog?')){reads++;if(reads===2)return new Promise<Response>(resolve=>{resolveOld=resolve;});return json(pagedCatalog(loggedInAgain?'fresh-owner':'before-concurrent-logout'));}
  if(path.endsWith('/configuration')){expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(currentCsrf);writes++;return json({saved:true});}
  return json({});
 }));
 render(<LocalCatalogApp/>);
 fireEvent.click(await productionButton());
 fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));
 await waitFor(()=>expect(resolveOld).toBeTypeOf('function'));
 clickLogout();
 clickLogout();
 await waitFor(()=>expect(failures).toHaveLength(2));
 const before=reads;
 fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));
 fireEvent(document,new Event('visibilitychange'));
 expect(reads).toBe(before);
 if(order==='older-first'){
  await act(async()=>{failures[0]();});
  expect(screen.queryByRole('button',{name:'使用密码登录'})).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));
  expect(reads).toBe(before);
 }
 await act(async()=>{failures[1]();});
 expect(await screen.findByRole('button',{name:'使用密码登录'})).toBeTruthy();
 expect(screen.getByRole('alert').textContent).toContain('未能确认退出，请重新登录');
 fireEvent.change(screen.getByRole('textbox',{name:'邮箱'}),{target:{value:'owner@concurrent.invalid'}});
 fireEvent.change(screen.getByLabelText('密码'),{target:{value:'synthetic-concurrent-password'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'使用密码登录'}));});
 fireEvent.click(await productionButton());
 await screen.findByText(/fresh-owner/);
 if(order==='newer-first')await act(async()=>{failures[0]();});
 await act(async()=>{resolveOld(json(pagedCatalog('stale-concurrent-owner')));});
 expect(screen.queryByRole('button',{name:'使用密码登录'})).toBeNull();
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.queryByText(/stale-concurrent-owner/)).toBeNull();
 expect(screen.getByText(/fresh-owner/)).toBeTruthy();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));});
 await waitFor(()=>expect(reads).toBe(before+2));
 await expect(localCommand('renameAccount',{accountId:'10000000-0000-4000-8000-000000000001',name:'Concurrent fixture'})).resolves.toEqual({saved:true});
 expect(writes).toBe(1);
 await act(async()=>{clickLogout();});
 await screen.findByRole('button',{name:'使用密码登录'});
 expect(logoutCsrf).toEqual(['synthetic-concurrent-old-csrf','synthetic-concurrent-old-csrf',currentCsrf]);
});
it('returns to login and clears the visible workspace when a remote local session is revoked',async()=>{
 let revoked=false;vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/session'))return Response.json({owner:{id:'owner'},csrfToken:'fixture'});if(path.includes('/catalog?'))return revoked?Response.json({error:'请先登录所有者。'},{status:401}):Response.json(pagedCatalog('revoked-owner-data'));return Response.json({connections:[],versions:[]});}));
 render(<LocalCatalogApp/>);fireEvent.click(await productionButton());await screen.findByText('revoked-owner-data');revoked=true;fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));await screen.findByRole('button',{name:'使用密码登录'});expect(screen.queryByText('revoked-owner-data')).toBeNull();
});
