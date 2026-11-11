import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {OwnerSettingsDialog} from './OwnerSettingsDialog';
import {WorkspaceDraftProvider,useWorkspaceDraftLeave,useWorkspaceLeaveEntry} from './WorkspaceDraft';
afterEach(cleanup);
it('keeps permission-gated settings in one frame and disables navigation while writing',()=>{
 const navigate=vi.fn(),props={page:'personal' as const,onNavigate:navigate,onClose:vi.fn(),returnFocusRef:{current:null},canManageSecrets:false,busy:false,email:'owner@example.invalid'};
 const app=render(<OwnerSettingsDialog {...props}><header><h2>个人偏好</h2></header></OwnerSettingsDialog>);
 expect(screen.getAllByRole('dialog')).toHaveLength(1);expect(screen.queryByRole('button',{name:'密钥管理'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'通知'}));expect(navigate).toHaveBeenCalledWith('notifications');
 app.rerender(<OwnerSettingsDialog {...props} canManageSecrets busy><header><h2>个人偏好</h2></header></OwnerSettingsDialog>);expect(screen.getByRole('button',{name:'密钥管理'})).toHaveProperty('disabled',true);
});
it('scopes settings navigation to connection drafts without keeping or discarding a background script',()=>{
 const keepScript=vi.fn(()=>true),discardScript=vi.fn(),keepConnection=vi.fn(()=>true),go=vi.fn();
 function Fixture(){const leave=useWorkspaceDraftLeave('connections');useWorkspaceLeaveEntry({dirty:()=>true,keep:keepScript,discard:discardScript});useWorkspaceLeaveEntry({kind:'connection',dirty:()=>true,keep:keepConnection,discard:vi.fn()});return <button onClick={()=>leave(go)}>切换设置页</button>;}
 render(<WorkspaceDraftProvider><Fixture/></WorkspaceDraftProvider>);fireEvent.click(screen.getByRole('button',{name:'切换设置页'}));fireEvent.click(screen.getByRole('button',{name:'保留修改并离开'}));expect(keepConnection).toHaveBeenCalledOnce();expect(keepScript).not.toHaveBeenCalled();expect(discardScript).not.toHaveBeenCalled();expect(go).toHaveBeenCalledOnce();
});
