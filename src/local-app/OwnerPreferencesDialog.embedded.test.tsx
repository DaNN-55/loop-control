import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {MediaRootSettingsDialog} from './MediaRootSettingsDialog';
import {LogStorageSettings} from './LogStorageSettings';
import {defaultOwnerPreferences} from '../preferences/preferences';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>request(path,init)}));
afterEach(()=>{cleanup();request.mockReset();});
const root={path:'/test/media',canInitialize:false,status:'ready',migration:null};
const logs={activeDirectory:'/test/logs',configuredDirectory:'/test/logs',defaultDirectory:'/test/logs',pending:false,warning:null};
const props={preferences:{...defaultOwnerPreferences,displayName:'Owner'},page:'personal' as const,loading:false,saving:false,unavailable:false,error:'',csrf:'synthetic',embedded:true,onReload:vi.fn(),onClose:vi.fn(),onSave:vi.fn(async()=>true)};
it('embeds one combined preference pane and keeps drafts across legacy page aliases',async()=>{
 const user=userEvent.setup(),state=vi.fn();const app=render(<section role="dialog" aria-label="设置"><OwnerPreferencesDialog {...props} onStateChange={state}/></section>);
 expect(screen.getAllByRole('dialog')).toHaveLength(1);expect(document.querySelector('.owner-settings-pane')).toBeTruthy();expect(screen.queryByRole('tab')).toBeNull();expect(request).not.toHaveBeenCalled();
 await user.click(screen.getByRole('radio',{name:'深色'}));await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 app.rerender(<section role="dialog" aria-label="设置"><OwnerPreferencesDialog {...props} page="notifications" onStateChange={state}/></section>);
 expect(screen.getByRole('radio',{name:'深色'})).toHaveProperty('checked',true);expect(screen.getByRole('switch',{name:'应用内提醒'})).toBeTruthy();
});
it('reports ordinary log reads as idle and protects an independently edited log directory while saving',async()=>{
 let finish!:(value:unknown)=>void;const state=vi.fn();request.mockImplementation(async(_path:string,init?:RequestInit)=>init?.body?new Promise(resolve=>{finish=resolve;}):logs);
 const user=userEvent.setup();render(<LogStorageSettings csrf="synthetic" onStateChange={state}/>);await screen.findByRole('textbox',{name:'日志保存目录'});expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false});
 fireEvent.change(screen.getByRole('textbox',{name:'日志保存目录'}),{target:{value:'/test/new-logs'}});await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 await user.click(screen.getByRole('button',{name:'保存日志位置'}));await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:true,dirty:true}));
 await act(async()=>finish({...logs,configuredDirectory:'/test/new-logs',pending:true}));await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false}));expect(props.onSave).not.toHaveBeenCalled();
});
it('saves channels and interface together without resetting notification event choices',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true),state=vi.fn();render(<OwnerPreferencesDialog {...props} page="notifications" onSave={save} onStateChange={state}/>);
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('heading',{name:'接收方式'})).toBeTruthy();expect(screen.getByText('自定义提醒').closest('details')).toHaveProperty('open',false);
 await user.click(screen.getByRole('switch',{name:'macOS 桌面提醒'}));await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));await user.click(screen.getByRole('button',{name:'保存偏好'}));await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false}));
 expect(save).toHaveBeenCalledWith({...props.preferences,notifications:{...props.preferences.notifications,macOS:false}});expect(request).not.toHaveBeenCalled();
});
it('reports a changed production location without treating a directory read as a pending write',async()=>{
 request.mockResolvedValue(root);const state=vi.fn(),user=userEvent.setup();render(<MediaRootSettingsDialog csrf="synthetic" onClose={vi.fn()} embedded onStateChange={state}/>);
 await screen.findByText(root.path);expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false});await user.click(screen.getByRole('button',{name:'更换存储位置'}));fireEvent.change(screen.getByRole('textbox',{name:'素材保存目录'}),{target:{value:'/test/new-media'}});await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
});
it('allows leaving while a persisted media migration continues',async()=>{
 const manifest={sourceBinding:{path:root.path},targetBinding:{path:'/test/new-media'},accounts:[],episodes:[],fileCount:2,directoryCount:1,totalBytes:100,space:{freeBytes:1000,reserveBytes:0,requiredBytes:100},canExecute:true,conflicts:[],blockers:[]};let executing=false,finish!:(value:unknown)=>void;const state=vi.fn();
 request.mockImplementation(async(_path:string,init?:RequestInit)=>{if(init?.body){executing=true;return new Promise(resolve=>{finish=resolve;});}return {...root,executing,migration:{id:'migration',status:executing?'copying':'planned',manifest,progress:{copiedFiles:1,copiedBytes:50}}};});
 const user=userEvent.setup(),app=render(<MediaRootSettingsDialog csrf="synthetic" onClose={vi.fn()} embedded onStateChange={state}/>);await screen.findByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'});await user.click(screen.getByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'}));await user.click(screen.getByRole('button',{name:'开始迁移'}));await screen.findByRole('progressbar',{name:'文件复制进度'});expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false});app.unmount();await act(async()=>finish({status:'copying'}));
});
