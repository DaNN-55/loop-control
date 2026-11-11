import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import {defaultOwnerPreferences} from '../preferences/preferences';
import type {LocalCatalog} from './catalog';

afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/');});
it('opens real log reading from the Owner menu and returns focus without navigating the workspace',async()=>{
 const at='2026-11-11T00:00:00Z';
 const catalog:LocalCatalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts:[],blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:at,importedAt:at};
 vi.stubGlobal('crypto',webcrypto);
 const fetcher=vi.fn(async(path:string)=>{
  const value=path.endsWith('/session')?{owner:{id:'owner'},csrfToken:'synthetic'}:path.endsWith('/preferences')?defaultOwnerPreferences:path.endsWith('/logs')?{observedAt:at,sourceAvailable:true,truncated:false,maxEntries:200,entries:[]}:catalog;
  return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 });vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<LocalCatalogApp/>);await screen.findByRole('button',{name:'所有者设置'});await user.click(screen.getByRole('button',{name:'所有者设置'}));await user.click(screen.getByRole('menuitem',{name:'日志'}));await screen.findByText('暂未读取到可识别的日志。');expect(screen.getByRole('dialog',{name:'日志'})).toBeTruthy();expect(fetcher.mock.calls.some(([path])=>path==='/api/local/logs')).toBe(true);expect(document.getElementById('main-content')?.hasAttribute('inert')).toBe(true);await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('dialog',{name:'日志'})).toBeNull());expect(document.activeElement).toBe(screen.getByRole('button',{name:'所有者设置'}));expect(document.getElementById('main-content')?.hasAttribute('inert')).toBe(false);
});
