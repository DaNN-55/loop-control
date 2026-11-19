import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import {workspaceShotPreparation} from './workspaceShotPreparation';
import {WorkspaceShotPreparationStatus} from './WorkspaceShotPreparationStatus';

afterEach(cleanup);
const preparation=()=>workspaceShotPreparation({clips:[{id:'c',itemId:'i',shotId:'s',source:null}],narration:[{shotId:'s',requestedMode:'none'}],captions:[{shotId:'s',contract:{enabled:true},timing:'stale'}],readiness:{placeholders:['i'],missingSources:[]}} as unknown as ProductionWorkspace,'s',null);
const trigger=()=>screen.getByRole('button',{name:'镜头 01准备情况：待2项'});
const panel=()=>screen.getByRole('group',{name:'镜头 01准备情况'});
it('opens three system statuses from the compact trigger and navigates without manual checkboxes',async()=>{
 const user=userEvent.setup(),onNavigate=vi.fn();render(<WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={onNavigate}/>);
 expect(trigger().textContent).toBe('待2项');await user.click(trigger());
 const rows=within(panel()).getAllByRole('listitem');expect(rows).toHaveLength(3);
 expect(rows[0].getAttribute('data-state')).toBe('pending');expect(rows[1].getAttribute('data-state')).toBe('disabled');expect(rows[2].getAttribute('data-state')).toBe('pending');
 expect(within(panel()).queryByRole('checkbox')).toBeNull();
 await user.click(within(panel()).getByRole('button',{name:'字幕 待调整'}));expect(onNavigate).toHaveBeenCalledWith('captions');expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull();
});
it('keeps a hover preview open while the pointer moves into its content without stealing focus',async()=>{
 const user=userEvent.setup();render(<><input aria-label="其他输入"/><WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={vi.fn()}/></>);
 const input=screen.getByRole('textbox');await user.click(input);await user.hover(trigger());expect(panel()).toBeTruthy();expect(document.activeElement).toBe(input);
 const content=panel();await user.unhover(trigger());await user.hover(content);await act(async()=>{await new Promise(r=>setTimeout(r,200));});expect(panel()).toBeTruthy();
 await user.unhover(content);await waitFor(()=>expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull());
});
it('pins a hover preview on click and dismisses it by Escape or an outside click',async()=>{
 const user=userEvent.setup();render(<><WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={vi.fn()}/><button type="button">外部</button></>);
 await user.hover(trigger());await user.click(trigger());await user.unhover(trigger());await act(async()=>{await new Promise(r=>setTimeout(r,200));});expect(panel()).toBeTruthy();
 await user.keyboard('{Escape}');expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull();expect(document.activeElement).toBe(trigger());
 await user.click(trigger());await user.click(screen.getByRole('button',{name:'外部'}));await waitFor(()=>expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull());
});
it('opens on focus and lets keyboard users enter, navigate and leave the item list',async()=>{
 const user=userEvent.setup(),onNavigate=vi.fn();render(<><WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={onNavigate}/><button type="button">之后</button></>);
 await user.tab();expect(document.activeElement).toBe(trigger());expect(panel()).toBeTruthy();
 await user.keyboard('{Enter}');await user.tab();expect(document.activeElement).toBe(within(panel()).getByRole('button',{name:'画面 待完成'}));
 await user.tab();expect(document.activeElement).toBe(within(panel()).getByRole('button',{name:'主声音 已关闭'}));
 await user.keyboard('{Enter}');expect(onNavigate).toHaveBeenCalledWith('voice');expect(document.activeElement).toBe(trigger());
 await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'之后'}));
});
it('does not bubble status pointer, keyboard or drag actions to the surrounding shot row',()=>{
 const onClick=vi.fn(),onKeyDown=vi.fn(),onDragStart=vi.fn();render(<div onClick={onClick} onKeyDown={onKeyDown} onDragStart={onDragStart}><WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={vi.fn()}/></div>);
 fireEvent.click(trigger());fireEvent.keyDown(trigger(),{key:'ArrowDown',altKey:true});fireEvent.dragStart(trigger());expect(onClick).not.toHaveBeenCalled();expect(onKeyDown).not.toHaveBeenCalled();expect(onDragStart).not.toHaveBeenCalled();
});
it('exposes completion text and the optional fourth item without colour being the only evidence',async()=>{
 const value=preparation();value.items[0]={...value.items[0],status:'complete',statusLabel:'已完成'};value.items.push({id:'sound',label:'音效',status:'pending',statusLabel:'待完成',detail:'缺音效'});
 const user=userEvent.setup();render(<WorkspaceShotPreparationStatus preparation={value} shotLabel="镜头 01"/>);await user.click(trigger());
 expect(within(panel()).getAllByRole('listitem')).toHaveLength(4);expect(within(panel()).getByText('已完成')).toBeTruthy();expect(within(panel()).getByText('已关闭')).toBeTruthy();
});
it('can Escape from a focused item and Tab out of the list without trapping focus',async()=>{
 const user=userEvent.setup();render(<><WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={vi.fn()}/><button type="button">下一控件</button></>);
 await user.tab();await user.keyboard('{Enter}');await user.tab();await user.keyboard('{Escape}');expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull();expect(document.activeElement).toBe(trigger());
 await user.click(trigger());fireEvent.keyDown(trigger(),{key:'Tab'});
 await user.tab();await user.tab();await user.tab();
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'下一控件'}));await waitFor(()=>expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull());
});
it('allows a fresh hover after navigation or Escape without reopening merely from restored focus',async()=>{
 const user=userEvent.setup();render(<WorkspaceShotPreparationStatus preparation={preparation()} shotLabel="镜头 01" onNavigate={vi.fn()}/>);
 await user.hover(trigger());await user.click(within(panel()).getByRole('button',{name:'画面 待完成'}));
 expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull();expect(document.activeElement).toBe(trigger());
 await user.hover(trigger());expect(panel()).toBeTruthy();
 await user.keyboard('{Escape}');expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull();expect(document.activeElement).toBe(trigger());
 await act(async()=>{await new Promise(r=>setTimeout(r,20));});expect(screen.queryByRole('group',{name:'镜头 01准备情况'})).toBeNull();
 await user.unhover(trigger());await user.hover(trigger());expect(panel()).toBeTruthy();
});
