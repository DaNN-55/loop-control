import {act,cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
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
