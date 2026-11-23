import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {RecycleBinDialog} from './RecycleBinPanel';
import {OwnerSettingsDialog} from './OwnerSettingsDialog';
import {localRequest,localCommand} from './client';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const item={episodeId:'episode',revision:'revision',title:'咖啡测试',accountName:'测试账号',recycledAt:'2026-11-11T01:00:00Z',archivedBefore:false,sizeBytes:2000000,protection:''};
const summary={items:[item],limitBytes:5e9,settingsRevision:3,usedBytes:2000000,pendingBytes:0,overLimit:false};
const props={revision:1,onClose:vi.fn(),returnFocusRef:{current:null},embedded:true};
function reads(){vi.mocked(localRequest).mockImplementation(async path=>path==='recycle-bin'?summary:[]);}
it('opens without mutating and saves a valid versioned quota when editing finishes',async()=>{
 reads();vi.mocked(localCommand).mockImplementation(async()=>{
  const saved={limitBytes:6.1e9,settingsRevision:4};
  vi.mocked(localRequest).mockImplementation(async path=>path==='recycle-bin'?{...summary,...saved}:[]);
  return saved;
 });
 render(<RecycleBinDialog {...props}/>);
 await screen.findByText(item.title);expect(localCommand).not.toHaveBeenCalled();expect(screen.getByText('文件恢复与清理')).toBeTruthy();
 const limit=screen.getByRole('spinbutton',{name:/^容量上限/});
 fireEvent.change(limit,{target:{value:'6'}});
 fireEvent.change(limit,{target:{value:'6.1'}});
 expect(localCommand).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:'保存上限'})).toBeNull();
 expect(screen.getByRole('button',{name:'恢复'})).toHaveProperty('disabled',true);
 fireEvent.blur(limit);
 await screen.findByText('容量上限已保存。');
 expect(localCommand).toHaveBeenCalledExactlyOnceWith('saveRecycleLimit',{limitBytes:6.1e9,expectedRevision:3},undefined,'recycle-bin');
 expect(limit).toHaveProperty('value','6.1');
 expect(screen.getByRole('button',{name:'恢复'})).toHaveProperty('disabled',false);
 fireEvent.blur(limit);
 expect(localCommand).toHaveBeenCalledTimes(1);
});
it('keeps an invalid quota local and leaves the corrected draft available after a save failure',async()=>{
 reads();vi.mocked(localCommand).mockRejectedValue(new Error('存储位置离线。'));render(<RecycleBinDialog {...props}/>);
 const limit=await screen.findByRole('spinbutton',{name:/^容量上限/});
 fireEvent.change(limit,{target:{value:''}});
 fireEvent.blur(limit);
 expect(await screen.findByText('回收站上限须为 0.1 至 1000 GB。')).toBeTruthy();
 expect(localCommand).not.toHaveBeenCalled();
 fireEvent.change(limit,{target:{value:'6.15'}});
 fireEvent.blur(limit);
 expect(await screen.findByText('容量上限须以 0.1 GB 为单位。')).toBeTruthy();
 expect(localCommand).not.toHaveBeenCalled();
 fireEvent.change(limit,{target:{value:'6.2'}});
 fireEvent.keyDown(limit,{key:'Enter'});
 await screen.findByText('存储位置离线。');
 expect(limit).toHaveProperty('value','6.2');
 expect(localCommand).toHaveBeenCalledExactlyOnceWith('saveRecycleLimit',{limitBytes:6.2e9,expectedRevision:3},undefined,'recycle-bin');
});
it('binds restore to membership revision and keeps a failed entry visible',async()=>{
 reads();vi.mocked(localCommand).mockRejectedValue(new Error('存储位置离线。'));render(<RecycleBinDialog {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'恢复'}));
 await screen.findByText('存储位置离线。');expect(screen.getByText(item.title)).toBeTruthy();expect(localCommand).toHaveBeenCalledWith('restoreRecycledEpisode',{episodeId:item.episodeId,revision:item.revision},undefined,'recycle-bin');
});
it('acknowledges a committed restore without holding parent navigation for its background list read',async()=>{
 let rejectRead!:(reason:Error)=>void,reads=0;
 vi.mocked(localRequest).mockImplementation(path=>path==='recycle-bin'?(++reads===1?Promise.resolve(summary):new Promise((_resolve,reject)=>{rejectRead=reject;})):Promise.resolve([]));
 vi.mocked(localCommand).mockResolvedValue({});const state=vi.fn(),changed=vi.fn();render(<RecycleBinDialog {...props} onStateChange={state} onChanged={changed}/>);
 fireEvent.click(await screen.findByRole('button',{name:'恢复'}));await screen.findByText('生产单已恢复到原账号与系列。');
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false});expect(screen.getByRole('button',{name:'关闭回收站'})).not.toHaveProperty('disabled',true);
 // Revision-dependent operations still wait for the authoritative list.
 expect(screen.getByRole('button',{name:'恢复'})).toHaveProperty('disabled',true);
 await act(async()=>rejectRead(Error('read unavailable')));expect((await screen.findByRole('alert')).textContent).toContain('操作已保存');
});
it('locks parent navigation while permanent confirmation is open and requires its current plan name',async()=>{
 reads();vi.mocked(localCommand).mockResolvedValue({confirmation:item.title,path:'/isolated/order',paths:['/isolated/order'],revision:'plan',files:[],preserved:[]});const state=vi.fn();render(<RecycleBinDialog {...props} onStateChange={state}/>);
 fireEvent.click(await screen.findByRole('button',{name:'永久删除 咖啡测试'}));await screen.findByRole('textbox',{name:'永久删除确认文本'});
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:true,dirty:false}));expect(screen.getByRole('button',{name:'确认永久删除'})).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByRole('textbox',{name:'永久删除确认文本'}),{target:{value:item.title}});fireEvent.click(screen.getByRole('button',{name:'确认永久删除'}));
 await waitFor(()=>expect(localCommand).toHaveBeenCalledWith('purgeRecycledEpisode',{episodeId:item.episodeId,revision:item.revision,confirmation:item.title,expectedPath:'/isolated/order',expectedPaths:['/isolated/order'],expectedRevision:'plan'},undefined,'recycle-bin'));
});

it('retains an unsaved quota draft when the catalog revision refreshes',async()=>{
 reads();const view=render(<RecycleBinDialog {...props}/>);await screen.findByText(item.title);fireEvent.change(screen.getByRole('spinbutton',{name:/^容量上限/}),{target:{value:'4'}});view.rerender(<RecycleBinDialog {...props} revision={2}/>);await waitFor(()=>expect(localRequest).toHaveBeenCalledTimes(4));expect(screen.getByRole('spinbutton',{name:/^容量上限/})).toHaveProperty('value','4');
});

it('dismisses cleanup help with Escape while retaining the parent settings and keyboard focus',async()=>{
 reads();const onClose=vi.fn(),ref={current:null};
 render(<OwnerSettingsDialog page="cleanup" onNavigate={()=>{}} onClose={onClose} returnFocusRef={ref} canManageSecrets busy={false} email="fixture@example.invalid"><RecycleBinDialog {...props}/></OwnerSettingsDialog>);
 await screen.findByText(item.title);const help=screen.getByRole('button',{name:'清理规则说明'});await act(async()=>help.focus());fireEvent.click(help);await screen.findByRole('tooltip');
 fireEvent.keyDown(help,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('tooltip')).toBeNull());expect(onClose).not.toHaveBeenCalled();expect(screen.getByRole('dialog',{name:'回收站'})).toBeTruthy();expect(document.activeElement).toBe(help);
});
