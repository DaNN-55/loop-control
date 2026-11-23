import userEvent from '@testing-library/user-event';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import {draftCatalog,draftOwner} from './fixtures/workspaceDraftFixture';
import {defaultOwnerPreferences} from '../preferences/preferences';

beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(()=>{cleanup();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/');});
function fixture(needsStorage=false,delayCatalog=false){
 let created=false;
 const writes:Array<{command:string;data:Record<string,unknown>}>=[];
 const account={...draftCatalog.accounts[0],id:'created-account',name:'初次创作',timezone:'Asia/Shanghai'};
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({owner:{id:draftOwner},csrfToken:'synthetic'});
  if(path.endsWith('/preferences'))return Response.json(defaultOwnerPreferences);
  if(path.endsWith('/media-root'))return Response.json({path:'/private/test-media',status:'ready',initialized:!needsStorage,canInitialize:true,migration:null});
  if(path.includes('/catalog?')&&created&&delayCatalog)return new Promise<Response>(()=>{});
  if(path.includes('/catalog?'))return Response.json({...draftCatalog,accounts:created?[account]:[],episodes:[],total:0});
  if(init?.method==='POST'){const body=JSON.parse(String(init.body));writes.push(body);if(body.command==='createAccount'){created=true;return Response.json(account);}return Response.json({error:'Unexpected write'},{status:400});}
  return Response.json({connections:[],versions:[],serviceCatalog:{groups:[]},capabilities:{}});
 }));
 return writes;
}
it('asks only for an account name and continues to production without configuring any service',async()=>{
 const writes=fixture(false,true);render(<LocalCatalogApp/>);
 await userEvent.click(await screen.findByRole('button',{name:'创建内容账号'}));
 await userEvent.click(await screen.findByRole('menuitem',{name:'创建内容账号'}));
 const form=within(await screen.findByRole('dialog',{name:'新建账号'}));
 expect(form.queryByRole('textbox',{name:'账号标识'})).toBeNull();
 fireEvent.change(form.getByRole('textbox',{name:'账号名称'}),{target:{value:'初次创作'}});fireEvent.click(form.getByRole('button',{name:'创建账号'}));
 const production=within(await screen.findByRole('dialog',{name:'新建生产单'}));expect(production.getByRole('button',{name:'创建生产单'})).toHaveProperty('disabled',false);expect(production.getByRole('combobox',{name:'账号'})).toHaveProperty('value','created-account');
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({command:'createAccount',data:{name:'初次创作',timezone:'Asia/Shanghai'}});
 expect(writes[0].data.slug).toMatch(/^account-[a-f0-9-]+$/);
 expect(screen.queryByRole('dialog',{name:'制作服务'})).toBeNull();
});
it('continues from the first account into batch upload before the catalog refresh finishes',async()=>{
 const writes=fixture(false,true);render(<LocalCatalogApp/>);
 await userEvent.click(await screen.findByRole('button',{name:'创建内容账号'}));
 await userEvent.click(await screen.findByRole('menuitem',{name:'批量上传'}));
 const form=within(await screen.findByRole('dialog',{name:'新建账号'}));
 fireEvent.change(form.getByRole('textbox',{name:'账号名称'}),{target:{value:'初次创作'}});
 fireEvent.click(form.getByRole('button',{name:'创建账号'}));
 const upload=within(await screen.findByRole('dialog',{name:'批量新建生产单'}));
 expect(upload.getByRole('combobox',{name:'账号'})).toHaveProperty('value','created-account');
 expect(screen.queryByRole('dialog',{name:'新建生产单'})).toBeNull();
 expect(writes).toHaveLength(1);
});
it('opens file storage before creating an account when the workspace has not initialized it',async()=>{
 const writes=fixture(true);render(<LocalCatalogApp/>);await userEvent.click(await screen.findByRole('button',{name:'创建内容账号'}));
 await userEvent.click(await screen.findByRole('menuitem',{name:'创建内容账号'}));
 await screen.findByRole('dialog',{name:'文件存储'});await screen.findByRole('button',{name:'初始化'});
 expect(screen.queryByRole('dialog',{name:'新建账号'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'继续创建内容账号'}));await waitFor(()=>expect(screen.getByText('请先完成存储位置设置。')).toBeTruthy());expect(writes).toEqual([]);
});
