import userEvent from '@testing-library/user-event';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
const accountId='10000000-0000-4000-8000-000000000001',blueprintId='10000000-0000-4000-8000-000000000002',at='2026-10-25T00:00:00Z';
function catalog(revision='a'.repeat(32)):LocalCatalog{return{accounts:[{id:accountId,name:'Native account',slug:'native-account',timezone:'UTC',created_at:at,archived_at:null,current_blueprint_version_id:blueprintId}],blueprints:[{id:blueprintId,account_id:accountId,version:1,policy:{},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[blueprintId]:revision},episodes:[],series:[],seriesVersions:[],promptVersions:[],sourceCreatedAt:at,importedAt:at,page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};}
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});
it('the blueprint page offers creative configuration without review switches or readiness requests',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const fetcher=vi.fn(async(path:string,_init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'blueprint-session'});
  if(path.endsWith('/account-commands'))return Response.json({assetRoot:null,legacyRoots:[],status:'unset'});
  if(path.includes('/catalog?'))return Response.json(catalog());
  return Response.json({connections:[],versions:[],capabilities:{externalReady:false}});
 });vi.stubGlobal('fetch',fetcher);
 await act(async()=>{render(<LocalCatalogApp/>);});const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'账号'}));await user.click(screen.getByRole('button',{name:'Native account'}));
 expect(screen.getByLabelText('账号定位')).toBeTruthy();
 expect(screen.queryByText('审核设置')).toBeNull();expect(screen.queryByLabelText('账号默认配置检查')).toBeNull();
 expect((screen.getByLabelText('账号定位') as HTMLTextAreaElement).readOnly).toBe(true);
 expect(screen.queryByRole('button',{name:'保存通用规则'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'修改'}));
 expect((screen.getByLabelText('账号定位') as HTMLTextAreaElement).readOnly).toBe(false);
 expect(screen.getByRole('button',{name:'保存通用规则'})).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'账号设置'}));await user.click(screen.getByRole('button',{name:'刷新账号'}));
 expect(fetcher.mock.calls.some(([path,init])=>String(path).includes('/account-commands')&&JSON.parse(String(init?.body??'{}')).command==='checkBlueprint')).toBe(false);
});

it('shows five active accounts, keeps archived accounts reachable, and opens a newly created account', async () => {
 vi.stubGlobal('crypto',webcrypto);
 const data=catalog();
 const baseAccount=data.accounts[0],baseBlueprint=data.blueprints[0];
 const makeAccount=(id:string,name:string,archived_at:string|null=null)=>({...baseAccount,id,name,archived_at,current_blueprint_version_id:`blueprint-${id}`});
 data.accounts=Array.from({length:6},(_,index)=>makeAccount(`account-${index+1}`,`测试账号 ${index+1}`));
 data.accounts.push(makeAccount('archived','旧账号',at));
 data.blueprints=data.accounts.map(account=>({...baseBlueprint,account_id:account.id,id:account.current_blueprint_version_id!}));
 const created=makeAccount('new-account','新建测试账号');
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'account-sidebar-fixture'});
  if(path.includes('/catalog?'))return Response.json(data);
  if(path.endsWith('/configuration')){
   expect(JSON.parse(String(init?.body))).toMatchObject({command:'createAccount',data:{name:created.name}});
   data.accounts.push(created);
   data.blueprints.push({...baseBlueprint,account_id:created.id,id:created.current_blueprint_version_id!});
   return Response.json(created);
  }
  return Response.json({connections:[],versions:[]});
 }));
 const user=userEvent.setup();
 render(<LocalCatalogApp/>);
 const sidebar=within(await screen.findByRole('group',{name:'账号管理'}));
 await user.click(sidebar.getByRole('button',{name:'账号'}));
 expect(within(sidebar.getByRole('list',{name:'使用中的账号'})).getAllByRole('button')).toHaveLength(5);
 expect(screen.getByRole('heading',{name:'内容工作台'})).toBeTruthy();
 await user.click(sidebar.getByRole('button',{name:'查看全部 6 个账号'}));
 await user.click(sidebar.getByRole('button',{name:'测试账号 6'}));
 expect(screen.getByRole('heading',{name:'测试账号 6',level:1})).toBeTruthy();
 await user.click(sidebar.getByRole('button',{name:'已归档 · 1'}));
 await user.click(sidebar.getByRole('button',{name:'旧账号'}));
 expect(screen.getByRole('heading',{name:'旧账号',level:1})).toBeTruthy();
 await user.click(sidebar.getByRole('button',{name:'新建账号'}));
 const dialog=within(screen.getByRole('dialog',{name:'新建账号'}));
 await user.type(dialog.getByRole('textbox',{name:'账号名称'}),created.name);
 await user.type(dialog.getByRole('textbox',{name:'账号标识'}),'test-sidebar');
 await user.click(dialog.getByRole('button',{name:'创建账号'}));
 expect(await screen.findByRole('heading',{name:created.name,level:1})).toBeTruthy();
 expect(sidebar.getByRole('button',{name:created.name}).getAttribute('aria-current')).toBe('page');
});
