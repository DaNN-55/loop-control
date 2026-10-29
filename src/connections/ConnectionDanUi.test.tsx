import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {ConnectionWorkspace, type ExternalConnection} from './ConnectionWorkspace';
afterEach(cleanup);
it('keeps one accessible name and a native required state in the on-demand editor', () => {
 render(<ConnectionWorkspace connections={[]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'新建连接'}));
 const name=screen.getByRole('textbox',{name:'连接名称'})as HTMLInputElement;expect(name.required).toBe(true);
 const type=screen.getByRole('combobox',{name:'连接类型'})as HTMLSelectElement;expect(type.labels?.[0]?.htmlFor).toBe(type.id);expect(type.labels?.[0]?.id).not.toBe(type.id);expect(type.required).toBe(false);
});
it('clears the credential draft and restores masking when opening another connection',async()=>{
 const user=userEvent.setup();const rows=['First','Second'].map(id=>({id,name:id,provider:'pexels',adapter:'pexels_video',status:'verified'}as ExternalConnection));
 render(<ConnectionWorkspace connections={rows} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 await user.click(screen.getByRole('button',{name:'First'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));
 await user.type(screen.getByLabelText(/^新的 API Key/),'synthetic-draft');await user.click(screen.getByRole('button',{name:'显示密码'}));expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).type).toBe('text');
 await user.click(screen.getByRole('button',{name:'关闭连接窗口'}));await user.click(screen.getByRole('button',{name:'Second'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));
 const secret=screen.getByLabelText(/^新的 API Key/)as HTMLInputElement;expect(secret.value).toBe('');expect(secret.type).toBe('password');
});
