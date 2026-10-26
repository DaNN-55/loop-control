import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {BlueprintConfigurationForm} from './ConfigurationForms';
import {localRequest} from '../local-app/client';
vi.mock('../lib/backend',()=>({backend:'local'}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('chooses an account directory through the local Owner command and only updates the unsaved draft',async()=>{
 let saved=0;vi.stubGlobal('crypto',webcrypto);
 const transport=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'local-directory-csrf'});
  expect(path).toBe('/api/local/account-commands');
  expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('local-directory-csrf');
  expect(JSON.parse(String(init?.body))).toMatchObject({command:'chooseAssetDirectory',data:{accountId:'10000000-0000-4000-8000-000000000001'}});
  return Response.json({assetRoot:'/authorized/chosen'});
 });vi.stubGlobal('fetch',transport);await localRequest('session');
 render(<BlueprintConfigurationForm accountId="10000000-0000-4000-8000-000000000001" initialAssetRoot="/authorized/original" initialPolicy={{}} isPending={false} onCancel={()=>{}} onSave={async()=>{saved++;}}/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'选择文件夹'}));});
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'资产目录'})).toHaveProperty('value','/authorized/chosen'));
 expect(saved).toBe(0);expect(screen.queryByText(/本地文件夹选择尚不可用/)).toBeNull();
});
it('discards a directory selection returned after switching to a different account',async()=>{
 vi.stubGlobal('crypto',webcrypto);let finish!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/session')?Response.json({csrfToken:'directory-generation'}):new Promise<Response>(r=>{finish=r;})));
 await localRequest('session');
 const props={initialPolicy:{},isPending:false,onCancel:()=>{},onSave:async()=>{}};
 const view=render(<BlueprintConfigurationForm {...props} accountId="10000000-0000-4000-8000-000000000001" initialAssetRoot="/authorized/first"/>);
 fireEvent.click(screen.getByRole('button',{name:'选择文件夹'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 view.rerender(<BlueprintConfigurationForm {...props} accountId="10000000-0000-4000-8000-000000000002" initialAssetRoot="/authorized/second"/>);
 await act(async()=>{finish(Response.json({assetRoot:'/authorized/old-selection'}));});
 expect(screen.getByRole('textbox',{name:'资产目录'})).toHaveProperty('value','/authorized/second');
});
it('keeps the draft and shows no error when the native folder dialog is cancelled',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cancelled:true})));
 render(<BlueprintConfigurationForm accountId="10000000-0000-4000-8000-000000000001" initialAssetRoot="/authorized/original" initialPolicy={{}} isPending={false} onCancel={()=>{}} onSave={async()=>{}}/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'选择文件夹'}));});
 expect(screen.getByRole('textbox',{name:'资产目录'})).toHaveProperty('value','/authorized/original');expect(screen.queryByText(/未获取到有效/)).toBeNull();expect(screen.getByRole('button',{name:'选择文件夹'})).toHaveProperty('disabled',false);
});
it('opens the entered directory through Owner HTTP and preserves the draft on a rejected path',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  expect(path).toBe('/api/local/account-commands');expect(JSON.parse(String(init?.body))).toMatchObject({command:'openAssetDirectory',data:{accountId:'10000000-0000-4000-8000-000000000001',path:'/outside/rejected'}});return Response.json({error:'资产目录超出本机授权范围。'},{status:400});
 }));
 render(<BlueprintConfigurationForm accountId="10000000-0000-4000-8000-000000000001" initialAssetRoot="/outside/rejected" initialPolicy={{}} isPending={false} onCancel={()=>{}} onSave={async()=>{}}/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'打开文件夹'}));});
 expect(await screen.findByText('资产目录超出本机授权范围。')).toBeTruthy();expect(screen.getByRole('textbox',{name:'资产目录'})).toHaveProperty('value','/outside/rejected');
});
