import {render,screen,within,cleanup,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {RuntimeLogsDialog} from './RuntimeLogsDialog';
import {LogStorageSettings} from './LogStorageSettings';
import type {RuntimeLogEntry} from '../observability/logTypes';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const entry=(id:string,patch:Partial<RuntimeLogEntry>={}):RuntimeLogEntry=>({id,level:'INFO',occurredAt:'2026-11-11T01:00:00Z',time:null,episodeId:'ep-1',episodeName:'日照金山',operationId:'op-1',requestId:id,source:'后台处理',message:'started',raw:'started',sourceFile:'app.log',line:1,explanation:{what:'后台任务开始处理',result:'仅确认已开始。'},...patch});
const report={observedAt:'2026-11-11T02:00:00Z',truncated:false,sourceAvailable:true,maxEntries:200,entries:[entry('a'),entry('b',{level:'ERROR',raw:'Error: failed',explanation:{what:'处理失败',result:'等待核对。'}}),entry('c',{operationId:'op-other'}),entry('d',{episodeId:null,episodeName:null,operationId:null,occurredAt:null})]};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
it('filters, restores context across distinct requests and opens explanation and raw together',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>response(report)));const user=userEvent.setup();render(<RuntimeLogsDialog onClose={vi.fn()} returnFocusRef={{current:null}}/>);await screen.findByText('显示 4 条记录');await user.click(screen.getByRole('checkbox',{name:'只看错误'}));expect(screen.getByText('显示 1 条记录')).toBeTruthy();await user.click(screen.getByRole('button',{name:'处理失败'}));expect(screen.getByRole('region',{name:'日志说明'})).toBeTruthy();expect(screen.getByRole('region',{name:'原始日志（已脱敏）'})).toBeTruthy();await user.click(screen.getByRole('button',{name:/查看同次操作/}));expect(screen.getByText('显示 2 条记录 · 同次操作')).toBeTruthy();expect(screen.getAllByRole('region')).toHaveLength(2);await user.click(screen.getByRole('button',{name:'返回筛选结果'}));expect(screen.getByText('显示 1 条记录')).toBeTruthy();expect(screen.getByRole('checkbox',{name:'只看错误'})).toHaveProperty('checked',true);
});
it('distinguishes read failure, retry and unknown dates from empty results',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({error:'暂时无法读取日志'},503)).mockResolvedValue(response(report)));const user=userEvent.setup();render(<RuntimeLogsDialog onClose={vi.fn()} returnFocusRef={{current:null}}/>);expect((await screen.findByRole('alert')).textContent).toBe('暂时无法读取日志');await user.click(screen.getByRole('button',{name:'刷新'}));await screen.findByText('显示 4 条记录');fireEvent.change(screen.getByRole('combobox',{name:'时间范围'}),{target:{value:'unknown'}});expect(screen.getByText('显示 1 条记录')).toBeTruthy();await user.click(screen.getByRole('button',{name:'后台任务开始处理'}));expect(screen.getByText('未记录操作编号，无法关联同次操作。')).toBeTruthy();expect(screen.queryByRole('button',{name:/查看同次操作/})).toBeNull();
});
it('retains a failed location draft, saves independently and shows next-start semantics',async()=>{
 const state={activeDirectory:'/current',configuredDirectory:'/current',defaultDirectory:'/current',pending:false,warning:null};let saves=0;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{if(init?.method==='POST'){expect(JSON.parse(String(init.body))).toEqual({command:'save',path:'/chosen'});return ++saves===1?response({error:'目录暂时不可用'},400):response({...state,configuredDirectory:'/chosen',pending:true});}return response(state);}));
 const user=userEvent.setup();render(<LogStorageSettings csrf="explicit-csrf"/>);const input=await screen.findByRole('textbox',{name:'日志保存目录'});await waitFor(()=>expect(input).toHaveProperty('value','/current'));await user.clear(input);await user.type(input,'/chosen');await user.click(screen.getByRole('button',{name:'保存日志位置'}));expect((await screen.findByRole('alert')).textContent).toBe('目录暂时不可用');expect(input).toHaveProperty('value','/chosen');await user.click(screen.getByRole('button',{name:'保存日志位置'}));expect((await screen.findByRole('status')).textContent).toContain('下次启动生效');expect(within(screen.getByRole('region',{name:'日志存储位置'})).getByText('当前写入位置：/current')).toBeTruthy();
});
it('reports an invalid storage response without crashing personal preferences',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>response({path:'/wrong-contract'})));render(<LogStorageSettings csrf="explicit-csrf"/>);expect((await screen.findByRole('alert')).textContent).toContain('返回格式无效');expect(screen.getByRole('button',{name:'重新读取日志位置'})).toBeTruthy();
});
