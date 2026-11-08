import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
vi.mock('../accounts/AccountWorkspace',()=>({AccountWorkspace:({account,onDirtyChange}:{account:{name:string};onDirtyChange:(value:boolean)=>void})=><section><h2>选中账号：{account.name}</h2><button onClick={()=>onDirtyChange(true)}>修改配置草稿</button></section>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();history.replaceState(null,'','/');localStorage.clear();sessionStorage.clear();});
it.each([['search',false],['search',true],['sidebar',false],['sidebar',true]] as const)('%s account switch respects unsaved changes: confirm=%s',async(source,accepted)=>{
 vi.stubGlobal('crypto',webcrypto);const confirm=vi.spyOn(window,'confirm').mockReturnValue(accepted);
 const accounts=[{id:'account-a',name:'账号A',archived_at:null},{id:'account-b',name:'账号B',archived_at:null}];
 const catalog={accounts,blueprints:[],blueprintRevisions:{},episodes:[],series:[],seriesVersions:[],promptVersions:[],page:1,total:0,pageSize:20,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{total:0,items:[]},blocked:{total:0,items:[]},worker:{running:0,blocked:0,failed:0},operationRows:[]};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture',owner:{id:'fixture-owner',email:'owner@example.test'}});
  if(path.includes('/catalog?'))return Response.json(catalog);
  if(path.includes('/workspace-search?'))return Response.json({query:'账号B',episodes:[],materials:[],accounts:[{id:'account-b',accountId:'account-b',kind:'account',title:'账号B',subtitle:'账号与系列'}],hasMore:{accounts:false,episodes:false,materials:false}});
  return Response.json({connections:[],versions:[]});
 }));
 const user=userEvent.setup();render(<LocalCatalogApp/>);await user.click(await screen.findByRole('button',{name:'账号'}));await user.click(screen.getByRole('button',{name:'账号A'}));await screen.findByRole('heading',{name:'选中账号：账号A'});await user.click(screen.getByRole('button',{name:'修改配置草稿'}));
 if(source==='sidebar'){
  const toggle=screen.getByRole('button',{name:'账号'});
  await user.click(toggle);expect(screen.getByRole('heading',{name:'选中账号：账号A'})).toBeTruthy();expect(confirm).not.toHaveBeenCalled();
  await user.click(toggle);await user.click(screen.getByRole('button',{name:'账号B'}));
 }else{
  await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));await user.type(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}),'账号B');await user.click(await screen.findByRole('button',{name:'账号B 账号与系列'}));
 }
 expect(confirm).toHaveBeenCalledWith('当前配置有未保存修改，确定放弃吗？');expect(screen.getByRole('heading',{name:accepted?'选中账号：账号B':'选中账号：账号A'})).toBeTruthy();
});
