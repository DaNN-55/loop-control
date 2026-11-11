import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {defaultOwnerPreferences} from '../preferences/preferences';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>request(path,init)}));
afterEach(()=>{cleanup();request.mockReset();});
const root={path:'/test/media',canInitialize:false,status:'ready',migration:null};
const logs={activeDirectory:'/test/logs',configuredDirectory:'/test/logs',defaultDirectory:'/test/logs',pending:false,warning:null};
const props={preferences:{...defaultOwnerPreferences,displayName:'Owner'},page:'personal' as const,loading:false,saving:false,unavailable:false,error:'',csrf:'synthetic',embedded:true,onReload:vi.fn(),onClose:vi.fn(),onSave:vi.fn(async()=>true)};
function reads(){request.mockImplementation(async(path:string)=>path==='media-root'?root:logs);}

it('embeds one preference pane without adding a nested dialog and retains its draft across storage tabs',async()=>{
 reads();const user=userEvent.setup(),state=vi.fn();render(<section role="dialog" aria-label="所有者设置"><OwnerPreferencesDialog {...props} onStateChange={state}/></section>);
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
 expect(screen.getAllByRole('dialog')).toHaveLength(1);expect(document.querySelector('.owner-settings-pane')).toBeTruthy();
 expect(screen.getByText('/test/media').closest('[role=tabpanel]')).toHaveProperty('hidden',true);
 fireEvent.change(screen.getByRole('textbox',{name:'显示名称'}),{target:{value:'保留的名称草稿'}});
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 await user.click(screen.getByRole('tab',{name:'存储位置'}));
 expect(screen.getByText('/test/media')).toBeTruthy();expect(screen.queryByRole('button',{name:'保存偏好'})).toBeNull();
 expect(screen.queryByRole('textbox',{name:'显示名称'})).toBeNull();
 await user.click(screen.getByRole('tab',{name:'个人与界面'}));
 expect(screen.getByRole('textbox',{name:'显示名称'})).toHaveProperty('value','保留的名称草稿');
 expect(request).toHaveBeenCalledTimes(2);
});

it('reports ordinary storage reads as idle and protects an independently edited log directory while saving',async()=>{
 let finish!:(value:unknown)=>void;const state=vi.fn();
 request.mockImplementation(async(path:string,init?:RequestInit)=>{if(!init?.body)return path==='media-root'?root:logs;return new Promise(resolve=>{finish=resolve;});});
 const user=userEvent.setup();render(<OwnerPreferencesDialog {...props} onStateChange={state}/>);
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
 expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false});
 await user.click(screen.getByRole('tab',{name:'存储位置'}));
 fireEvent.change(screen.getByRole('textbox',{name:'日志保存目录'}),{target:{value:'/test/new-logs'}});
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 await user.click(screen.getByRole('button',{name:'保存日志位置'}));
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:true,dirty:true}));
 expect(screen.getByRole('tab',{name:'个人与界面'})).toHaveProperty('disabled',true);
 await act(async()=>finish({...logs,configuredDirectory:'/test/new-logs',pending:true}));
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false}));
 expect(screen.getByRole('tab',{name:'个人与界面'})).toHaveProperty('disabled',false);
 expect(props.onSave).not.toHaveBeenCalled();
});

it('keeps notifications separate from personal data while using the embedded section layout',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true),state=vi.fn();render(<OwnerPreferencesDialog {...props} page="notifications" onSave={save} onStateChange={state}/>);
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('heading',{name:'接收方式'})).toBeTruthy();expect(screen.getByRole('heading',{name:'提醒内容'})).toBeTruthy();
 await user.click(screen.getByRole('switch',{name:'macOS 桌面提醒'}));
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 await user.click(screen.getByRole('button',{name:'保存偏好'}));
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false}));
 expect(save).toHaveBeenCalledWith({...props.preferences,notifications:{...props.preferences.notifications,macOS:false}});
 expect(request).not.toHaveBeenCalled();
});

it('reports an edited production location without treating a directory read as a pending write',async()=>{
 reads();const user=userEvent.setup(),state=vi.fn();render(<OwnerPreferencesDialog {...props} onStateChange={state}/>);
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
 await user.click(screen.getByRole('tab',{name:'存储位置'}));await user.click(screen.getByRole('button',{name:'更换存储位置'}));
 fireEvent.change(screen.getByRole('textbox',{name:'新位置'}),{target:{value:'/test/new-media'}});
 await waitFor(()=>expect(state).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 expect(screen.getByRole('tab',{name:'个人与界面'})).toHaveProperty('disabled',false);
});

it('allows closing or changing tabs while a persisted media migration continues',async()=>{
 const manifest={sourceBinding:{path:root.path},targetBinding:{path:'/test/new-media'},accounts:[],episodes:[],fileCount:2,directoryCount:1,totalBytes:100,space:{freeBytes:1000,reserveBytes:0,requiredBytes:100},canExecute:true,conflicts:[],blockers:[]};
 let executing=false,finish!:(value:unknown)=>void;const state=vi.fn();
 request.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='log-storage')return logs;
  if(init?.body){executing=true;return new Promise(resolve=>{finish=resolve;});}
  return {...root,executing,migration:{id:'migration',status:executing?'copying':'planned',manifest,progress:{copiedFiles:1,copiedBytes:50}}};
 });
 const user=userEvent.setup();render(<OwnerPreferencesDialog {...props} onStateChange={state}/>);
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));await user.click(screen.getByRole('tab',{name:'存储位置'}));
 await user.click(screen.getByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'}));await user.click(screen.getByRole('button',{name:'开始迁移'}));
 await screen.findByRole('progressbar',{name:'文件复制进度'});
 expect(state).toHaveBeenLastCalledWith({busy:false,dirty:false});
 expect(screen.getByRole('button',{name:'关闭个人偏好'})).toHaveProperty('disabled',false);
 await user.click(screen.getByRole('tab',{name:'个人与界面'}));await user.click(screen.getByRole('tab',{name:'存储位置'}));
 expect(screen.getByRole('progressbar',{name:'文件复制进度'})).toBeTruthy();
 await act(async()=>finish({status:'copying'}));
});
