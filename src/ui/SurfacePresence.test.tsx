import {useState} from 'react';
import {createPortal} from 'react-dom';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConfirmationModal,ConfirmationModalPresence} from './ConfirmationModal';
import {SurfacePresence} from './SurfacePresence';
import {WorkspaceUploadFeedback,type UploadNotice} from '../local-app/WorkspaceUploadFeedback';

const animateDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'animate');
let animations:Array<{finished:Promise<void>;finish:()=>void;cancel:()=>void;effect:{target:Element}}>;
beforeEach(()=>{
 animations=[];
 Element.prototype.animate=vi.fn(function(this:Element){let finish!:()=>void,reject!:(reason:Error)=>void;const finished=new Promise<void>((resolve,no)=>{finish=resolve;reject=no;});const animation={finished,finish,cancel:()=>reject(Error('cancelled')),effect:{target:this}};animations.push(animation);return animation as unknown as Animation;});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();if(animateDescriptor)Object.defineProperty(Element.prototype,'animate',animateDescriptor);else delete (Element.prototype as Partial<Element>).animate;});
const finish=async()=>act(async()=>animations.forEach(animation=>animation.finish()));
function Confirmation({cancel,confirm,pending=false}:{cancel:()=>void;confirm:()=>void;pending?:boolean}){
 const [open,setOpen]=useState(false);
 return <><button onClick={()=>setOpen(true)}>打开确认</button><ConfirmationModalPresence>{open&&createPortal(<ConfirmationModal title="受控确认" confirmLabel="确认" isPending={pending} onCancel={()=>{cancel();setOpen(false);}} onConfirm={()=>{confirm();setOpen(false);}}><p>核对内容。</p></ConfirmationModal>,document.body)}</ConfirmationModalPresence></>;
}

it('starts a portaled dialog immediately and returns focus while retaining an inert exit surface',async()=>{
 const cancel=vi.fn();render(<Confirmation cancel={cancel} confirm={vi.fn()}/>);const trigger=screen.getByRole('button',{name:'打开确认'});act(()=>trigger.focus());fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'受控确认'})).toBeTruthy();expect(animations).toHaveLength(2);await finish();
 fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(cancel).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(trigger);
 expect(screen.queryByRole('dialog')).toBeNull();expect(document.querySelector('.modal-backdrop')?.hasAttribute('inert')).toBe(true);
 await finish();expect(document.querySelector('.modal-backdrop')).toBeNull();
});

it('reopens during exit without an old animation completion removing the new dialog',async()=>{
 render(<Confirmation cancel={vi.fn()} confirm={vi.fn()}/>);const trigger=screen.getByRole('button',{name:'打开确认'});fireEvent.click(trigger);await finish();
 fireEvent.click(screen.getByRole('button',{name:'取消'}));const old=animations.slice(-2);fireEvent.click(trigger);
 await act(async()=>old.forEach(animation=>animation.finish()));expect(screen.getByRole('dialog',{name:'受控确认'})).toBeTruthy();
 expect(document.querySelector('.modal-backdrop')?.hasAttribute('inert')).toBe(false);
});

it('keeps pending confirmation locked and invokes the allowed action without waiting for the exit',async()=>{
 const confirm=vi.fn(),cancel=vi.fn();const view=render(<Confirmation cancel={cancel} confirm={confirm} pending/>);
 fireEvent.click(screen.getByRole('button',{name:'打开确认'}));fireEvent.keyDown(window,{key:'Escape'});
 expect(cancel).not.toHaveBeenCalled();expect((screen.getByRole('button',{name:'处理中…'}) as HTMLButtonElement).disabled).toBe(true);
 view.rerender(<Confirmation cancel={cancel} confirm={confirm}/>);fireEvent.click(screen.getByRole('button',{name:'确认'}));
 expect(confirm).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).toBeNull();expect(document.querySelector('.modal-backdrop')).toBeTruthy();await finish();
});

it('honors the original toast expiry and replaces a retiring notice without losing unfinished upload details',async()=>{
 vi.useFakeTimers();const dismissed=vi.fn();let replace!:(notice:UploadNotice)=>void;
 function Host(){const [notice,setNotice]=useState<UploadNotice|undefined>({id:1,message:'首次结果',failed:true,expiresAt:Date.now()+5000});replace=setNotice;return <WorkspaceUploadFeedback rows={[{id:1,name:'file.png',status:'failed'}]} running={false} disabled={false} notice={notice} onDismiss={id=>{dismissed(id);setNotice(undefined);}} onRetry={()=>{}}/>;}
 render(<Host/>);await finish();await act(async()=>vi.advanceTimersByTime(5000));expect(dismissed).toHaveBeenCalledWith(1);
 expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();expect(document.querySelector('.workspace-upload-toast')?.hasAttribute('inert')).toBe(true);
 const old=animations.at(-1)!;await act(async()=>replace({id:2,message:'最新结果',failed:false,expiresAt:Date.now()+5000}));
 await act(async()=>old.finish());expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('最新结果');expect(screen.getByRole('region',{name:'上传结果'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'关闭上传提示'}));expect(dismissed).toHaveBeenCalledWith(2);await finish();expect(document.querySelector('.workspace-upload-toast')).toBeNull();expect(screen.getByRole('region',{name:'上传结果'})).toBeTruthy();
});

it('does not animate or retain a dismissed dialog with reduced motion',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true}));render(<Confirmation cancel={vi.fn()} confirm={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开确认'}));fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(document.querySelector('.modal-backdrop')).toBeNull();expect(Element.prototype.animate).not.toHaveBeenCalled();
});

it('immediately releases a legacy deletion form when its confirmation step has already changed',()=>{
 function Legacy(){const [open,setOpen]=useState(true);return <SurfacePresence kind="confirmation">{open&&<div role="dialog" aria-label="原有删除表单"><button onClick={()=>setOpen(false)}>关闭原有表单</button></div>}</SurfacePresence>;}
 render(<Legacy/>);fireEvent.click(screen.getByRole('button',{name:'关闭原有表单'}));expect(screen.queryByRole('dialog',{name:'原有删除表单'})).toBeNull();expect(Element.prototype.animate).not.toHaveBeenCalled();
});
