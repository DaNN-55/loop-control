import {render,screen,fireEvent,cleanup,act} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceNoticeToast} from './WorkspaceNoticeToast';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('expires after five seconds and does not replay on ordinary rerenders',()=>{
 vi.useFakeTimers();const{rerender}=render(<WorkspaceNoticeToast noticeKey="e:s" message="脚本修改待确认"/>);expect(screen.getByRole('status')).toBeTruthy();act(()=>vi.advanceTimersByTime(4999));expect(screen.getByRole('status')).toBeTruthy();act(()=>vi.advanceTimersByTime(1));expect(screen.queryByRole('status')).toBeNull();rerender(<WorkspaceNoticeToast noticeKey="e:s" message="脚本修改待确认"/>);expect(screen.queryByRole('status')).toBeNull();rerender(<WorkspaceNoticeToast noticeKey="e:s2" message="脚本修改待确认"/>);expect(screen.getByRole('status')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'关闭提示'}));expect(screen.queryByRole('status')).toBeNull();
});
