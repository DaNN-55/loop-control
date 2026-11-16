import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LocalDeletionRecovery} from './LocalDeletionRecovery';
import {localRequest,localCommand} from './client';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const prepared={cleanupKey:'prepared-key',title:'未提交的生产单',path:'/media/order-one',stagingPaths:['/media/order-one/file.stage'],phase:'prepared',message:'删除尚未提交，可恢复已暂存的文件。'};
const committed={cleanupKey:'committed-key',title:'文件待清理的生产单',path:'/media/order-two',stagingPaths:['/media/order-two/file.stage']};
it('reads durable tasks without retrying, distinguishes actions and focuses the requested task',async()=>{
 let finishRead!:(items:Array<typeof prepared|typeof committed>)=>void;vi.mocked(localRequest).mockImplementation(()=>new Promise(resolve=>{finishRead=resolve;}));
 render(<LocalDeletionRecovery revision={1} targetKey={committed.cleanupKey}/>);expect(screen.queryByRole('article')).toBeNull();expect(localCommand).not.toHaveBeenCalled();
 await act(async()=>finishRead([prepared,committed]));const target=await screen.findByRole('article',{name:committed.title});await waitFor(()=>expect(document.activeElement).toBe(target));
 expect(within(target).getByRole('button',{name:'继续清理'})).toBeTruthy();expect(screen.getByRole('button',{name:'恢复文件'})).toBeTruthy();expect(localCommand).not.toHaveBeenCalled();
 expect(screen.queryByRole('heading',{name:'待完成删除'})).toBeNull();expect(screen.queryByText(prepared.message)).toBeNull();expect(screen.getByText('删除未生效')).toBeTruthy();expect(screen.getByText('记录已删除')).toBeTruthy();
});
it('keeps user focus across a read-only refresh and focuses a different explicitly requested task',async()=>{
 vi.mocked(localRequest).mockResolvedValue([prepared,committed]);
 const content=(revision:number,targetKey:string)=><><button>其他操作</button><LocalDeletionRecovery revision={revision} targetKey={targetKey}/></>;
 const view=render(content(1,committed.cleanupKey));await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('article',{name:committed.title})));
 // Use an unaffected control: a disabled refresh button naturally loses focus in a browser.
 const outside=screen.getByRole('button',{name:'其他操作'});act(()=>outside.focus());view.rerender(content(2,committed.cleanupKey));
 await waitFor(()=>{expect(localRequest).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:'刷新清理任务'})).not.toHaveProperty('disabled',true);});expect(document.activeElement).toBe(outside);
 view.rerender(content(2,prepared.cleanupKey));await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('article',{name:prepared.title})));expect(localCommand).not.toHaveBeenCalled();
});
it('restores an uncommitted task once even when clicked twice and leaves other tasks alone',async()=>{
 vi.mocked(localRequest).mockResolvedValueOnce([prepared,committed]).mockResolvedValue([committed]);let finish!:(value:any)=>void;
 vi.mocked(localCommand).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}) as any);const onResolved=vi.fn();render(<LocalDeletionRecovery revision={1} onResolved={onResolved}/>);
 const button=await screen.findByRole('button',{name:'恢复文件'});fireEvent.click(button);fireEvent.click(button);expect(localCommand).toHaveBeenCalledTimes(1);expect(localCommand).toHaveBeenCalledWith('retryDeletionCleanup',{deletionKey:prepared.cleanupKey},undefined,'episode-lifecycle');
 finish({cleanupPending:false,recovered:true});await screen.findByText('文件已恢复，请重新核对后再删除。');expect(onResolved).toHaveBeenCalledWith(prepared.cleanupKey);expect(screen.queryByRole('article',{name:prepared.title})).toBeNull();expect(screen.getByRole('article',{name:committed.title})).toBeTruthy();
});
it('keeps the task and full failure message when cleanup remains pending, then reports confirmed completion',async()=>{
 vi.mocked(localRequest).mockResolvedValueOnce([committed]).mockResolvedValueOnce([committed]).mockResolvedValue([]);vi.mocked(localCommand).mockResolvedValueOnce({cleanupPending:true,message:'目录身份已变化，请检查原位置后重试。'}).mockResolvedValueOnce({cleanupPending:false});const user=userEvent.setup();render(<LocalDeletionRecovery revision={1}/>);
 await user.click(await screen.findByRole('button',{name:'继续清理'}));expect((await screen.findByRole('alert')).textContent).toContain('目录身份已变化');expect(screen.getByRole('article',{name:committed.title})).toBeTruthy();
 await waitFor(()=>expect((screen.getByRole('button',{name:'继续清理'})as HTMLButtonElement).disabled).toBe(false));await user.click(screen.getByRole('button',{name:'继续清理'}));await screen.findByText('文件清理已完成。');expect(screen.queryByRole('article')).toBeNull();
});
it('shows read failures and a working refresh without presenting them as an empty queue',async()=>{
 vi.mocked(localRequest).mockRejectedValueOnce(new Error('读取失败。')).mockResolvedValue([]);const user=userEvent.setup();render(<LocalDeletionRecovery revision={1}/>);expect((await screen.findByRole('alert')).textContent).toBe('读取失败。');expect(screen.queryByText('暂无待处理任务。')).toBeNull();await user.click(screen.getByRole('button',{name:'刷新清理任务'}));await screen.findByText('暂无待处理任务。');expect(screen.queryByRole('alert')).toBeNull();
});
it('releases the confirmed recovery while its queue refresh remains pending',async()=>{
 let rejectRead!:(reason:Error)=>void;vi.mocked(localRequest).mockResolvedValueOnce([prepared,committed]).mockImplementation(()=>new Promise((_resolve,reject)=>{rejectRead=reject;}));
 vi.mocked(localCommand).mockResolvedValue({cleanupPending:false,recovered:true});const state=vi.fn(),resolved=vi.fn();render(<LocalDeletionRecovery revision={1} onStateChange={state} onResolved={resolved}/>);
 fireEvent.click(await screen.findByRole('button',{name:'恢复文件'}));await screen.findByText('文件已恢复，请重新核对后再删除。');
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false}));expect(resolved).toHaveBeenCalledWith(prepared.cleanupKey);expect(screen.queryByRole('article',{name:prepared.title})).toBeNull();
 await act(async()=>rejectRead(Error('queue unavailable')));expect((await screen.findByRole('alert')).textContent).toContain('操作已保存');
});
it('does not replace a newer queue with a late previous response',async()=>{
 let old!:(value:any)=>void;vi.mocked(localRequest).mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;})).mockResolvedValue([committed]);const view=render(<LocalDeletionRecovery revision={1}/>);view.rerender(<LocalDeletionRecovery revision={2}/>);await screen.findByRole('article',{name:committed.title});old([prepared]);await waitFor(()=>expect(screen.queryByRole('article',{name:prepared.title})).toBeNull());expect(screen.getByRole('article',{name:committed.title})).toBeTruthy();
});

it('keeps a concrete prepared recovery failure visible while removing only the normal explanation',async()=>{
 const failure='文件恢复尚未完成：原位置已存在文件，请先检查。';vi.mocked(localRequest).mockResolvedValue([{...prepared,message:failure}]);render(<LocalDeletionRecovery revision={1}/>);
 await screen.findByText(failure);expect(screen.getByRole('button',{name:'恢复文件'})).toBeTruthy();expect(screen.getByText('查看位置')).toBeTruthy();
});
