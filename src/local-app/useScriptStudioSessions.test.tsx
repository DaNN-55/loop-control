import {renderHook,waitFor,act,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const {request,command}=vi.hoisted(()=>({request:vi.fn(),command:vi.fn()}));
vi.mock('./client',()=>({localRequest:request,localCommand:command}));
import {WorkspaceDraftOwner} from './WorkspaceDraft';
import {useScriptStudioSessions} from './useScriptStudioSessions';
function wrapper({children}:{children:ReactNode}){return <WorkspaceDraftOwner ownerId="owner">{children}</WorkspaceDraftOwner>;}
const props={episodeId:'episode',scriptRevisionId:null,source:'原文。',targetDuration:15,disabled:false};
const first={id:null,number:1,createdAt:'2026-11-18T10:00:00Z'},second={id:'second',number:2,createdAt:'2026-11-18T10:01:00Z'};
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();});
it('waits for metadata and remembers the selected empty conversation through remount without model calls',async()=>{
 request.mockResolvedValue({conversations:[first,second]});const a=renderHook(()=>useScriptStudioSessions(props),{wrapper});expect(a.result.current.loading).toBe(true);
 await waitFor(()=>expect(a.result.current.loading).toBe(false));expect(a.result.current.activeId).toBe('second');
 act(()=>a.result.current.select(null));expect(a.result.current.activeId).toBeNull();a.unmount();
 const b=renderHook(()=>useScriptStudioSessions(props),{wrapper});await waitFor(()=>expect(b.result.current.loading).toBe(false));expect(b.result.current.activeId).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('creates and selects a durable empty conversation once despite rapid repeated activation',async()=>{
 request.mockResolvedValue({conversations:[first]});let done!:(value:unknown)=>void;command.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));
 const h=renderHook(()=>useScriptStudioSessions(props),{wrapper});await waitFor(()=>expect(h.result.current.loading).toBe(false));
 let a:Promise<unknown>;await act(async()=>{a=h.result.current.create();void h.result.current.create();});expect(command).toHaveBeenCalledTimes(1);expect(h.result.current.activeId).toBeNull();
 await act(async()=>{done(second);await a;});expect(h.result.current.activeId).toBe('second');expect(h.result.current.items).toEqual([first,second]);
});
it('ignores late metadata from another source and does not read metadata for blank scripts',async()=>{
 let done!:(value:unknown)=>void;request.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));
 const h=renderHook(p=>useScriptStudioSessions(p),{wrapper,initialProps:props});await waitFor(()=>expect(done).toBeTypeOf('function'));
 h.rerender({...props,source:''});await act(async()=>done({conversations:[first,second]}));expect(h.result.current.items).toEqual([]);expect(h.result.current.loading).toBe(false);
});
it('keeps the selected conversation and list when a same-scope upload temporarily disables editing',async()=>{
 request.mockResolvedValue({conversations:[first,second]});const h=renderHook(p=>useScriptStudioSessions(p),{wrapper,initialProps:props});await waitFor(()=>expect(h.result.current.loading).toBe(false));
 expect(h.result.current.activeId).toBe('second');h.rerender({...props,disabled:true});expect(h.result.current.activeId).toBe('second');expect(h.result.current.items).toEqual([first,second]);
 h.rerender(props);expect(h.result.current.activeId).toBe('second');expect(h.result.current.items).toEqual([first,second]);expect(h.result.current.loading).toBe(false);expect(command).not.toHaveBeenCalled();
});
