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
 expect(save).toHaveBeenLastCalledWith({...base.preferences,avatar,notifications:{review:false,failure:true,delivery:true}});
 await user.click(screen.getByRole('button',{name:'恢复默认'}));expect(save).toHaveBeenCalledTimes(1);expect((screen.getByRole('switch',{name:'需要人工确认时通知'}) as HTMLInputElement).checked).toBe(true);
 expect(screen.getByText('同时用于应用内通知和 macOS 桌面提醒。')).toBeTruthy();
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
