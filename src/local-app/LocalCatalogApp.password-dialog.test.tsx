import {act,cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});
it('keeps an actual password HTTP failure inside the open dialog without a stale app error',async()=>{
 const at='2026-11-02T00:00:00Z';
 const catalog:LocalCatalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts:[{id:'account-fixture',slug:'fixture',name:'Fixture',timezone:'UTC',current_blueprint_version_id:'blueprint-fixture',created_at:at,archived_at:null}],blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:at,importedAt:at};
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/session'))return json({owner:{id:'owner-fixture'},csrfToken:'synthetic-csrf'});
  if(path.endsWith('/password')){
   expect(JSON.parse(String(init?.body))).toEqual({password:'synthetic-new-password'});
   return json({error:'密码存储暂不可用，请重试。'},503);
  }
  return json(catalog);
 }));
 const user=userEvent.setup();render(<LocalCatalogApp/>);
 await screen.findByRole('button',{name:'新建生产单'});await user.click(screen.getByRole('button',{name:'所有者设置'}));await user.click(screen.getByRole('menuitem',{name:'登录与安全'}));
 const dialog=within(screen.getByRole('dialog',{name:'登录与安全'}));
 await user.type(dialog.getByLabelText('新密码'),'synthetic-new-password');await user.type(dialog.getByLabelText('确认密码'),'synthetic-new-password');await user.click(dialog.getByRole('button',{name:'保存密码'}));
 const error=await dialog.findByRole('alert');expect(error.textContent).toBe('密码存储暂不可用，请重试。');expect(dialog.getByRole('form',{name:'登录与安全'}).getAttribute('aria-describedby')).toBe(error.id);expect((dialog.getByLabelText('新密码') as HTMLInputElement).value).toBe('synthetic-new-password');
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog',{name:'登录与安全'})).toBeNull();expect(screen.queryByText('密码存储暂不可用，请重试。')).toBeNull();
});
