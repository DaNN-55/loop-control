import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LocalSecretAdministration} from './LocalSecretAdministration';
import {OwnerMenu} from '../workspace/WorkspaceViews';
import {localRequest} from './client';
import type {SecretMetadata} from './secretAdministrationTypes';
vi.mock('./client',()=>({localRequest:vi.fn()}));
const reference='ab2b1e39-6db1-4b8b-8d86-e86e44a4c648';
const item:SecretMetadata={reference,names:['Synthetic connection'],aliases:[],purpose:'当前连接：合成连接',category:'connection',runtimeUses:[],connections:[],pendingUses:[],history:{metadataOccurrences:1,fileOccurrences:2,files:[]},revealAllowed:true,state:'未读取密钥值'};
const value='synthetic-ui-only';
let copied:string[]=[];
beforeEach(()=>{copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn(async(text:string)=>{copied.push(text);})}});vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets?')?{items:[item],total:1,page:1,pageSize:50}:path.startsWith('secrets/detail?')?{item}:{value,expiresAt:new Date(Date.now()+30000).toISOString()});});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers();});
async function select(){await screen.findByRole('button',{name:'Synthetic connection'});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Synthetic connection'}));});await screen.findByText(reference);}
async function verify(action='查看密钥'){await act(async()=>{fireEvent.click(screen.getByRole('button',{name:new RegExp('^'+action+'：')}));});fireEvent.change(screen.getByLabelText('当前登录密码'),{target:{value:'synthetic-password-only'}});await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'验证管理员身份'}));});}
it('keeps menu capability optional and performs no secret request for other owners',()=>{const v=render(<OwnerMenu onOpenSettings={()=>{}} onSignOut={()=>{}}/>);fireEvent.click(screen.getByLabelText('所有者设置'));expect(screen.queryByRole('menuitem',{name:'密钥管理'})).toBeNull();v.rerender(<OwnerMenu onOpenSettings={()=>{}} onSignOut={()=>{}} onOpenSecrets={()=>{}}/>);expect(screen.getByRole('menuitem',{name:'密钥管理'})).toBeTruthy();expect(localRequest).not.toHaveBeenCalled();});
it('reveals only after POST password verification and clears on selection/filter/visibility',async()=>{
 const localSet=vi.spyOn(Storage.prototype,'setItem');render(<LocalSecretAdministration csrf="synthetic-csrf" onClose={()=>{}}/>);await select();expect(screen.queryByLabelText('密钥明文')).toBeNull();await verify();await screen.findByLabelText('密钥明文');expect(screen.getByLabelText('密钥明文').textContent===value).toBe(true);
 const call=vi.mocked(localRequest).mock.calls.find(([path])=>path==='secrets/reveal');expect(call?.[1]?.method).toBe('POST');expect(call?.[1]?.headers).toEqual({'Content-Type':'application/json','X-CSRF-Token':'synthetic-csrf'});expect(localSet).not.toHaveBeenCalled();expect(copied.length).toBe(0);
 fireEvent.change(screen.getByLabelText('搜索密钥'),{target:{value:'new'}});expect(screen.queryByLabelText('密钥明文')).toBeNull();await select();await verify();await screen.findByLabelText('密钥明文');fireEvent(document,new Event('visibilitychange'));expect(screen.queryByLabelText('密钥明文')).toBeNull();localSet.mockRestore();
});
it('copies through browser clipboard after verification and never renders returned plaintext',async()=>{render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify('复制密钥');await screen.findByText('已复制所选密钥。');expect(copied.length===1&&copied[0]===value).toBe(true);expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(screen.queryByLabelText('当前登录密码')).toBeNull();});
it('blocks stale reveal responses after close, filter and expired-session event',async()=>{
 let resolve!:(v:unknown)=>void;const deferred=new Promise(r=>{resolve=r;});vi.mocked(localRequest).mockImplementation(async(path)=>path==='secrets/reveal'?deferred:path.startsWith('secrets/detail?')?{item}:{items:[item],total:1,page:1,pageSize:50});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify();act(()=>window.dispatchEvent(new Event('loop-local-session-expired')));await act(async()=>resolve({value,expiresAt:new Date(Date.now()+30000).toISOString()}));expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(copied.length).toBe(0);
});
it('hides plaintext after thirty seconds and never offers control-secret reveal',async()=>{
 const v=render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();vi.useFakeTimers();await verify();expect(screen.queryByLabelText('密钥明文')!==null).toBe(true);act(()=>vi.advanceTimersByTime(30000));expect(screen.queryByLabelText('密钥明文')).toBeNull();vi.useRealTimers();v.unmount();
 vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets/detail?')?{item:{...item,revealAllowed:false}}:{items:[{...item,revealAllowed:false}],total:1,page:1,pageSize:50});render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'Synthetic connection'}));await screen.findByText('系统控制密钥仅展示用途与状态，不提供网页读取。');expect(screen.queryByRole('button',{name:/^查看密钥：/})).toBeNull();
});
it('uses a compact table with reference details only in the expanded row',async()=>{
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await screen.findByRole('button',{name:'Synthetic connection'});
 expect(screen.getAllByRole('columnheader').map(e=>e.textContent)).toEqual(['名称','关联用途','分类','操作']);expect(screen.queryByText(reference)).toBeNull();expect(screen.queryByText('选择一项查看引用关系。')).toBeNull();
 expect(screen.getByRole('button',{name:'密钥管理帮助'}).getAttribute('aria-expanded')).toBe('false');await select();expect(screen.getByRole('button',{name:'Synthetic connection'}).getAttribute('aria-expanded')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Synthetic connection'}));expect(screen.queryByText(reference)).toBeNull();expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets/reveal')).toBe(false);
});
it('does not apply an older detail response to a newer row action',async()=>{
 const other={...item,reference:'10000000-0000-4000-8000-000000000002',names:['Second connection']};let old!:(response:unknown)=>void;
 vi.mocked(localRequest).mockImplementation(async(path,init)=>{
  if(path.startsWith('secrets?'))return{items:[item,other],total:2,page:1,pageSize:50};
  if(path.startsWith('secrets/detail?'))return path.includes(reference)?new Promise(resolve=>{old=resolve;}):{item:other};
  const body=JSON.parse(String(init?.body));expect(body).toMatchObject({reference:other.reference,action:'copy',password:'synthetic-password-only'});return{value,expiresAt:new Date(Date.now()+30000).toISOString()};
 });
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await screen.findByRole('button',{name:'Synthetic connection'});
 fireEvent.click(screen.getByRole('button',{name:/^查看密钥：Synthetic/}));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^复制密钥：Second/}));});
 await screen.findByLabelText('当前登录密码');await act(async()=>old({item}));expect(screen.getByText(other.reference)).toBeTruthy();expect(screen.queryByText(reference)).toBeNull();
 fireEvent.change(screen.getByLabelText('当前登录密码'),{target:{value:'synthetic-password-only'}});await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'验证管理员身份'}));});await screen.findByText('已复制所选密钥。');expect(copied).toEqual([value]);expect(screen.queryByLabelText('密钥明文')).toBeNull();
});
it.each(['collapse','filter','close'] as const)('discards a late reveal after %s',async mode=>{
 let finish!:(result:unknown)=>void;vi.mocked(localRequest).mockImplementation(async(path)=>path==='secrets/reveal'?new Promise(resolve=>{finish=resolve;}):path.startsWith('secrets/detail?')?{item}:{items:[item],total:1,page:1,pageSize:50});
 const close=vi.fn();render(<LocalSecretAdministration csrf="csrf" onClose={close}/>);await select();await verify();
 if(mode==='collapse')fireEvent.click(screen.getByRole('button',{name:'Synthetic connection'}));else if(mode==='filter')fireEvent.change(screen.getByLabelText('分类'),{target:{value:'system'}});else fireEvent.click(screen.getByRole('button',{name:'关闭密钥管理'}));
 await act(async()=>finish({value,expiresAt:new Date(Date.now()+30000).toISOString()}));expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(screen.queryByLabelText('当前登录密码')).toBeNull();expect(copied).toHaveLength(0);if(mode==='close')expect(close).toHaveBeenCalledOnce();
});
it('preserves server paging and clears the expanded secret before requesting the next page',async()=>{
 const other={...item,reference:'10000000-0000-4000-8000-000000000002',names:['Next-page connection']};
 vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets/detail?')?{item}:path==='secrets/reveal'?{value,expiresAt:new Date(Date.now()+30000).toISOString()}:{items:[path.includes('page=2')?other:item],total:2,page:path.includes('page=2')?2:1,pageSize:1});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify();await screen.findByLabelText('密钥明文');fireEvent.click(screen.getByRole('button',{name:'下一页'}));expect(screen.queryByLabelText('密钥明文')).toBeNull();
 await screen.findByRole('button',{name:'Next-page connection'});expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets?q=&category=all&page=2')).toBe(true);expect((screen.getByRole('button',{name:'下一页'})as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('region',{name:'密钥详情'})).toBeNull();
});
it('rechecks permissions before opening password verification from a row action',async()=>{
 vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets/detail?')?{item:{...item,revealAllowed:false}}:{items:[item],total:1,page:1,pageSize:50});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:/^查看密钥：/}));await screen.findByText('系统控制密钥仅展示用途与状态，不提供网页读取。');expect(screen.queryByLabelText('当前登录密码')).toBeNull();expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets/reveal')).toBe(false);
});
it('can retry a failed detail read through the same row action',async()=>{
 let detailReads=0;vi.mocked(localRequest).mockImplementation(async(path)=>{if(path.startsWith('secrets/detail?')){if(++detailReads===1)throw Error('offline');return{item};}return{items:[item],total:1,page:1,pageSize:50};});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:/^查看密钥：/}));expect((await screen.findByRole('alert')).textContent).toContain('详情读取失败');
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^查看密钥：/}));});await screen.findByLabelText('当前登录密码');expect(screen.queryByRole('alert')).toBeNull();expect(detailReads).toBe(2);
});

it('uses full inventory category counts even on an empty page',async()=>{
 vi.mocked(localRequest).mockResolvedValue({items:[],total:0,page:1,pageSize:50,categoryCounts:{system:2,connection:55}});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await screen.findByText('没有匹配的密钥。');
 const select=screen.getByRole('combobox',{name:'分类'}) as HTMLSelectElement;expect(Array.from(select.options).map(option=>option.textContent)).toEqual(['全部分类','系统控制','连接使用']);
});
