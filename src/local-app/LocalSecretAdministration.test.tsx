import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
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
async function openFirstGroup(){const buttons=await screen.findAllByRole('button',{name:/^打开密钥分组：/});fireEvent.click(buttons[0]);await screen.findByRole('list',{name:'组内密钥'});}
async function select(){if(screen.queryByRole('list',{name:'密钥分组'})||!screen.queryByRole('list',{name:'组内密钥'}))await openFirstGroup();await screen.findByRole('button',{name:'Synthetic connection'});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Synthetic connection'}));});await screen.findByText(reference);}
async function verify(action='查看密钥'){await act(async()=>{fireEvent.click(screen.getByRole('button',{name:new RegExp('^'+action+'：')}));});fireEvent.change(screen.getByLabelText('当前登录密码'),{target:{value:'synthetic-password-only'}});await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'验证管理员身份'}));});}
it('embeds inside one settings dialog and clears displayed credentials before leaving for the real connection',async()=>{
 const linked={...item,connections:[{connectionId:'real-connection-id',name:'真实名称',provider:'pexels',version:2,current:true,revoked:false}]},onOpenConnection=vi.fn();
 vi.mocked(localRequest).mockImplementation(async path=>path.startsWith('secrets?')?{items:[linked],total:1,page:1,pageSize:50}:path.startsWith('secrets/detail?')?{item:linked}:{value,expiresAt:new Date(Date.now()+30000).toISOString()});
 render(<section role="dialog" aria-label="所有者设置"><LocalSecretAdministration csrf="csrf" embedded onClose={()=>{}} onOpenConnection={onOpenConnection}/></section>);
 expect(screen.getAllByRole('dialog')).toHaveLength(1);await openFirstGroup();fireEvent.click(await screen.findByRole('button',{name:/^Synthetic connection/}));await screen.findByText(reference);await verify();await screen.findByLabelText('密钥明文');
 fireEvent.click(screen.getByRole('button',{name:'前往连接更换密钥'}));expect(onOpenConnection).toHaveBeenCalledWith('real-connection-id');expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(screen.queryByLabelText('当前登录密码')).toBeNull();
});
it('uses the requested search and reference without opening a nested dialog or revealing any credential',async()=>{
 render(<LocalSecretAdministration csrf="csrf" embedded initialQuery="Synthetic connection" initialReference={reference} onClose={()=>{}}/>);
 await screen.findByText(reference);expect(screen.queryByRole('dialog')).toBeNull();expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets?q=Synthetic+connection&category=all&page=1')).toBe(true);expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets/reveal')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));fireEvent.change(screen.getByLabelText('搜索密钥'),{target:{value:'other'}});await screen.findByRole('list',{name:'密钥分组'});expect(screen.queryByText(reference)).toBeNull();
});
it('keeps menu capability optional and performs no secret request for other owners',()=>{const v=render(<OwnerMenu onOpenSettings={()=>{}} onSignOut={()=>{}}/>);fireEvent.click(screen.getByLabelText('所有者设置'));expect(screen.queryByRole('menuitem',{name:'密钥管理'})).toBeNull();v.rerender(<OwnerMenu onOpenSettings={()=>{}} onSignOut={()=>{}} onOpenSecrets={()=>{}}/>);expect(screen.getByRole('menuitem',{name:'密钥管理'})).toBeTruthy();expect(localRequest).not.toHaveBeenCalled();});
it('reveals only after POST password verification and clears on selection/filter/visibility',async()=>{
 const localSet=vi.spyOn(Storage.prototype,'setItem');render(<LocalSecretAdministration csrf="synthetic-csrf" onClose={()=>{}}/>);await select();expect(screen.queryByLabelText('密钥明文')).toBeNull();await verify();await screen.findByLabelText('密钥明文');expect(screen.getByLabelText('密钥明文').textContent===value).toBe(true);
 const call=vi.mocked(localRequest).mock.calls.find(([path])=>path==='secrets/reveal');expect(call?.[1]?.method).toBe('POST');expect(call?.[1]?.headers).toEqual({'Content-Type':'application/json','X-CSRF-Token':'synthetic-csrf'});expect(localSet).not.toHaveBeenCalled();expect(copied.length).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));fireEvent.change(screen.getByLabelText('搜索密钥'),{target:{value:'new'}});expect(screen.queryByLabelText('密钥明文')).toBeNull();await select();await verify();await screen.findByLabelText('密钥明文');fireEvent(document,new Event('visibilitychange'));expect(screen.queryByLabelText('密钥明文')).toBeNull();localSet.mockRestore();
});
it('copies through browser clipboard after verification and never renders returned plaintext',async()=>{render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify('复制密钥');await screen.findByText('已复制所选密钥。');expect(copied.length===1&&copied[0]===value).toBe(true);expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(screen.queryByLabelText('当前登录密码')).toBeNull();});
it('blocks stale reveal responses after close, filter and expired-session event',async()=>{
 let resolve!:(v:unknown)=>void;const deferred=new Promise(r=>{resolve=r;});vi.mocked(localRequest).mockImplementation(async(path)=>path==='secrets/reveal'?deferred:path.startsWith('secrets/detail?')?{item}:{items:[item],total:1,page:1,pageSize:50});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify();act(()=>window.dispatchEvent(new Event('loop-local-session-expired')));await act(async()=>resolve({value,expiresAt:new Date(Date.now()+30000).toISOString()}));expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(copied.length).toBe(0);
});
it('hides plaintext after thirty seconds and never offers control-secret reveal',async()=>{
 const v=render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();vi.useFakeTimers();await verify();expect(screen.queryByLabelText('密钥明文')!==null).toBe(true);act(()=>vi.advanceTimersByTime(30000));expect(screen.queryByLabelText('密钥明文')).toBeNull();vi.useRealTimers();v.unmount();
 vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets/detail?')?{item:{...item,revealAllowed:false}}:{items:[{...item,revealAllowed:false}],total:1,page:1,pageSize:50});render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await openFirstGroup();fireEvent.click(await screen.findByRole('button',{name:'Synthetic connection'}));await screen.findByText('系统控制密钥仅展示用途与状态，不提供网页读取。');expect(screen.queryByRole('button',{name:/^查看密钥：/})).toBeNull();
});
it('replaces group and item lists with one fixed detail region and returns through both list levels',async()=>{
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await screen.findByRole('list',{name:'密钥分组'});
 expect(screen.queryByRole('list',{name:'组内密钥'})).toBeNull();expect(screen.queryByText(reference)).toBeNull();expect(screen.queryByRole('table')).toBeNull();
 expect(screen.getByRole('button',{name:'密钥管理帮助'}).getAttribute('aria-expanded')).toBe('false');await select();expect(screen.queryByRole('list')).toBeNull();expect(screen.getAllByRole('region',{name:'密钥详情'})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));expect(screen.queryByText(reference)).toBeNull();expect(screen.getByRole('list',{name:'组内密钥'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'返回密钥分组'}));expect(screen.getByRole('list',{name:'密钥分组'})).toBeTruthy();expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets/reveal')).toBe(false);
});
it('does not apply an older detail response to a newer row action',async()=>{
 const other={...item,reference:'10000000-0000-4000-8000-000000000002',names:['Second connection']};let old!:(response:unknown)=>void;
 vi.mocked(localRequest).mockImplementation(async(path,init)=>{
  if(path.startsWith('secrets?'))return{items:[item,other],total:2,page:1,pageSize:50};
  if(path.startsWith('secrets/detail?'))return path.includes(reference)?new Promise(resolve=>{old=resolve;}):{item:other};
  const body=JSON.parse(String(init?.body));expect(body).toMatchObject({reference:other.reference,action:'copy',password:'synthetic-password-only'});return{value,expiresAt:new Date(Date.now()+30000).toISOString()};
 });
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await openFirstGroup();await screen.findByRole('button',{name:'Synthetic connection'});
 fireEvent.click(screen.getByRole('button',{name:/^查看密钥：Synthetic/}));fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^复制密钥：Second/}));});
 await screen.findByLabelText('当前登录密码');await act(async()=>old({item}));expect(screen.getByText(other.reference)).toBeTruthy();expect(screen.queryByText(reference)).toBeNull();
 fireEvent.change(screen.getByLabelText('当前登录密码'),{target:{value:'synthetic-password-only'}});await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'验证管理员身份'}));});await screen.findByText('已复制所选密钥。');expect(copied).toEqual([value]);expect(screen.queryByLabelText('密钥明文')).toBeNull();
});
it.each(['collapse','filter','close'] as const)('discards a late reveal after %s',async mode=>{
 let finish!:(result:unknown)=>void;vi.mocked(localRequest).mockImplementation(async(path)=>path==='secrets/reveal'?new Promise(resolve=>{finish=resolve;}):path.startsWith('secrets/detail?')?{item}:{items:[item],total:1,page:1,pageSize:50});
 const close=vi.fn();render(<LocalSecretAdministration csrf="csrf" onClose={close}/>);await select();await verify();
 if(mode==='collapse')fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));else if(mode==='filter'){fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));fireEvent.change(screen.getByLabelText('分类'),{target:{value:'system'}});}else fireEvent.click(screen.getByRole('button',{name:'关闭密钥管理'}));
 await act(async()=>finish({value,expiresAt:new Date(Date.now()+30000).toISOString()}));expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(screen.queryByLabelText('当前登录密码')).toBeNull();expect(copied).toHaveLength(0);if(mode==='close')expect(close).toHaveBeenCalledOnce();
});
it('preserves server paging and clears the expanded secret before requesting the next page',async()=>{
 const other={...item,reference:'10000000-0000-4000-8000-000000000002',names:['Next-page connection']};
 vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets/detail?')?{item}:path==='secrets/reveal'?{value,expiresAt:new Date(Date.now()+30000).toISOString()}:{items:[path.includes('page=2')?other:item],total:2,page:path.includes('page=2')?2:1,pageSize:1});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify();await screen.findByLabelText('密钥明文');fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));fireEvent.click(screen.getByRole('button',{name:'下一页'}));expect(screen.queryByLabelText('密钥明文')).toBeNull();
 await openFirstGroup();await screen.findByRole('button',{name:'Next-page connection'});expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets?q=&category=all&page=2')).toBe(true);expect((screen.getByRole('button',{name:'下一页'})as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('region',{name:'密钥详情'})).toBeNull();
});
it('rechecks permissions before opening password verification from a row action',async()=>{
 vi.mocked(localRequest).mockImplementation(async(path)=>path.startsWith('secrets/detail?')?{item:{...item,revealAllowed:false}}:{items:[item],total:1,page:1,pageSize:50});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await openFirstGroup();fireEvent.click(await screen.findByRole('button',{name:/^查看密钥：/}));await screen.findByText('系统控制密钥仅展示用途与状态，不提供网页读取。');expect(screen.queryByLabelText('当前登录密码')).toBeNull();expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets/reveal')).toBe(false);
});
it('can retry a failed detail read through the same row action',async()=>{
 let detailReads=0;vi.mocked(localRequest).mockImplementation(async(path)=>{if(path.startsWith('secrets/detail?')){if(++detailReads===1)throw Error('offline');return{item};}return{items:[item],total:1,page:1,pageSize:50};});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await openFirstGroup();fireEvent.click(await screen.findByRole('button',{name:/^查看密钥：/}));expect((await screen.findByRole('alert')).textContent).toContain('详情读取失败');
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'重试'}));});await screen.findByLabelText('当前登录密码');expect(screen.queryByRole('alert')).toBeNull();expect(detailReads).toBe(2);
});

it('uses full inventory category counts even on an empty page',async()=>{
 vi.mocked(localRequest).mockResolvedValue({items:[],total:0,page:1,pageSize:50,categoryCounts:{system:2,connection:55}});
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await screen.findByText('没有匹配的密钥。');
 const select=screen.getByRole('combobox',{name:'分类'}) as HTMLSelectElement;expect(Array.from(select.options).map(option=>option.textContent)).toEqual(['全部分类','系统控制','连接使用']);
});
it('explains local reauthentication at the sensitive action and keeps a failed verification associated with the password for retry',async()=>{
 let attempts=0;vi.mocked(localRequest).mockImplementation(async(path)=>{
  if(path==='secrets/reveal'){if(++attempts===1)throw Error('当前密码验证失败。');return{value,expiresAt:new Date(Date.now()+30000).toISOString()};}
  return path.startsWith('secrets/detail?')?{item}:{items:[item],total:1,page:1,pageSize:50};
 });
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await select();await verify();
 const error=await screen.findByRole('alert');expect(error.textContent).toBe('当前密码验证失败。');
 const password=screen.getByLabelText('当前登录密码');expect((password as HTMLInputElement).value).toBe('');expect(password.getAttribute('aria-invalid')).toBe('true');expect(password.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);expect(document.activeElement).toBe(password);
 expect(screen.getByText('使用当前登录密码验证本机身份，仅用于此次查看或复制。')).toBeTruthy();expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(copied).toHaveLength(0);
 fireEvent.change(password,{target:{value:'synthetic-password-only'}});await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'验证管理员身份'}));});await screen.findByLabelText('密钥明文');expect(screen.queryByRole('alert')).toBeNull();
});

function inventory(rows:SecretMetadata[],total=rows.length,pageSize=50){vi.mocked(localRequest).mockImplementation(async path=>path.startsWith('secrets/detail?')?{item:rows.find(row=>row.reference===new URL('http://synthetic/'+path).searchParams.get('reference'))}:{items:rows,total,page:1,pageSize,categoryCounts:{connection:rows.filter(row=>row.category==='connection').length,system:rows.filter(row=>row.category==='system').length,history:rows.filter(row=>row.category==='history').length,unreferenced:rows.filter(row=>row.category==='unreferenced').length}});}
function related(reference:string,name:string,version:number,current:boolean,purpose='制作密钥'):SecretMetadata{return{...item,reference,names:[name],purpose,connections:[{connectionId:'connection-a',name:'聚合连接',provider:'openai',version,current,revoked:false}]};}
it('groups production and billing credentials with current and historical versions by real connection identity',async()=>{
 const old=related('old-production','制作密钥',2,false),production=related('current-production','制作密钥',3,true),billing=related('current-billing','账务密钥',1,true,'账务查询');inventory([old,billing,production]);
 render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);await screen.findAllByRole('button',{name:/^打开密钥分组：/});const groups=screen.getByRole('list',{name:'密钥分组'});expect(within(groups).getAllByRole('button',{name:/^打开密钥分组：/})).toHaveLength(1);expect(screen.queryByText('按当前页匹配条目分组')).toBeNull();expect(screen.queryByRole('button',{name:/^查看密钥：/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'打开密钥分组：聚合连接'}));
 const secrets=await screen.findByRole('list',{name:'组内密钥'}),references=Array.from(secrets.querySelectorAll<HTMLButtonElement>('button[data-secret-reference]')).map(button=>button.dataset.secretReference);
 expect(new Set(references)).toEqual(new Set(['current-production','old-production','current-billing']));expect(references.indexOf('current-production')).toBeLessThan(references.indexOf('old-production'));expect(references.indexOf('current-billing')).toBeLessThan(references.indexOf('old-production'));
 expect(within(secrets).getByRole('button',{name:'制作密钥 v3'})).toBeTruthy();expect(within(secrets).getByRole('button',{name:'账务密钥 v1'})).toBeTruthy();expect(screen.getByText('3 项')).toBeTruthy();expect(screen.queryByRole('region',{name:'密钥详情'})).toBeNull();
});
it('keeps a shared secret reachable from each referenced connection without duplicating plaintext',async()=>{
 const shared={...related('shared-reference','共享密钥',2,true),connections:[{connectionId:'connection-a',name:'连接A',provider:'openai',version:2,current:true,revoked:false},{connectionId:'connection-b',name:'连接B',provider:'openai',version:2,current:true,revoked:false}]};inventory([shared]);render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);
 for(const name of ['连接A','连接B']){fireEvent.click(await screen.findByRole('button',{name:'打开密钥分组：'+name}));expect(within(screen.getByRole('list',{name:'组内密钥'})).getByRole('button',{name:'共享密钥 v2'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'返回密钥分组'}));}
 expect(screen.getByText('共 1 项')).toBeTruthy();expect(screen.queryByText(/共 \d+ (个)?分组/)).toBeNull();expect(vi.mocked(localRequest).mock.calls.every(([path])=>path!=='secrets/reveal')).toBe(true);
});
it('groups unrelated entries by category and purpose while system-controlled metadata takes precedence over connection links',async()=>{
 const system={...related('system-one','系统秘密一',1,true,'会话控制'),category:'system' as const,revealAllowed:false},system2={...system,reference:'system-two',names:['系统秘密二']},history={...item,reference:'history-one',names:['历史还原一'],purpose:'会话控制',category:'history' as const},unreferenced={...item,reference:'unreferenced-one',names:['未引用一'],purpose:'会话控制',category:'unreferenced' as const};inventory([system,system2,history,unreferenced]);render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);
 await screen.findAllByRole('button',{name:/^打开密钥分组：/});const groups=screen.getByRole('list',{name:'密钥分组'});expect(within(groups).getAllByRole('button',{name:/^打开密钥分组：/})).toHaveLength(3);expect(screen.queryByRole('button',{name:'打开密钥分组：聚合连接'})).toBeNull();
 // The name may include its category to distinguish the same purpose across categories.
 const systemGroup=within(groups).getAllByRole('listitem').find(row=>row.textContent?.includes('系统控制'));expect(systemGroup).toBeTruthy();fireEvent.click(within(systemGroup!).getByRole('button',{name:/^打开密钥分组：/}));const secrets=screen.getByRole('list',{name:'组内密钥'});expect(within(secrets).getByRole('button',{name:'系统秘密一 v1'})).toBeTruthy();expect(within(secrets).getByRole('button',{name:'系统秘密二 v1'})).toBeTruthy();expect(within(secrets).queryByRole('button',{name:/^查看密钥：/})).toBeNull();expect(within(secrets).queryByRole('button',{name:/^复制密钥：/})).toBeNull();
});
it('keeps server totals and page context through group/detail back navigation and resets the group on filtering',async()=>{
 const second=related('page-two','第二页密钥',2,true);vi.mocked(localRequest).mockImplementation(async path=>path.startsWith('secrets/detail?')?{item:second}:{items:[second],total:51,page:path.includes('page=2')?2:1,pageSize:50,categoryCounts:{connection:51}});
 render(<LocalSecretAdministration csrf="csrf" initialQuery="聚合连接" onClose={()=>{}}/>);await screen.findByRole('button',{name:'打开密钥分组：聚合连接'});expect(screen.getByText('按当前页匹配条目分组')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(vi.mocked(localRequest).mock.calls.some(([path])=>path.includes('page=2'))).toBe(true));await screen.findByRole('button',{name:'打开密钥分组：聚合连接'});fireEvent.click(screen.getByRole('button',{name:'打开密钥分组：聚合连接'}));expect(screen.getByText('本页匹配 1 项')).toBeTruthy();expect(screen.getByText('共 51 项')).toBeTruthy();expect(screen.queryByText(/共 \d+ (个)?分组/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'第二页密钥 v2'}));await screen.findByText('page-two');expect(screen.queryByRole('list',{name:'组内密钥'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));expect(screen.getByRole('list',{name:'组内密钥'})).toBeTruthy();expect(screen.getByLabelText('搜索密钥')).toHaveProperty('value','聚合连接');expect(screen.getByText('2 / 2')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'返回密钥分组'}));expect(screen.getByText('2 / 2')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'打开密钥分组：聚合连接'}));
 fireEvent.change(screen.getByLabelText('分类'),{target:{value:'connection'}});await screen.findByRole('button',{name:'打开密钥分组：聚合连接'});expect(screen.queryByRole('list',{name:'组内密钥'})).toBeNull();expect(screen.getByLabelText('分类')).toHaveProperty('value','connection');expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets?q=%E8%81%9A%E5%90%88%E8%BF%9E%E6%8E%A5&category=connection&page=1')).toBe(true);
});
it('keeps different connection IDs separate even when their display names match',async()=>{
 const first=related('first-reference','第一条密钥',1,true),second={...related('second-reference','第二条密钥',1,true),connections:[{connectionId:'connection-b',name:'聚合连接',provider:'openai',version:1,current:true,revoked:false}]};inventory([first,second]);render(<LocalSecretAdministration csrf="csrf" onClose={()=>{}}/>);
 const buttons=await screen.findAllByRole('button',{name:'打开密钥分组：聚合连接'});expect(buttons).toHaveLength(2);fireEvent.click(buttons[0]);const firstVisible=within(screen.getByRole('list',{name:'组内密钥'})).getAllByRole('button').filter(button=>button.hasAttribute('data-secret-reference')).map(button=>button.getAttribute('data-secret-reference'));expect(firstVisible).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'返回密钥分组'}));fireEvent.click(screen.getAllByRole('button',{name:'打开密钥分组：聚合连接'})[1]);const secondVisible=within(screen.getByRole('list',{name:'组内密钥'})).getAllByRole('button').filter(button=>button.hasAttribute('data-secret-reference')).map(button=>button.getAttribute('data-secret-reference'));expect(secondVisible).toHaveLength(1);expect(new Set([...firstVisible,...secondVisible])).toEqual(new Set(['first-reference','second-reference']));
});
