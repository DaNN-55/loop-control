import userEvent from '@testing-library/user-event';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalCatalogApp} from './LocalCatalogApp';
vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();history.replaceState(null,'','/');});
it('opens a completed production from its list menu using only its stable identity',async()=>{
 const id='10000000-0000-4000-8000-000000000010';let opened:unknown;
 const catalog={accounts:[],blueprints:[],blueprintRevisions:{},episodes:[{id,title:'旧生产单',stage:'production_completed',account_id:'fixture',blueprint_version_id:'fixture',series_version_id:null,created_at:'2026-10-31',updated_at:'2026-10-31',archived_at:null}],series:[],seriesVersions:[],promptVersions:[],page:1,total:1,pageSize:20,episodeCount:1,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{total:0,items:[]},blocked:{total:0,items:[]},worker:{running:0,blocked:0,failed:0},operationRows:[]};
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.endsWith('/session'))return Response.json({owner:{id:'fixture'},csrfToken:'fixture'});if(path.includes('/catalog?'))return Response.json(catalog);if(path.endsWith('/episode-commands')){opened=JSON.parse(String(init?.body));return Response.json({opened:true,path:'/controlled/full-production'});}return Response.json({connections:[],versions:[]});}));
 await act(async()=>{render(<LocalCatalogApp/>);});fireEvent.click(within(await screen.findByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));
 const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'生产单操作：旧生产单'}));await user.click(await screen.findByRole('menuitem',{name:'打开本地文件夹'}));
 expect(opened).toMatchObject({command:'openDirectory',data:{episodeId:id}});expect(Object.keys((opened as {data:object}).data)).toEqual(['episodeId']);
});
