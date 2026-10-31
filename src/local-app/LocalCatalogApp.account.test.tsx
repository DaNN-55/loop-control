import userEvent from '@testing-library/user-event';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
const accountId='10000000-0000-4000-8000-000000000001',blueprintId='10000000-0000-4000-8000-000000000002',at='2026-10-25T00:00:00Z';
function catalog(revision='a'.repeat(32)):LocalCatalog{return{accounts:[{id:accountId,name:'Native account',slug:'native-account',timezone:'UTC',created_at:at,archived_at:null,current_blueprint_version_id:blueprintId}],blueprints:[{id:blueprintId,account_id:accountId,version:1,policy:{},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[blueprintId]:revision},episodes:[],series:[],seriesVersions:[],promptVersions:[],sourceCreatedAt:at,importedAt:at,page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};}
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('the blueprint page offers creative configuration without review switches or readiness requests',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const fetcher=vi.fn(async(path:string,_init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'blueprint-session'});
  if(path.includes('/catalog?'))return Response.json(catalog());
  return Response.json({connections:[],versions:[],capabilities:{externalReady:false}});
 });vi.stubGlobal('fetch',fetcher);
 await act(async()=>{render(<LocalCatalogApp/>);});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'账号蓝图'}));});
 expect(screen.getByLabelText('账号定位')).toBeTruthy();
 expect(screen.queryByText('审核设置')).toBeNull();expect(screen.queryByLabelText('账号默认配置检查')).toBeNull();
 expect(screen.getByRole('button',{name:'保存蓝图'})).toBeTruthy();
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'账号操作'}));await user.click(screen.getByRole('menuitem',{name:'刷新账号'}));
 expect(fetcher.mock.calls.some(([path,init])=>String(path).includes('/account-commands')&&JSON.parse(String(init?.body??'{}')).command==='checkBlueprint')).toBe(false);
});
