import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceUploadFeedback,type UploadNotice} from './WorkspaceUploadFeedback';
const rows=[{id:1,name:'bad.png',status:'failed' as const,error:'文件内容无效。'}];
afterEach(()=>{cleanup();vi.useRealTimers();});
it('expires the toast after five seconds while keeping details and manual retry behind the history entry',()=>{
 vi.useFakeTimers();const retry=vi.fn();
 function View(){const [notice,setNotice]=useState<UploadNotice|undefined>({id:1,message:'bad.png：文件内容无效。',failed:true,expiresAt:Date.now()+5000});return <WorkspaceUploadFeedback rows={rows} running={false} disabled={false} notice={notice} onDismiss={()=>setNotice(undefined)} onRetry={retry}/>;}
 render(<View/>);const history=screen.getByLabelText('上传记录').closest('details')!;
 expect(history.open).toBe(false);expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('文件内容无效');
 act(()=>vi.advanceTimersByTime(4999));expect(screen.getByRole('status',{name:'上传提示'})).toBeTruthy();
 act(()=>vi.advanceTimersByTime(1));expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();expect(history.open).toBe(false);
 fireEvent.click(screen.getByLabelText('上传记录'));expect(history.open).toBe(true);expect(screen.getByRole('region',{name:'上传结果'}).textContent).toContain('bad.png');fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));expect(retry).toHaveBeenCalledTimes(1);
});
it('supports manual dismissal and opens recoverable details without consuming the failed record',()=>{
 const dismiss=vi.fn();render(<WorkspaceUploadFeedback rows={rows} running={false} disabled={false} notice={{id:9,message:'上传未完成。',failed:true,expiresAt:Date.now()+5000}} onDismiss={dismiss} onRetry={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看'}));expect(screen.getByLabelText('上传记录').closest('details')?.open).toBe(true);expect(document.activeElement).toBe(screen.getByRole('region',{name:'上传结果'}));fireEvent.click(screen.getByRole('button',{name:'关闭上传提示'}));expect(dismiss).toHaveBeenCalledWith(9);
 fireEvent.click(screen.getByRole('button',{name:'关闭上传记录'}));expect(screen.getByLabelText('上传记录').closest('details')?.open).toBe(false);expect(document.activeElement).toBe(screen.getByLabelText('上传记录'));
});
it('does not replay expired feedback when a panel reopens and cancels an older notice timer',()=>{
 vi.useFakeTimers();const dismiss=vi.fn();const props={rows,running:false,disabled:false,onDismiss:dismiss,onRetry:()=>{}};
 const view=render(<WorkspaceUploadFeedback {...props} notice={{id:1,message:'旧错误',failed:true,expiresAt:Date.now()-1}}/>);expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();act(()=>vi.advanceTimersByTime(1));expect(dismiss).toHaveBeenCalledWith(1);
 view.rerender(<WorkspaceUploadFeedback {...props} notice={{id:2,message:'新错误',failed:true,expiresAt:Date.now()+5000}}/>);act(()=>vi.advanceTimersByTime(1000));view.rerender(<WorkspaceUploadFeedback {...props} notice={{id:3,message:'另一次错误',failed:true,expiresAt:Date.now()+5000}}/>);act(()=>vi.advanceTimersByTime(4000));expect(dismiss).not.toHaveBeenCalledWith(2);expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('另一次错误');act(()=>vi.advanceTimersByTime(1000));expect(dismiss).toHaveBeenCalledWith(3);
});
