import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AccountDirectoryPanel} from './AccountDirectoryPanel';
import {localRequest} from '../local-app/client';
const clipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
beforeEach(async()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({csrfToken:'directory-fixture'})));await localRequest('session');});
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();if(clipboard)Object.defineProperty(navigator,'clipboard',clipboard);else Reflect.deleteProperty(navigator,'clipboard');});
it('retries an unavailable directory in place and clears the earlier read error',async()=>{
 let reads=0;vi.stubGlobal('fetch',vi.fn(async()=>++reads===1?Response.json({error:'素材盘暂时断开'},{status:503}):Response.json({assetRoot:'/fixture/account',status:'ready'})));
 render(<AccountDirectoryPanel accountId="retry-account"/>);await screen.findByText('素材盘暂时断开');fireEvent.click(screen.getByRole('button',{name:'重新读取账号目录'}));
 await screen.findByText('/fixture/account');expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('button',{name:'打开'})).toHaveProperty('disabled',false);expect(reads).toBe(2);
});
it('does not publish an old account read into the selected account',async()=>{
 let finish!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{
  const {data}=JSON.parse(String(init?.body));return data.accountId==='old-read'?new Promise<Response>(resolve=>{finish=resolve;}):Response.json({assetRoot:'/fixture/current',status:'ready'});
 }));
 const view=render(<AccountDirectoryPanel accountId="old-read"/>);await waitFor(()=>expect(finish).toBeTypeOf('function'));view.rerender(<AccountDirectoryPanel accountId="current-read"/>);await screen.findByText('/fixture/current');
 await act(async()=>finish(Response.json({assetRoot:'/fixture/old',status:'ready'})));expect(screen.queryByText('/fixture/old')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['open','copy'])('ignores a late %s failure and keeps the new account copy locked until it completes',async(operation)=>{
 let oldResponse!:(r:Response)=>void,rejectOld!:(e:Error)=>void,finishNew!:()=>void;
 const writeText=vi.fn((path:string)=>path==='/fixture/old'?new Promise<void>((_resolve,reject)=>{rejectOld=reject;}):new Promise<void>(resolve=>{finishNew=resolve;}));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 vi.stubGlobal('fetch',vi.fn(async(_path:string,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));if(body.command==='openAssetDirectory')return new Promise<Response>(resolve=>{oldResponse=resolve;});return Response.json({assetRoot:body.data.accountId==='old-action'?'/fixture/old':'/fixture/new',status:'ready'});}));
 const view=render(<AccountDirectoryPanel accountId="old-action"/>);await screen.findByText('/fixture/old');fireEvent.click(screen.getByRole('button',{name:operation==='open'?'打开':'复制账号目录路径'}));
 await waitFor(()=>expect(operation==='open'?oldResponse:rejectOld).toBeTypeOf('function'));view.rerender(<AccountDirectoryPanel accountId="new-action"/>);await screen.findByText('/fixture/new');
 const copy=screen.getByRole('button',{name:'复制账号目录路径'});act(()=>{fireEvent.click(copy);fireEvent.click(copy);});expect(writeText.mock.calls.filter(([path])=>path==='/fixture/new')).toHaveLength(1);
 await act(async()=>{if(operation==='open')oldResponse(Response.json({error:'旧账号打开失败'},{status:503}));else rejectOld(Error('旧账号复制失败'));});expect(screen.queryByRole('alert')).toBeNull();expect(copy).toHaveProperty('disabled',true);expect(copy.textContent).toBe('复制中…');
 await act(async()=>finishNew());expect(copy.textContent).toBe('已复制');expect(copy).toHaveProperty('disabled',false);
});
it('keeps a known unavailable path and offers a fresh read after reconnecting its disk',async()=>{
 let ready=false;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({assetRoot:'/fixture/offline',status:ready?'ready':'unavailable'})));
 render(<AccountDirectoryPanel accountId="offline-account"/>);await screen.findByText('/fixture/offline');expect(screen.getByRole('button',{name:'打开'})).toHaveProperty('disabled',true);ready=true;fireEvent.click(screen.getByRole('button',{name:'重新读取账号目录'}));await waitFor(()=>expect(screen.getByRole('button',{name:'打开'})).toHaveProperty('disabled',false));expect(screen.queryByText(/账号目录不可用/)).toBeNull();
});
