import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import type {LocalCatalog} from './catalog';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('keeps a committed series save successful when its follow-up read fails',async()=>{
 const accountId='10000000-0000-4000-8000-000000000001',blueprintId='10000000-0000-4000-8000-000000000002',seriesId='10000000-0000-4000-8000-000000000003',ownerId='10000000-0000-4000-8000-000000000004',at='2026-10-23T00:00:00Z';
 const version={id:'10000000-0000-4000-8000-000000000005',account_id:accountId,series_id:seriesId,version:1,rules:{positioning:'before'},created_by:ownerId,created_at:at};
 const catalog:LocalCatalog={accounts:[{id:accountId,slug:'fixture',name:'Fixture',timezone:'UTC',current_blueprint_version_id:blueprintId,created_at:at,archived_at:null}],blueprints:[{id:blueprintId,account_id:accountId,version:1,policy:{},is_active:true,created_at:at,archived_at:null,is_snapshot:false}],episodes:[],series:[{id:seriesId,account_id:accountId,name:'Fixture series',created_at:at}],seriesVersions:[version],promptVersions:[],blueprintRevisions:{[blueprintId]:'initial'},sourceCreatedAt:at,importedAt:at};
 let saved=false,readFailure=false,posts=0;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/session'))return json({owner:{id:ownerId},csrfToken:'synthetic-csrf'});
  if(path.endsWith('/configuration')){posts++;expect(JSON.parse(String(init?.body)).command).toBe('createSeriesVersion');saved=true;return json({...version,id:'10000000-0000-4000-8000-000000000006',version:2,rules:{positioning:'saved'}});}
  if(saved&&!readFailure){readFailure=true;return json({error:'induced catalog read failure'},503);}
  return json(saved?{...catalog,seriesVersions:[{...version,id:'10000000-0000-4000-8000-000000000006',version:2,rules:{positioning:'saved'}},version]}:catalog);
 }));
 render(<LocalCatalogApp/>);
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
