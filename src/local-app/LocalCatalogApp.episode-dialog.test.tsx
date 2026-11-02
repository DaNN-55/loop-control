import {act,cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});
it('shows an actual create command HTTP error inside the dialog and returns to its keyboard opener',async()=>{
 const at='2026-11-02T00:00:00Z';
 const catalog:LocalCatalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts:[{id:'account-fixture',slug:'fixture',name:'Fixture',timezone:'UTC',current_blueprint_version_id:'blueprint-fixture',created_at:at,archived_at:null}],blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:at,importedAt:at};
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/session'))return json({owner:{id:'owner-fixture'},csrfToken:'synthetic-csrf'});
  if(path.endsWith('/episode-commands')){
   expect(JSON.parse(String(init?.body))).toMatchObject({command:'create',data:{title:'合成错误重试',accountId:'account-fixture'}});
   return json({error:'生产目录不可写，请选择其他目录。'},503);
  }
  return json(catalog);
 }));
 const user=userEvent.setup();render(<LocalCatalogApp/>);
 const opener=await screen.findByRole('button',{name:'新建生产单'});
 act(()=>opener.focus());await user.keyboard('{Enter}');
 await user.type(screen.getByRole('textbox',{name:'工作标题（可留空）'}),'合成错误重试');
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 expect((await within(screen.getByRole('dialog',{name:'新建生产单'})).findByRole('alert')).textContent).toContain('生产目录不可写，请选择其他目录。');
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog',{name:'新建生产单'})).toBeNull();expect(document.activeElement).toBe(opener);
});

it('inherits the filtered account into creation and resets every list scope with valid pagination',async()=>{
 const at='2026-11-02T00:00:00Z',requests:URLSearchParams[]=[];
 const accounts=[{id:'first',name:'首个账号'},{id:'current',name:'当前账号'}].map(account=>({...account,slug:account.id,timezone:'UTC',current_blueprint_version_id:'blueprint',created_at:at,archived_at:null}));
 const catalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{first:1,current:1},filterAccountCounts:{first:1,current:1},visibilityCounts:{active:1,archived:1},seriesEpisodeCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts,blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:at,importedAt:at};
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:'owner-fixture'},csrfToken:'synthetic-csrf'});
  if(path.includes('/catalog?'))requests.push(new URL(path,'http://localhost').searchParams);
  return Response.json(catalog);
 }));
 const user=userEvent.setup();render(<LocalCatalogApp/>);
 const nav=within(await screen.findByRole('complementary',{name:'主导航'}));
 const search=await screen.findByRole('search',{name:'搜索工作台生产单'});
 await user.type(within(search).getByRole('textbox'),'  金山  ');
 expect(requests.at(-1)?.get('q')).toBe('');
 await user.click(within(search).getByRole('button',{name:'搜索'}));
 await screen.findByRole('button',{name:'清空筛选'});
 expect(requests.at(-1)?.get('q')).toBe('金山');
 await user.click(screen.getByRole('button',{name:'清空筛选'}));
 expect(requests.at(-1)?.get('q')).toBe('');
 await user.type(within(search).getByRole('textbox'),'山谷{Enter}');
 expect(requests.at(-1)?.get('q')).toBe('山谷');
 await user.click(within(search).getByRole('button',{name:'清除搜索'}));
 expect(requests.at(-1)?.get('q')).toBe('');
 await user.type(within(search).getByRole('textbox'),'  {Enter}');
 expect(requests.at(-1)?.get('q')).toBe('');
 expect((within(search).getByRole('textbox') as HTMLInputElement).value).toBe('');
 await user.selectOptions(screen.getByRole('combobox',{name:'工作台账号筛选'}),'current');
 await user.click(screen.getByRole('button',{name:'新建生产单'}));
 expect((within(screen.getByRole('dialog',{name:'新建生产单'})).getByRole('combobox',{name:'账号'}) as HTMLSelectElement).value).toBe('current');
 await user.click(screen.getByRole('button',{name:'取消'}));
 await user.click(nav.getByRole('button',{name:'生产单'}));
 await user.selectOptions(await screen.findByRole('combobox',{name:'归档范围'}),'archived');
 await user.click(screen.getByRole('tab',{name:'需处理'}));
 expect(requests.at(-1)?.get('visibility')).toBe('archived');
 expect(requests.at(-1)?.get('status')).toBe('blocked');
 const listSearch=screen.getByRole('search',{name:'搜索生产单'});
 await user.type(within(listSearch).getByRole('textbox'),'  不存在  ');
 expect(requests.at(-1)?.get('q')).toBe('');
 await user.keyboard('{Enter}');expect(requests.at(-1)?.get('q')).toBe('不存在');
 await user.click(screen.getByRole('button',{name:'清空筛选'}));
 await screen.findByRole('button',{name:'新建生产单'});
 expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({page:'1',pendingPage:'1',blockedPage:'1',q:'',accountId:'',seriesId:'all',visibility:'active',status:'all',sort:'updated'});
 expect((screen.getByRole('combobox',{name:'归档范围'}) as HTMLSelectElement).value).toBe('active');
 expect(screen.getByRole('tab',{name:'全部'}).getAttribute('aria-selected')).toBe('true');
});
