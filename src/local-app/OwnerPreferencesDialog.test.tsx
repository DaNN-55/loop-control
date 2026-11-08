import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {defaultOwnerPreferences} from '../preferences/preferences';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const base={preferences:{...defaultOwnerPreferences,displayName:'Dan'},page:'personal' as const,loading:false,saving:false,unavailable:false,error:'',onReload:vi.fn(),onClose:vi.fn()};
const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5f8AAAAASUVORK5CYII=';
it('opens a standalone personal page and saves only personal fields',async()=>{
 const save=vi.fn(async()=>true),user=userEvent.setup();render(<OwnerPreferencesDialog {...base} onSave={save}/>);
 expect(screen.getByRole('dialog',{name:'个人偏好'})).toBeTruthy();expect(screen.queryByRole('tablist')).toBeNull();expect(screen.queryByText('需要人工确认时通知')).toBeNull();
 await user.clear(screen.getByRole('textbox',{name:'显示名称'}));await user.type(screen.getByRole('textbox',{name:'显示名称'}),'新名称');
 await user.selectOptions(screen.getByRole('combobox',{name:'外观'}),'system');await user.click(screen.getByRole('switch',{name:'使用紧凑行距'}));
 await user.click(screen.getByRole('button',{name:'保存偏好'}));await screen.findByText('已保存');expect(save).toHaveBeenLastCalledWith({...base.preferences,displayName:'新名称',appearance:'system',compactRows:false});
});
it('opens notifications separately, preserving personal preferences when saving and restoring',async()=>{
 const save=vi.fn(async()=>true),user=userEvent.setup();render(<OwnerPreferencesDialog {...base} preferences={{...base.preferences,avatar}} page="notifications" onSave={save}/>);
 expect(screen.getByRole('dialog',{name:'通知'})).toBeTruthy();expect(screen.queryByRole('tablist')).toBeNull();expect(screen.queryByRole('textbox',{name:'显示名称'})).toBeNull();
 await user.click(screen.getByRole('switch',{name:'需要人工确认时通知'}));await user.click(screen.getByRole('button',{name:'保存偏好'}));
 expect(save).toHaveBeenLastCalledWith({...base.preferences,avatar,notifications:{...defaultOwnerPreferences.notifications,review:false}});
 await user.click(screen.getByRole('button',{name:'恢复默认'}));expect(save).toHaveBeenCalledTimes(1);expect((screen.getByRole('switch',{name:'需要人工确认时通知'}) as HTMLInputElement).checked).toBe(true);
 expect(screen.getByText('关闭提醒后，待处理事项和任务仍可查看。')).toBeTruthy();
});
it('retains the draft after a failed save and allows retry',async()=>{
 const save=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),user=userEvent.setup();render(<OwnerPreferencesDialog {...base} onSave={save}/>);
 await user.type(screen.getByRole('textbox',{name:'显示名称'}),' Retry');await user.click(screen.getByRole('button',{name:'保存偏好'}));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(screen.queryByText('已保存')).toBeNull();expect((screen.getByRole('textbox',{name:'显示名称'}) as HTMLInputElement).value).toBe('Dan Retry');
 await user.click(screen.getByRole('button',{name:'保存偏好'}));await screen.findByText('已保存');expect(save).toHaveBeenCalledTimes(2);
});
it('removes an avatar only when the personal preference is saved',async()=>{
 const save=vi.fn(async()=>true),user=userEvent.setup();render(<OwnerPreferencesDialog {...base} preferences={{...base.preferences,avatar}} onSave={save}/>);
 expect(screen.getByRole('img',{name:'头像预览'}).getAttribute('src')).toBe(avatar);await user.click(screen.getByRole('button',{name:'移除'}));
 expect(screen.queryByRole('img',{name:'头像预览'})).toBeNull();expect(save).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'保存偏好'}));expect(save).toHaveBeenCalledWith({...base.preferences,avatar:null});
});
it('shows upload errors without losing the existing avatar',async()=>{
 render(<OwnerPreferencesDialog {...base} preferences={{...base.preferences,avatar}} onSave={vi.fn(async()=>true)}/>);
 await userEvent.setup({applyAccept:false}).upload(screen.getByLabelText('上传头像图片'),new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}));
 expect((await screen.findByRole('alert')).textContent).toContain('PNG、JPEG 或 WebP');expect(screen.getByRole('img',{name:'头像预览'}).getAttribute('src')).toBe(avatar);
});
it('shows static language and distinguishes unchanged, draft, saving, saved and failed preferences',async()=>{
 const user=userEvent.setup();let finish:(saved:boolean)=>void=()=>{};
 const save=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
 const {rerender}=render(<OwnerPreferencesDialog {...base} onSave={save}/>);
 expect(screen.queryByRole('combobox',{name:'界面语言'})).toBeNull();expect(screen.getByText('简体中文')).toBeTruthy();
 expect(screen.getByRole('status').textContent).toBe('未修改');expect((screen.getByRole('button',{name:'保存偏好'}) as HTMLButtonElement).disabled).toBe(true);
 await user.type(screen.getByRole('textbox',{name:'显示名称'}),'修改');expect(screen.getByRole('status').textContent).toBe('有未保存修改');
 await user.click(screen.getByRole('button',{name:'保存偏好'}));expect(screen.getByRole('status').textContent).toBe('保存中…');finish(true);
 await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('已保存'));
 await user.click(screen.getByRole('button',{name:'恢复默认'}));expect(screen.getByRole('status').textContent).toBe('有未保存修改');
 await user.click(screen.getByRole('button',{name:'保存偏好'}));finish(false);await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('保存失败，修改尚未保存'));
 expect((screen.getByRole('textbox',{name:'显示名称'}) as HTMLInputElement).value).toBe('');
 rerender(<OwnerPreferencesDialog {...base} error="暂时无法保存" onSave={save}/>);expect(screen.getByRole('alert').textContent).toBe('暂时无法保存');
});
it('saves independent reminder channels and keeps channel edits until explicitly saved',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true);
 render(<OwnerPreferencesDialog {...base} page="notifications" onSave={save}/>);
 await user.click(screen.getByRole('switch',{name:'应用内提醒'}));expect(screen.getByRole('status').textContent).toBe('有未保存修改');expect(save).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'保存偏好'}));expect(save).toHaveBeenLastCalledWith({...base.preferences,notifications:{...base.preferences.notifications,inApp:false,macOS:true}});
 await user.click(screen.getByRole('switch',{name:'macOS 桌面提醒'}));await user.click(screen.getByRole('button',{name:'保存偏好'}));expect(save).toHaveBeenLastCalledWith({...base.preferences,notifications:{...base.preferences.notifications,inApp:false,macOS:false}});
});
it('compares notification values independently of JSON key order',async()=>{
 const user=userEvent.setup();render(<OwnerPreferencesDialog {...base} page="notifications" preferences={{...base.preferences,notifications:{macOS:true,inApp:true,delivery:true,failure:true,review:true}}} onSave={vi.fn(async()=>true)}/>);
 await user.click(screen.getByRole('button',{name:'恢复默认'}));expect(screen.getByRole('status').textContent).toBe('未修改');expect((screen.getByRole('button',{name:'保存偏好'}) as HTMLButtonElement).disabled).toBe(true);
});
