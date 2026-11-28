import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import {attachNativeSurface} from './nativeSurface';

const accountId='11111111-1111-4111-8111-111111111111';
let detach:(()=>void)|undefined;
afterEach(()=>{cleanup();detach?.();detach=undefined;vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();});
function setup(hasAccount=true){
 const at='2026-11-28T00:00:00Z';
 const catalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts:hasAccount?[{id:accountId,slug:'fixture',name:'Fixture',timezone:'UTC',current_blueprint_version_id:'blueprint-fixture',created_at:at,archived_at:null}]:[],blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:at,importedAt:at};
 const calls:{path:string;init?:RequestInit}[]=[];
 vi.stubGlobal('crypto',webcrypto);detach=attachNativeSurface(document.body,'/api/team-loop-control/native');
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const path=new URL(input,'http://localhost').searchParams.get('path');
  if(!path)throw Error('Expected same-origin native request');
  calls.push({path,init});
  if(path==='/api/local/session')return Response.json({owner:{id:'22222222-2222-4222-8222-222222222222'},secretAdministration:false});
  if(path.startsWith('/api/local/catalog?'))return Response.json(catalog);
  if(path==='/api/local/episode-commands')return Response.json({error:'生产目录不可写，请选择其他目录。'},{status:503});
  throw Error('Unexpected route: '+path);
 }));
 render(<LocalCatalogApp/>);return calls;
}
it('reuses the single creation form through native transport without exposing batch or handoff actions',async()=>{
 const calls=setup(),user=userEvent.setup();
 const opener=await screen.findByRole('button',{name:'新建生产单'});await user.click(opener);
 expect(screen.queryByRole('menuitem',{name:'批量上传'})).toBeNull();
 expect(screen.queryByRole('menuitem',{name:'Harness 制作包'})).toBeNull();
 await user.type(screen.getByRole('textbox',{name:'工作标题（可留空）'}),'本地新建');
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 expect((await within(screen.getByRole('dialog',{name:'新建生产单'})).findByRole('alert')).textContent).toContain('生产目录不可写');
 const creation=calls.find(call=>call.path==='/api/local/episode-commands')!;
 expect(JSON.parse(String(creation.init?.body))).toMatchObject({command:'create',data:{accountId,title:'本地新建',isTest:false}});
 expect(new Headers(creation.init?.headers).has('X-CSRF-Token')).toBe(false);
 await user.keyboard('{Escape}');expect(document.activeElement).toBe(opener);
});
it('does not open unavailable account or storage setup when no content account is ready',async()=>{
 const calls=setup(false),user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'新建生产单'}));
 expect((await screen.findByRole('alert')).textContent).toContain('暂无可用内容账号');
 expect(screen.queryByRole('dialog',{name:'新建生产单'})).toBeNull();
 expect(calls.every(call=>call.path==='/api/local/session'||call.path.startsWith('/api/local/catalog?'))).toBe(true);
});
