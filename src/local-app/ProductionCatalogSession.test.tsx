import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalCatalogApp} from './LocalCatalogApp';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
const catalog={accounts:[],blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:'2026-11-09',importedAt:'2026-11-09',page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};
function Directory({active}:{active:boolean}){const read=useProductionServiceCatalog({scope:'episode:workspace',active});return <output aria-label="制作目录状态">{read.catalog?'已读取':'无目录'}</output>;}
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});
it('a production directory 401 closes the real authenticated console through its existing listener',async()=>{
 let expired=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/session')?{owner:{id:'owner',email:'owner@example.invalid'},csrfToken:'token'}:path.includes('/catalog?')?catalog:path.endsWith('/connections')?expired?{error:'会话已失效'}:{connections:[],versions:[],serviceCatalog:{version:1,groups:[]}}:{},{status:path.endsWith('/connections')&&expired?401:200})));
 const view=render(<><LocalCatalogApp/><Directory active={false}/></>);await screen.findByRole('complementary',{name:'主导航'});
 expired=true;view.rerender(<><LocalCatalogApp/><Directory active/></>);
 await screen.findByRole('heading',{name:'登录控制台'});expect(screen.queryByRole('complementary',{name:'主导航'})).toBeNull();expect(screen.getByLabelText('制作目录状态').textContent).toBe('无目录');
});
it('a remote identity change clears the production directory with the real authentication tree',async()=>{
 const channels:Array<{name:string;onmessage:((event:{data:unknown})=>void)|null}>=[];
 class Channel{onmessage:((event:{data:unknown})=>void)|null=null;constructor(public name:string){channels.push(this);}postMessage(){}close(){}}
 vi.stubGlobal('BroadcastChannel',Channel);
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/session')?{owner:{id:'owner'},csrfToken:'token'}:path.includes('/catalog?')?catalog:path.endsWith('/connections')?{connections:[],versions:[],serviceCatalog:{version:1,groups:[]}}:{})));
 const view=render(<><LocalCatalogApp/><Directory active={false}/></>);await screen.findByRole('complementary',{name:'主导航'});view.rerender(<><LocalCatalogApp/><Directory active/></>);await waitFor(()=>expect(screen.getByLabelText('制作目录状态').textContent).toBe('已读取'));
 act(()=>channels.find(c=>c.name==='loop-local-identity')!.onmessage?.({data:{kind:'changed',sender:'other-tab'}}));
 expect(screen.getByRole('heading',{name:'登录控制台'})).toBeTruthy();expect(screen.getByLabelText('制作目录状态').textContent).toBe('无目录');
});
