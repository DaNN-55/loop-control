import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceUploadFeedback,type UploadNotice} from './WorkspaceUploadFeedback';
const rows=[{id:1,name:'bad.png',status:'failed' as const,error:'文件内容无效。'}];
afterEach(()=>{cleanup();vi.useRealTimers();});
it('keeps unfinished details and retry after the toast expires, without a history entry',()=>{
 vi.useFakeTimers();const retry=vi.fn();
 function View(){const [notice,setNotice]=useState<UploadNotice|undefined>({id:1,message:'bad.png：文件内容无效。',failed:true,expiresAt:Date.now()+5000});return <WorkspaceUploadFeedback rows={rows} running={false} disabled={false} notice={notice} onDismiss={()=>setNotice(undefined)} onRetry={retry}/>;}
 render(<View/>);expect(screen.queryByLabelText('上传记录')).toBeNull();
 act(()=>vi.advanceTimersByTime(5000));expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();
 expect(screen.getByRole('region',{name:'上传结果'}).textContent).toContain('bad.png');fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));expect(retry).toHaveBeenCalledTimes(1);
});
it('focuses unfinished details from the toast and retains them after dismissal',()=>{
 const dismiss=vi.fn();render(<WorkspaceUploadFeedback rows={rows} running={false} disabled={false} notice={{id:9,message:'上传未完成。',failed:true,expiresAt:Date.now()+5000}} onDismiss={dismiss} onRetry={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看'}));expect(document.activeElement).toBe(screen.getByRole('region',{name:'上传结果'}));fireEvent.click(screen.getByRole('button',{name:'关闭上传提示'}));expect(dismiss).toHaveBeenCalledWith(9);
 expect(screen.getByRole('region',{name:'上传结果'}).textContent).toContain('文件内容无效');
});
it('only lists unfinished files and removes recovery controls after success',()=>{
 const props={running:false,disabled:false,onDismiss:()=>{},onRetry:()=>{}};
 const view=render(<WorkspaceUploadFeedback {...props} rows={[...rows,{id:2,name:'good.png',status:'succeeded'}]}/>);
 expect(screen.getByRole('region',{name:'上传结果'}).textContent).not.toContain('good.png');
 view.rerender(<WorkspaceUploadFeedback {...props} rows={rows.map(row=>({...row,status:'succeeded'}))} notice={{id:3,message:'已添加 1 个文件。',failed:false,expiresAt:Date.now()+5000}}/>);
 expect(screen.queryByRole('region',{name:'上传结果'})).toBeNull();expect(screen.queryByRole('button',{name:'重试未完成项'})).toBeNull();expect(screen.queryByLabelText('上传记录')).toBeNull();expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('已添加 1 个文件');
});
it('disables retry while uploading and retains unfinished details',()=>{
 render(<WorkspaceUploadFeedback rows={rows} running={true} disabled={false} onDismiss={()=>{}} onRetry={()=>{}}/>);
 expect(screen.getByRole('button',{name:'重试未完成项'}).hasAttribute('disabled')).toBe(true);expect(screen.getByRole('region',{name:'上传结果'}).textContent).toContain('bad.png');
});
it('does not replay expired feedback when a panel reopens and cancels an older notice timer',()=>{
 vi.useFakeTimers();const dismiss=vi.fn();const props={rows,running:false,disabled:false,onDismiss:dismiss,onRetry:()=>{}};
 const view=render(<WorkspaceUploadFeedback {...props} notice={{id:1,message:'旧错误',failed:true,expiresAt:Date.now()-1}}/>);expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();act(()=>vi.advanceTimersByTime(1));expect(dismiss).toHaveBeenCalledWith(1);
 view.rerender(<WorkspaceUploadFeedback {...props} notice={{id:2,message:'新错误',failed:true,expiresAt:Date.now()+5000}}/>);act(()=>vi.advanceTimersByTime(1000));view.rerender(<WorkspaceUploadFeedback {...props} notice={{id:3,message:'另一次错误',failed:true,expiresAt:Date.now()+5000}}/>);act(()=>vi.advanceTimersByTime(4000));expect(dismiss).not.toHaveBeenCalledWith(2);expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('另一次错误');act(()=>vi.advanceTimersByTime(1000));expect(dismiss).toHaveBeenCalledWith(3);
});
