import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {AccountForm} from '../accounts/AccountForm';
import {ConfirmationModal} from './ConfirmationModal';
import {useDialogFocus} from './useDialogFocus';
import {HelpTip} from './HelpTip';
afterEach(cleanup);
it('opens help on the first Enter and Space activation and closes on Escape',async()=>{
 const user=userEvent.setup();render(<HelpTip label="键盘提示">提示内容</HelpTip>);
 const trigger=screen.getByRole('button',{name:'键盘提示说明'});
 await user.tab();
 for(const key of ['{Enter}',' ']){
  await user.keyboard('{Escape}');
  await user.keyboard(key);
  expect(screen.getByRole('tooltip').textContent).toContain('提示内容');
 }
 expect(document.activeElement).toBe(trigger);
 await user.keyboard('{Escape}');expect(screen.queryByRole('tooltip')).toBeNull();
});
it('names the creation dialog and contains keyboard focus without submitting on Escape',async()=>{
 const user=userEvent.setup(),close=vi.fn(),submit=vi.fn();render(<AccountForm isPending={false} onClose={close} onSubmit={submit}/>);
 const dialog=screen.getByRole('dialog',{name:'新建账号'});
 await user.tab({shift:true});expect(dialog.contains(document.activeElement)).toBe(true);
 await user.keyboard('{Escape}');expect(close).toHaveBeenCalledTimes(1);expect(submit).not.toHaveBeenCalled();
});
it('keeps a pending creation dialog open',async()=>{
 const user=userEvent.setup(),close=vi.fn();render(<AccountForm isPending onClose={close} onSubmit={vi.fn()}/>);
 await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();
});
function Parent({closed}:{closed:()=>void}){
 const[child,setChild]=useState(false),ref=useDialogFocus<HTMLElement>(true,closed);
 return <section aria-label="父对话框" role="dialog" ref={ref}><button onClick={()=>setChild(true)}>打开子对话框</button>{child&&<ConfirmationModal title="子对话框" confirmLabel="确认" onCancel={()=>setChild(false)} onConfirm={()=>{}}><p>子对话框内容</p></ConfirmationModal>}</section>;
}
it('routes Escape and Tab to the active child dialog',async()=>{
 const user=userEvent.setup(),closed=vi.fn();render(<Parent closed={closed}/>);
 await user.click(screen.getByRole('button',{name:'打开子对话框'}));
 const child=screen.getByRole('dialog',{name:'子对话框'});
 await user.tab({shift:true});expect(child.contains(document.activeElement)).toBe(true);
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog',{name:'子对话框'})).toBeNull();expect(closed).not.toHaveBeenCalled();
});
