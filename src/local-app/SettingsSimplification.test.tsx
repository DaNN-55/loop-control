import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {OwnerSettingsDialog} from './OwnerSettingsDialog';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {MediaRootSettingsDialog} from './MediaRootSettingsDialog';
import {LocalSystemStatus} from './LocalSystemStatus';
import {defaultOwnerPreferences} from '../preferences/preferences';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>request(path,init)}));
afterEach(()=>{cleanup();request.mockReset();});
it('shows five primary settings groups with permission-gated maintenance children',()=>{
 const navigate=vi.fn();render(<OwnerSettingsDialog page="system" onNavigate={navigate} onClose={vi.fn()} returnFocusRef={{current:null}} canManageSecrets={false} busy={false} email="owner@test.invalid"><header><h2>系统状态</h2></header></OwnerSettingsDialog>);
 expect(document.querySelectorAll('.owner-settings-pages>button')).toHaveLength(5);
 expect(Array.from(document.querySelectorAll('.owner-settings-pages>button')).map(node=>node.textContent)).toEqual(['制作服务','文件存储','界面与通知','登录与安全','维护工具']);
 expect(screen.queryByRole('button',{name:'回收站'})).toBeNull();expect(screen.queryByRole('button',{name:'高级密钥'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'日志'}));expect(navigate).toHaveBeenCalledWith('logs');
});
it('saves interface and notification edits together while retaining historical identity and event choices',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true),preferences={...defaultOwnerPreferences,displayName:'旧名称',avatar:'historical-avatar',notifications:{...defaultOwnerPreferences.notifications,review:false}};
 render(<OwnerPreferencesDialog page="personal" preferences={preferences} loading={false} saving={false} unavailable={false} error="" onReload={vi.fn()} onSave={save} onClose={vi.fn()} embedded csrf="test"/>);
 expect(screen.queryByRole('textbox',{name:'显示名称'})).toBeNull();expect(screen.queryByLabelText('上传头像图片')).toBeNull();expect(screen.getByText('自定义提醒').closest('details')).toHaveProperty('open',false);expect(request).not.toHaveBeenCalled();
 await user.selectOptions(screen.getByRole('combobox',{name:'外观'}),'system');await user.click(screen.getByRole('switch',{name:'macOS 桌面提醒'}));await user.click(screen.getByRole('button',{name:'保存偏好'}));
 expect(save).toHaveBeenCalledWith({...preferences,appearance:'system',notifications:{...preferences.notifications,macOS:false}});
});
it('keeps the media path read-only until changing location',async()=>{
 request.mockResolvedValue({path:'/test/media',canInitialize:false,status:'ready',migration:null});render(<MediaRootSettingsDialog csrf="test" onClose={vi.fn()} embedded/>);
 await screen.findByText('/test/media');expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('button',{name:'检查迁移计划'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'更换存储位置'}));expect(screen.getByRole('textbox',{name:'素材保存目录'})).toHaveProperty('value','/test/media');
});
it('uses a navigation trigger and embeds full runtime content without an extra dialog',async()=>{
 request.mockResolvedValue({observedAt:'2026-11-19T01:00:00Z',automation:{stopped:false,lastError:null,lastScanAt:null},plans:[],jobs:[],operations:{}});
 const open=vi.fn(),app=render(<LocalSystemStatus onOpenSettings={open}/>);await waitFor(()=>expect(request).toHaveBeenCalled());fireEvent.click(screen.getByRole('button',{name:/系统状态：/}));expect(open).toHaveBeenCalledOnce();expect(screen.queryByRole('dialog')).toBeNull();
 app.rerender(<LocalSystemStatus embedded/>);await waitFor(()=>expect(screen.getByRole('button',{name:'刷新系统状态'})).toHaveProperty('disabled',false));expect(screen.getByRole('heading',{name:'任务队列'})).toBeTruthy();expect(screen.getByRole('heading',{name:'运行版本'})).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();expect(document.querySelector('.status-drawer-layer')).toBeNull();
});

it('plans a move for an initialized but empty workspace instead of initializing it again',async()=>{
 request.mockImplementation(async(_path:string,init?:RequestInit)=>{if(init?.method==='POST')throw Error('盘点请求已收到');return{path:'/test/media',initialized:true,canInitialize:true,status:'ready',migration:null};});
 render(<MediaRootSettingsDialog csrf="test" onClose={vi.fn()} embedded/>);
 await screen.findByText('/test/media');expect(screen.queryByRole('textbox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'更换存储位置'}));
 fireEvent.change(screen.getByRole('textbox',{name:'素材保存目录'}),{target:{value:'/test/new-media'}});
 fireEvent.click(screen.getByRole('button',{name:'检查迁移计划'}));await screen.findByText('盘点请求已收到');
 expect(JSON.parse(request.mock.calls.at(-1)![1].body)).toMatchObject({command:'planMigration',path:'/test/new-media'});
});
