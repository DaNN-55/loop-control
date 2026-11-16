import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useConnectionActions} from './useConnectionActions';
import {localConnectionCommand} from './client';
vi.mock('./client',()=>({localConnectionCommand:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});

it('returns a committed connection and releases mutation pending while directory reading is still outstanding',async()=>{
 let finish!:()=>void;const refresh=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 vi.mocked(localConnectionCommand).mockResolvedValue({connection:{id:'saved'}});const {result}=renderHook(()=>useConnectionActions(refresh));let committed:unknown;
 act(()=>{void result.current.command('create',{name:'saved'}).then(value=>{committed=value;});});
 await waitFor(()=>expect(committed).toEqual({connection:{id:'saved'}}));expect(result.current.pending).toBe(false);expect(refresh).toHaveBeenCalledTimes(1);
 await act(async()=>finish());
});

it('does not let an older background refresh failure replace a newer mutation failure',async()=>{
 let fail!:(reason:Error)=>void;const refresh=vi.fn(()=>new Promise<void>((_resolve,reject)=>{fail=reject;}));
 vi.mocked(localConnectionCommand).mockResolvedValueOnce({saved:true}).mockRejectedValueOnce(Error('new write failed'));
 const {result}=renderHook(()=>useConnectionActions(refresh));let committed=false;
 act(()=>{void result.current.command('update',{id:'first'}).then(()=>{committed=true;});});await waitFor(()=>expect(committed).toBe(true));
 await act(async()=>{await expect(result.current.command('update',{id:'second'})).rejects.toThrow('new write failed');});
 await act(async()=>fail(Error('old directory read failed')));expect(result.current.error).toContain('new write failed');expect(result.current.error).not.toContain('目录刷新失败');
});

it('drops old Owner refresh failures and mutation pending after the access scope changes',async()=>{
 let fail!:(reason:Error)=>void;const refresh=vi.fn(()=>new Promise<void>((_resolve,reject)=>{fail=reject;}));vi.mocked(localConnectionCommand).mockResolvedValue({saved:true});
 const {result,rerender}=renderHook(({owner})=>useConnectionActions(refresh,owner),{initialProps:{owner:'first'}});let committed=false;
 act(()=>{void result.current.command('update',{id:'first'}).then(()=>{committed=true;});});await waitFor(()=>expect(committed).toBe(true));rerender({owner:'next'});
 await act(async()=>fail(Error('previous Owner read failed')));expect(result.current.error).toBe('');expect(result.current.pending).toBe(false);
});

it('keeps the replay warning alongside a separate directory-read failure',async()=>{
 vi.mocked(localConnectionCommand).mockResolvedValue({replayed:true});const {result}=renderHook(()=>useConnectionActions(async()=>{throw Error('offline');}));
 await act(async()=>{await result.current.command('rotate',{id:'saved'});});expect(result.current.error).toContain('未再次写入密钥');expect(result.current.error).toContain('目录刷新失败');expect(result.current.pending).toBe(false);
});
