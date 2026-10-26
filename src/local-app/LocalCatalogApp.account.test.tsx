import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
const accountId='10000000-0000-4000-8000-000000000001',blueprintId='10000000-0000-4000-8000-000000000002',at='2026-10-25T00:00:00Z';
function catalog(revision='a'.repeat(32)):LocalCatalog{return{accounts:[{id:accountId,name:'Native account',slug:'native-account',timezone:'UTC',created_at:at,archived_at:null,current_blueprint_version_id:blueprintId}],blueprints:[{id:blueprintId,account_id:accountId,version:1,policy:{},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[blueprintId]:revision},episodes:[],series:[],seriesVersions:[],promptVersions:[],sourceCreatedAt:at,importedAt:at,page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};}
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('checks the exact current blueprint through the local Owner command and displays its real blocker',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'blueprint-check-csrf'});
  if(path.includes('/catalog?'))return Response.json(catalog());
  if(path.endsWith('/account-commands')){
   expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('blueprint-check-csrf');
   expect(JSON.parse(String(init?.body))).toMatchObject({command:'checkBlueprint',data:{accountId,blueprintVersionId:blueprintId,expectedRevision:'a'.repeat(32)}});
   return Response.json({version:'worker-preflight/v2',checks:[{capability:'worker_runtime',check:'command_availability',phase:'preflight',status:'unavailable',scope:'worker',action:'contact_environment_admin',reason:'Native Worker unavailable fixture'}]});
  }return Response.json({connections:[],versions:[],capabilities:{externalReady:false}});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 const rail=screen.getByLabelText('账号默认配置检查');fireEvent.click(within(rail).getByRole('button',{name:'重新检查'}));
 await waitFor(()=>expect(rail.textContent).toContain('Native Worker unavailable fixture'));
 expect(within(rail).getByRole('heading',{name:'1 项需要处理'})).toBeTruthy();
 expect(rail.textContent).not.toContain('尚未接管');
});
it('does not show an old successful check after the saved blueprint revision changes',async()=>{
 vi.stubGlobal('crypto',webcrypto);let revision='a'.repeat(32),finish!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'preflight-generation'});
  if(path.includes('/catalog?'))return Response.json(catalog(revision));
  if(path.endsWith('/account-commands'))return new Promise<Response>(r=>{finish=r;});
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});const rail=screen.getByLabelText('账号默认配置检查');fireEvent.click(within(rail).getByRole('button',{name:'重新检查'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 revision='b'.repeat(32);await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^刷新$/}));});
 await act(async()=>{finish(Response.json({version:'worker-preflight/v2',checks:[{capability:'worker_runtime',check:'command_availability',phase:'preflight',status:'passed',scope:'worker',action:'none',reason:'Old successful check'}]}));});
 expect(within(rail).getByRole('heading',{name:'等待运行检查'})).toBeTruthy();expect(rail.textContent).not.toContain('已具备生产条件');
});
it('does not start a blueprint check while logout is pending',async()=>{
 vi.stubGlobal('crypto',webcrypto);let finishLogout!:(response:Response)=>void,checks=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'preflight-logout'});
  if(path.includes('/catalog?'))return Response.json(catalog());
  if(path.endsWith('/logout'))return new Promise<Response>(r=>{finishLogout=r;});
  if(path.endsWith('/account-commands')){checks++;return Response.json({version:'worker-preflight/v2',checks:[]});}
  return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});fireEvent.click(screen.getByRole('button',{name:'退出登录'}));await waitFor(()=>expect(finishLogout).toBeTypeOf('function'));
 fireEvent.click(within(screen.getByLabelText('账号默认配置检查')).getByRole('button',{name:'重新检查'}));expect(checks).toBe(0);
 await act(async()=>{finishLogout(Response.json({}));});await screen.findByRole('button',{name:'使用密码登录'});
});
it('keeps the new account check when the previous account check returns late',async()=>{
 vi.stubGlobal('crypto',webcrypto);const secondAccountId='20000000-0000-4000-8000-000000000001',secondBlueprintId='20000000-0000-4000-8000-000000000002';
 const next=catalog();next.accounts.push({...next.accounts[0],id:secondAccountId,name:'Second account',slug:'second-account',current_blueprint_version_id:secondBlueprintId});next.blueprints.push({...next.blueprints[0],id:secondBlueprintId,account_id:secondAccountId});next.blueprintRevisions[secondBlueprintId]='b'.repeat(32);
 let finishOld!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'account-switch'});
  if(path.includes('/catalog?'))return Response.json(next);
  if(path.endsWith('/account-commands')){
   const data=JSON.parse(String(init?.body)).data;
   if(data.accountId===accountId)return new Promise<Response>(resolve=>{finishOld=resolve;});
   expect(data).toMatchObject({accountId:secondAccountId,blueprintVersionId:secondBlueprintId,expectedRevision:'b'.repeat(32)});
   return Response.json({version:'worker-preflight/v2',checks:[{capability:'worker_runtime',check:'command_availability',phase:'preflight',status:'unavailable',scope:'worker',action:'contact_environment_admin',reason:'Current account blocker'}]});
  }return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 const rail=screen.getByLabelText('账号默认配置检查');fireEvent.click(within(rail).getByRole('button',{name:'重新检查'}));await waitFor(()=>expect(finishOld).toBeTypeOf('function'));
 fireEvent.change(screen.getByRole('combobox',{name:'当前账号'}),{target:{value:secondAccountId}});
 fireEvent.click(within(rail).getByRole('button',{name:'重新检查'}));await waitFor(()=>expect(rail.textContent).toContain('Current account blocker'));
 await act(async()=>{finishOld(Response.json({version:'worker-preflight/v2',checks:[{capability:'worker_runtime',check:'command_availability',phase:'preflight',status:'passed',scope:'worker',action:'none',reason:'Old account success'}]}));});
 expect(rail.textContent).toContain('Current account blocker');expect(rail.textContent).not.toContain('Old account success');
});
it('keeps the relogged-in session check when an old session check returns late',async()=>{
 vi.stubGlobal('crypto',webcrypto);let finishOld!:(response:Response)=>void,checks=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'old-session'});
  if(path.endsWith('/login'))return Response.json({csrfToken:'new-session'});
  if(path.endsWith('/logout'))return Response.json({});
  if(path.includes('/catalog?'))return Response.json(catalog());
  if(path.endsWith('/account-commands')){
   checks++;if(checks===1)return new Promise<Response>(resolve=>{finishOld=resolve;});
   expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('new-session');
   return Response.json({version:'worker-preflight/v2',checks:[{capability:'worker_runtime',check:'command_availability',phase:'preflight',status:'unavailable',scope:'worker',action:'contact_environment_admin',reason:'New session blocker'}]});
  }return Response.json({connections:[],versions:[]});
 }));
 await act(async()=>{render(<LocalCatalogApp/>);});
 fireEvent.click(within(screen.getByLabelText('账号默认配置检查')).getByRole('button',{name:'重新检查'}));await waitFor(()=>expect(finishOld).toBeTypeOf('function'));
 fireEvent.click(screen.getByRole('button',{name:'退出登录'}));await screen.findByRole('button',{name:'使用密码登录'});
 fireEvent.change(screen.getByLabelText('邮箱'),{target:{value:'owner@example.test'}});fireEvent.change(screen.getByLabelText('密码'),{target:{value:'synthetic-password'}});fireEvent.click(screen.getByRole('button',{name:'使用密码登录'}));
 const rail=await screen.findByLabelText('账号默认配置检查');fireEvent.click(within(rail).getByRole('button',{name:'重新检查'}));await waitFor(()=>expect(rail.textContent).toContain('New session blocker'));
 await act(async()=>{finishOld(Response.json({version:'worker-preflight/v2',checks:[{capability:'worker_runtime',check:'command_availability',phase:'preflight',status:'passed',scope:'worker',action:'none',reason:'Old session success'}]}));});
 expect(rail.textContent).toContain('New session blocker');expect(rail.textContent).not.toContain('Old session success');expect(checks).toBe(2);
});
