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
it('opens without mutating, preserves legacy recovery and saves an explicit versioned quota',async()=>{
 reads();vi.mocked(localCommand).mockResolvedValue({});render(<RecycleBinDialog {...props}/>);
 await screen.findByText(item.title);expect(localCommand).not.toHaveBeenCalled();expect(screen.getByText('文件恢复与清理')).toBeTruthy();
 fireEvent.change(screen.getByRole('spinbutton',{name:'容量上限'}),{target:{value:'4'}});expect(screen.getByRole('button',{name:'恢复'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'永久删除 咖啡测试'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'保存上限'}));
 await waitFor(()=>expect(localCommand).toHaveBeenCalledWith('saveRecycleLimit',{limitBytes:4e9,expectedRevision:3},undefined,'recycle-bin'));
});
it('binds restore to membership revision and keeps a failed entry visible',async()=>{
 reads();vi.mocked(localCommand).mockRejectedValue(new Error('存储位置离线。'));render(<RecycleBinDialog {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'恢复'}));
 await screen.findByText('存储位置离线。');expect(screen.getByText(item.title)).toBeTruthy();expect(localCommand).toHaveBeenCalledWith('restoreRecycledEpisode',{episodeId:item.episodeId,revision:item.revision},undefined,'recycle-bin');
});
it('locks parent navigation while permanent confirmation is open and requires its current plan name',async()=>{
 reads();vi.mocked(localCommand).mockResolvedValue({confirmation:item.title,path:'/isolated/order',paths:['/isolated/order'],revision:'plan',files:[],preserved:[]});const state=vi.fn();render(<RecycleBinDialog {...props} onStateChange={state}/>);
 fireEvent.click(await screen.findByRole('button',{name:'永久删除 咖啡测试'}));await screen.findByRole('textbox',{name:'永久删除确认文本'});
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:true,dirty:false}));expect(screen.getByRole('button',{name:'确认永久删除'})).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByRole('textbox',{name:'永久删除确认文本'}),{target:{value:item.title}});fireEvent.click(screen.getByRole('button',{name:'确认永久删除'}));
 await waitFor(()=>expect(localCommand).toHaveBeenCalledWith('purgeRecycledEpisode',{episodeId:item.episodeId,revision:item.revision,confirmation:item.title,expectedPath:'/isolated/order',expectedPaths:['/isolated/order'],expectedRevision:'plan'},undefined,'recycle-bin'));
});

it('retains an unsaved quota draft when the catalog revision refreshes',async()=>{
 reads();const view=render(<RecycleBinDialog {...props}/>);await screen.findByText(item.title);fireEvent.change(screen.getByRole('spinbutton',{name:'容量上限'}),{target:{value:'4'}});view.rerender(<RecycleBinDialog {...props} revision={2}/>);await waitFor(()=>expect(localRequest).toHaveBeenCalledTimes(4));expect(screen.getByRole('spinbutton',{name:'容量上限'})).toHaveProperty('value','4');
});

it('dismisses cleanup help with Escape while retaining the parent settings and keyboard focus',async()=>{
 reads();const onClose=vi.fn(),ref={current:null};
 render(<OwnerSettingsDialog page="cleanup" onNavigate={()=>{}} onClose={onClose} returnFocusRef={ref} canManageSecrets busy={false} email="fixture@example.invalid"><RecycleBinDialog {...props}/></OwnerSettingsDialog>);
 await screen.findByText(item.title);const help=screen.getByRole('button',{name:'清理规则说明'});await act(async()=>help.focus());fireEvent.click(help);await screen.findByRole('tooltip');
 fireEvent.keyDown(help,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('tooltip')).toBeNull());expect(onClose).not.toHaveBeenCalled();expect(screen.getByRole('dialog',{name:'回收站'})).toBeTruthy();expect(document.activeElement).toBe(help);
});
