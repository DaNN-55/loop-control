import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalSecretAdministration} from './LocalSecretAdministration';
import {localRequest} from './client';
import type {SecretMetadata} from './secretAdministrationTypes';
vi.mock('./client',()=>({localRequest:vi.fn()}));
const production:SecretMetadata={reference:'synthetic-production',names:['演示制作密钥'],aliases:[],purpose:'制作密钥',category:'connection',runtimeUses:[],connections:[{connectionId:'synthetic-connection',name:'演示连接',provider:'openai',version:2,current:true,revoked:false}],pendingUses:[],history:{metadataOccurrences:0,fileOccurrences:0,files:[]},revealAllowed:true,state:'未读取密钥值'};
const system:SecretMetadata={...production,reference:'synthetic-system',names:['演示系统用途'],category:'system',connections:[],revealAllowed:false};
afterEach(()=>{cleanup();vi.resetAllMocks();});
function inventory(){vi.mocked(localRequest).mockImplementation(async path=>path.startsWith('secrets/detail?')?{item:production}:{items:[production,system],total:2,page:1,pageSize:50});}
it('shows production actions in the first usage disclosure and keeps other groups on the same page',async()=>{
 inventory();render(<LocalSecretAdministration embedded csrf="synthetic" onClose={()=>{}}/>);
 const productionGroup=(await screen.findByText('制作服务')).closest('details')!;
 expect(productionGroup.open).toBe(true);expect(within(productionGroup).getByRole('button',{name:/^查看密钥：/})).toBeTruthy();
 const systemGroup=screen.getByText('本机系统').closest('details')!;expect(systemGroup.open).toBe(false);
 fireEvent.click(within(systemGroup).getByText('本机系统'));await waitFor(()=>expect(systemGroup.open).toBe(true));
 expect(productionGroup.open).toBe(true);expect(within(systemGroup).queryByRole('button',{name:/^查看密钥：/})).toBeNull();
 expect(screen.queryByRole('button',{name:'返回密钥分组'})).toBeNull();expect(localRequest).toHaveBeenCalledTimes(1);
});
it('opens verification in the same surface and clears it when returning to the inventory',async()=>{
 inventory();render(<LocalSecretAdministration embedded csrf="synthetic" onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:/^查看密钥：/}));await screen.findByLabelText('当前登录密码');
 expect(screen.queryByLabelText('搜索密钥')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));await waitFor(()=>expect(screen.queryByLabelText('当前登录密码')).toBeNull());
 expect(vi.mocked(localRequest).mock.calls.some(([path])=>path==='secrets/reveal')).toBe(false);
});
it('cancels an in-flight copy as soon as the detail is left',async()=>{
 let finish!:(value:unknown)=>void;const copy=vi.fn();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 inventory();const read=vi.mocked(localRequest).getMockImplementation()!;vi.mocked(localRequest).mockImplementation((path,init)=>path==='secrets/reveal'?new Promise(resolve=>{finish=resolve;}):read(path,init));
 render(<LocalSecretAdministration embedded csrf="synthetic" onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:/^复制密钥：/}));
 fireEvent.change(await screen.findByLabelText('当前登录密码'),{target:{value:'synthetic-password'}});fireEvent.submit(screen.getByRole('form',{name:'验证管理员身份'}));await screen.findByText('正在验证…');
 fireEvent.click(screen.getByRole('button',{name:'返回密钥列表'}));await act(async()=>finish({value:'synthetic-secret',expiresAt:new Date(Date.now()+30000).toISOString()}));
 expect(copy).not.toHaveBeenCalled();expect(screen.queryByLabelText('当前登录密码')).toBeNull();
});
it('keeps a credential shared by two connections in one usage row',async()=>{
 const shared={...production,connections:[...production.connections,{...production.connections[0],connectionId:'synthetic-other',name:'另一个连接'}]};
 vi.mocked(localRequest).mockResolvedValue({items:[shared],total:1,page:1,pageSize:50});render(<LocalSecretAdministration embedded csrf="synthetic" onClose={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'演示制作密钥 v2'})).toBeTruthy();expect(screen.getAllByRole('button',{name:/^查看密钥：/})).toHaveLength(1);expect(screen.getByText('共 1 项')).toBeTruthy();expect(screen.getByText(/演示连接 \/ 另一个连接/)).toBeTruthy();
});
