import {StrictMode,useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FeedbackNotice,FeedbackProvider} from './FeedbackNotice';

afterEach(()=>{cleanup();vi.useRealTimers();});
it('shares one notification region, merges duplicates and never moves input focus',()=>{
 render(<FeedbackProvider><input aria-label="正文" autoFocus/><FeedbackNotice message="已保存"/><FeedbackNotice message="已保存"/></FeedbackProvider>);
 expect(screen.getAllByRole('region',{name:'通知'})).toHaveLength(1);expect(screen.getAllByText('已保存')).toHaveLength(1);expect(document.activeElement).toBe(screen.getByRole('textbox'));
 fireEvent.click(screen.getByRole('button',{name:'关闭操作提示'}));expect(screen.queryByText('已保存')).toBeNull();
});
it('pauses transient feedback for pointer and keyboard and resumes the remaining time',()=>{
 vi.useFakeTimers();render(<FeedbackNotice message="已复制"/>);const card=screen.getByRole('status',{name:'操作提示'});
 act(()=>vi.advanceTimersByTime(1000));fireEvent.mouseEnter(card);act(()=>vi.advanceTimersByTime(5000));expect(screen.getByText('已复制')).toBeTruthy();
 fireEvent.focus(screen.getByRole('button',{name:'关闭操作提示'}));fireEvent.mouseLeave(card);act(()=>vi.advanceTimersByTime(5000));expect(screen.getByText('已复制')).toBeTruthy();
 fireEvent.blur(screen.getByRole('button',{name:'关闭操作提示'}));act(()=>vi.advanceTimersByTime(2999));expect(screen.getByText('已复制')).toBeTruthy();act(()=>vi.advanceTimersByTime(1));expect(screen.queryByText('已复制')).toBeNull();
});
it('queues excess messages and keeps actionable warnings until explicitly closed',()=>{
 vi.useFakeTimers();render(<FeedbackProvider>{['一','二','三','四'].map(message=><FeedbackNotice key={message} message={message}/>)}<FeedbackNotice message="结果未知" tone="warning" duration={null}><button>核对</button></FeedbackNotice></FeedbackProvider>);
 expect(screen.getAllByRole('status')).toHaveLength(3);expect(screen.getByRole('button',{name:'核对'})).toBeTruthy();act(()=>vi.advanceTimersByTime(4000));expect(screen.getByText('结果未知')).toBeTruthy();expect(screen.getByText('四')).toBeTruthy();
});
it('does not replay on ordinary rerenders but shows a distinct later interaction',()=>{
 vi.useFakeTimers();const dismiss=vi.fn(),view=render(<FeedbackNotice message="已保存" identity={1} onDismiss={dismiss}/>);act(()=>vi.advanceTimersByTime(4000));
 view.rerender(<FeedbackNotice message="已保存" identity={1} onDismiss={dismiss}/>);expect(screen.queryByText('已保存')).toBeNull();expect(dismiss).toHaveBeenCalledOnce();
 view.rerender(<FeedbackNotice message="已保存" identity={2} onDismiss={dismiss}/>);expect(screen.getByText('已保存')).toBeTruthy();
});
it('defers outside notices during a modal and keeps local feedback inside the dialog',async()=>{
 vi.useFakeTimers();function View(){const [open,setOpen]=useState(true);return <FeedbackProvider><FeedbackNotice message="后台上传完成"/>{open&&<div role="dialog" aria-modal="true"><FeedbackNotice message="已复制标题"/><button onClick={()=>setOpen(false)}>关闭弹窗</button></div>}</FeedbackProvider>;}
 render(<View/>);await act(async()=>{});expect(screen.queryByText('后台上传完成')).toBeNull();expect(screen.getByRole('dialog').contains(screen.getByText('已复制标题'))).toBe(true);act(()=>vi.advanceTimersByTime(5000));fireEvent.click(screen.getByRole('button',{name:'关闭弹窗'}));await act(async()=>{});expect(screen.getByText('后台上传完成')).toBeTruthy();
});
it('only presents restored feedback when its pane is visible and does not replay dismissed restores',async()=>{
 vi.useFakeTimers();function View({hidden,shown=true}:{hidden:boolean;shown?:boolean}){return <FeedbackProvider>{shown&&<section hidden={hidden}><FeedbackNotice message="已恢复草稿" onceKey="owner:episode:source"/></section>}</FeedbackProvider>;}
 const view=render(<StrictMode><View hidden/></StrictMode>);await act(async()=>{});expect(screen.queryByText('已恢复草稿')).toBeNull();
 view.rerender(<StrictMode><View hidden={false}/></StrictMode>);await act(async()=>{});expect(screen.getByText('已恢复草稿')).toBeTruthy();act(()=>vi.advanceTimersByTime(4000));
 view.rerender(<StrictMode><View hidden={false} shown={false}/></StrictMode>);view.rerender(<StrictMode><View hidden={false}/></StrictMode>);expect(screen.queryByText('已恢复草稿')).toBeNull();
});
