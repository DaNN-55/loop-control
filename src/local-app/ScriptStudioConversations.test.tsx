import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ScriptStudioConversations} from './ScriptStudioConversations';
afterEach(cleanup);
const items=Array.from({length:6},(_,i)=>({id:i===0?null:'conversation-'+i,number:i+1,createdAt:'2026-11-18T10:00:00Z'}));
it('starts with only a dashed new-conversation button and distinguishes the selected conversation',()=>{
 const select=vi.fn(),create=vi.fn(),r=render(<ScriptStudioConversations items={[]} activeId={null} onSelect={select} onCreate={create}/>);
 expect(screen.getAllByRole('button')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'新开对话'}));expect(create).toHaveBeenCalledTimes(1);
 r.rerender(<ScriptStudioConversations items={items} activeId="conversation-1" onSelect={select} onCreate={create}/>);
 expect(screen.getByRole('button',{name:'对话 2'}).getAttribute('aria-pressed')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'对话 1'}));expect(select).toHaveBeenCalledWith(null);
});
it('scrolls the overflowing row with a vertical wheel but releases scrolling at its boundary',()=>{
 render(<ScriptStudioConversations items={items} activeId={null} onSelect={()=>{}} onCreate={()=>{}}/>);
 const row=screen.getByRole('group',{name:'拍法对话'});Object.defineProperties(row,{scrollWidth:{value:300},clientWidth:{value:130}});
 const wheel=new WheelEvent('wheel',{deltaY:50,bubbles:true,cancelable:true});row.dispatchEvent(wheel);expect(wheel.defaultPrevented).toBe(true);expect(row.scrollLeft).toBe(50);
 row.scrollLeft=170;const edge=new WheelEvent('wheel',{deltaY:50,bubbles:true,cancelable:true});row.dispatchEvent(edge);expect(edge.defaultPrevented).toBe(false);
});
it('does not capture ordinary page scrolling when the buttons fit',()=>{
 render(<ScriptStudioConversations items={items.slice(0,1)} activeId={null} onSelect={()=>{}} onCreate={()=>{}}/>);
 const row=screen.getByRole('group',{name:'拍法对话'}),wheel=new WheelEvent('wheel',{deltaY:50,bubbles:true,cancelable:true});row.dispatchEvent(wheel);expect(wheel.defaultPrevented).toBe(false);
});
it('supports keyboard focus movement and prevents changes while disabled',()=>{
 const select=vi.fn(),create=vi.fn(),r=render(<ScriptStudioConversations items={items} activeId={null} onSelect={select} onCreate={create}/>);
 const first=screen.getByRole('button',{name:'对话 1'});first.focus();fireEvent.keyDown(first,{key:'ArrowRight'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'对话 2'}));
 fireEvent.keyDown(document.activeElement!,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'新开对话'}));expect(select).not.toHaveBeenCalled();
 r.rerender(<ScriptStudioConversations items={items} activeId={null} onSelect={select} onCreate={create} disabled/>);expect(screen.getAllByRole('button').every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
});
