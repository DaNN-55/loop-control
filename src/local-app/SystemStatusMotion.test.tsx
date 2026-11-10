import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SystemStatusDrawer} from './SystemStatusDrawer';

afterEach(()=>{cleanup();vi.unstubAllGlobals();delete (Element.prototype as Partial<Element>).animate;});
function App(){const [open,setOpen]=useState(false);return <SystemStatusDrawer open={open} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)} runtime={null} maintenance={[]} maintenanceAvailable={false} pending={false} error="" observedAt={null} onRefresh={()=>{}} onPage={()=>{}}/>;}

it('retains an inert exit surface, reverses an interrupted close and ignores its old completion',async()=>{
 const created:Array<{finished:Promise<void>;finish:()=>void;cancel:()=>void}>=[];
 Element.prototype.animate=vi.fn(()=>{let finish!:()=>void,reject!:(reason:Error)=>void;const finished=new Promise<void>((resolve,no)=>{finish=resolve;reject=no;});const animation={finished,finish,cancel:()=>reject(Error('cancelled'))};created.push(animation);return animation as unknown as Animation;});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<App/>);const trigger=screen.getByRole('button',{name:'系统状态：待确认'});act(()=>trigger.focus());
 fireEvent.click(trigger);await act(async()=>created.slice(0,2).forEach(animation=>animation.finish()));
 fireEvent.click(screen.getByRole('button',{name:'关闭系统状态详情'}));
 expect(document.querySelector('.status-drawer-layer')?.hasAttribute('inert')).toBe(true);expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger);await act(async()=>created.slice(2,4).forEach(animation=>animation.finish()));
 expect(screen.getByRole('dialog',{name:'系统状态详情'})).toBeTruthy();expect(document.querySelector('.status-drawer-layer')?.hasAttribute('inert')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'关闭系统状态详情'}));
 await act(async()=>created.slice(-2).forEach(animation=>animation.finish()));expect(document.querySelector('.status-drawer-layer')).toBeNull();
});

it('opens and closes immediately with reduced motion and never starts an animation',()=>{
 Element.prototype.animate=vi.fn();vi.stubGlobal('matchMedia',()=>({matches:true}));render(<App/>);
 const trigger=screen.getByRole('button',{name:'系统状态：待确认'});fireEvent.click(trigger);expect(screen.getByRole('dialog',{name:'系统状态详情'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'关闭系统状态详情'}));expect(document.querySelector('.status-drawer-layer')).toBeNull();expect(Element.prototype.animate).not.toHaveBeenCalled();
});
