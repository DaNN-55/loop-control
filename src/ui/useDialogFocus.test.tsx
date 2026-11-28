import {ConfirmationModal} from './ConfirmationModal';
import {useState} from 'react';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {useDialogFocus} from './useDialogFocus';
afterEach(cleanup);
function Dialog(){const ref=useDialogFocus(true,vi.fn());return <section ref={ref} role="dialog"><button>关闭</button><details><summary>连接版本</summary><button>重新绑定</button></details><div hidden><button>隐藏标签中的按钮</button></div></section>;}
it('wraps focus through visible summaries and skips collapsed details and hidden tab panels',async()=>{
 const user=userEvent.setup();render(<Dialog/>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
 await user.tab({shift:true});expect(document.activeElement).toBe(screen.getByText('连接版本'));
 await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
 await user.click(screen.getByText('连接版本'));await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'重新绑定'}));
 await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
});

function FormDialog() {
 const [open,setOpen]=useState(false);
 const ref=useDialogFocus<HTMLFormElement>(open,()=>setOpen(false));
 return <><button onClick={()=>setOpen(true)}>新建表单</button>{open&&<div role="dialog" aria-label="测试表单"><form ref={ref} onSubmit={event=>{event.preventDefault();setOpen(false);}}><button type="button" onClick={()=>setOpen(false)}>关闭表单</button><input aria-label="名称" autoFocus/><button>保存</button></form></div>}</>;
}
it('focuses the input and returns to the keyboard opener after Escape despite autoFocus',async()=>{
 const user=userEvent.setup();render(<FormDialog/>);
 const opener=screen.getByRole('button',{name:'新建表单'});
 await user.tab();await user.keyboard('{Enter}');
 expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'名称'}));
 await user.keyboard('{Escape}');expect(document.activeElement).toBe(opener);
});

it('keeps destructive confirmation focus on cancel even when a confirmation input exists',()=>{
 render(<ConfirmationModal title="删除测试记录" tone="danger" confirmLabel="删除" onCancel={()=>{}} onConfirm={()=>{}}><input aria-label="确认名称"/></ConfirmationModal>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));
});

it('preserves keyboard focus and restores the actual opener inside a Shadow DOM workspace',()=>{
 const host=document.createElement('div');document.body.append(host);
 const shadow=host.attachShadow({mode:'open'}),container=document.createElement('div');shadow.append(container);
 const view=render(<FormDialog/>,{container}),ui=within(container);
 try{
  const opener=ui.getByRole('button',{name:'新建表单'});opener.focus();fireEvent.click(opener);
  const input=ui.getByRole('textbox',{name:'名称'}),save=ui.getByRole('button',{name:'保存'}),close=ui.getByRole('button',{name:'关闭表单'});
  expect(shadow.activeElement).toBe(input);
  const middle=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,composed:true,cancelable:true});input.dispatchEvent(middle);
  expect(middle.defaultPrevented).toBe(false);expect(shadow.activeElement).toBe(input);
  save.focus();fireEvent.keyDown(save,{key:'Tab',composed:true});expect(shadow.activeElement).toBe(close);
  fireEvent.keyDown(close,{key:'Tab',shiftKey:true,composed:true});expect(shadow.activeElement).toBe(save);
  fireEvent.keyDown(save,{key:'Escape',composed:true});expect(shadow.activeElement).toBe(opener);
 }finally{view.unmount();host.remove();}
});

function PendingChild(){
 const [pending,setPending]=useState(false),ref=useDialogFocus<HTMLElement>(true,()=>{});
 return <section role="dialog" aria-label="子表单" ref={ref}>{pending?<p role="status">正在保存</p>:<button onClick={()=>setPending(true)}>开始保存</button>}</section>;
}
function NestedForm({close}:{close:()=>void}){
 const [child,setChild]=useState(false),ref=useDialogFocus<HTMLElement>(true,close);
 return <section role="dialog" aria-label="父表单" ref={ref}><button onClick={()=>setChild(true)}>打开子表单</button>{child&&<PendingChild/>}</section>;
}
it('does not route Escape to the parent when pending child content loses focus',async()=>{
 const user=userEvent.setup(),close=vi.fn();render(<NestedForm close={close}/>);
 await user.click(screen.getByRole('button',{name:'打开子表单'}));
 await user.click(screen.getByRole('button',{name:'开始保存'}));
 expect(document.activeElement).toBe(document.body);
 await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();
 await user.tab();expect(screen.getByRole('dialog',{name:'子表单'}).contains(document.activeElement)).toBe(true);
});

function ReplacedOpener(){
 const [open,setOpen]=useState(false),[created,setCreated]=useState(false),ref=useDialogFocus<HTMLElement>(open,()=>setOpen(false));
 return <main aria-label="生产单列表">{!created&&<button onClick={()=>setOpen(true)}>添加生产单</button>}{open&&<section role="dialog" ref={ref}><button onClick={()=>{setCreated(true);setOpen(false);}}>创建完成</button></section>}</main>;
}
it('uses the main workspace as a fallback when a successful submission removes its opener',async()=>{
 const user=userEvent.setup();render(<ReplacedOpener/>);
 await user.click(screen.getByRole('button',{name:'添加生产单'}));await user.click(screen.getByRole('button',{name:'创建完成'}));
 expect(document.activeElement).toBe(screen.getByRole('main',{name:'生产单列表'}));
});

function ImmediatelyNested(){
 const ref=useDialogFocus<HTMLElement>(true,()=>{});
 return <section role="dialog" aria-label="父窗口" ref={ref}><button>父窗口操作</button><ConfirmationModal title="子窗口" confirmLabel="保存" onCancel={()=>{}} onConfirm={()=>{}}><p>子窗口内容</p></ConfirmationModal></section>;
}
it('keeps initial focus in the innermost dialog when nested dialogs mount together',()=>{
 render(<ImmediatelyNested/>);
 expect(screen.getByRole('dialog',{name:'子窗口'}).contains(document.activeElement)).toBe(true);
});


it.each(['关闭表单','保存'])('returns focus to the opener after %s',async(action)=>{
 const user=userEvent.setup();render(<FormDialog/>);
 const opener=screen.getByRole('button',{name:'新建表单'});
 await user.click(opener);await user.click(screen.getByRole('button',{name:action}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(opener);
});

it('leaves Escape and Tab inside a native child dialog to the browser instead of closing its outer workspace',async()=>{
 const close=vi.fn();
 function Workspace(){const ref=useDialogFocus<HTMLElement>(true,close);return <section ref={ref} role="dialog" aria-label="生产单"><button>外层操作</button><dialog open aria-label="核对候选"><button>核对下一条</button></dialog></section>;}
 const user=userEvent.setup();render(<Workspace/>);
 const next=screen.getByRole('button',{name:'核对下一条'});next.focus();
 await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();
 const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});next.dispatchEvent(tab);
 expect(tab.defaultPrevented).toBe(false);
});
