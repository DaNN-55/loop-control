import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PasswordForm} from './WorkspaceViews';
afterEach(cleanup);
it('shows the password rule and local identity uses before typing, associates errors and focuses the invalid field',async()=>{
 const save=vi.fn(async()=>{});render(<PasswordForm isPending={false} onClose={()=>{}} onSubmit={save}/>);
 const password=screen.getByLabelText('新密码'),confirmation=screen.getByLabelText('确认密码');
 const rule=screen.getByText('至少 12 位，最多 1024 位。');expect(password.getAttribute('aria-describedby')?.split(' ')).toContain(rule.id);
 expect(screen.getByText(/本机身份验证.*登录.*查看和复制密钥/)).toBeTruthy();
 fireEvent.change(password,{target:{value:'short'}});fireEvent.submit(screen.getByRole('form',{name:'登录与安全'}));
 let error=await screen.findByRole('alert');expect(error.textContent).toContain('至少 12 位');expect(password.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);expect(password.getAttribute('aria-invalid')).toBe('true');expect(document.activeElement).toBe(password);expect(save).not.toHaveBeenCalled();
 fireEvent.change(password,{target:{value:'synthetic-new-password'}});fireEvent.change(confirmation,{target:{value:'different-password'}});fireEvent.submit(screen.getByRole('form',{name:'登录与安全'}));
 error=await screen.findByRole('alert');expect(error.textContent).toContain('不一致');expect(confirmation.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);expect(document.activeElement).toBe(confirmation);expect(password.getAttribute('aria-invalid')).not.toBe('true');
});
it('retains synthetic input on a rejected save, prevents duplicate submit and clears the error after a successful retry',async()=>{
 let reject!:(error:Error)=>void;const pending=new Promise<void>((_,fail)=>{reject=fail;});const save=vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined),close=vi.fn();
 render(<PasswordForm isPending={false} onClose={close} onSubmit={save}/>);
 fireEvent.change(screen.getByLabelText('新密码'),{target:{value:'synthetic-new-password'}});fireEvent.change(screen.getByLabelText('确认密码'),{target:{value:'synthetic-new-password'}});
 fireEvent.submit(screen.getByRole('form',{name:'登录与安全'}));fireEvent.submit(screen.getByRole('form',{name:'登录与安全'}));expect(save).toHaveBeenCalledTimes(1);
 fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();await act(async()=>reject(Error('密码保存失败，请重试。')));
 const error=await screen.findByRole('alert');expect(error.textContent).toBe('密码保存失败，请重试。');expect(screen.getByRole('form',{name:'登录与安全'}).getAttribute('aria-describedby')).toBe(error.id);
 expect((screen.getByLabelText('新密码') as HTMLInputElement).value).toBe('synthetic-new-password');await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'登录与安全'}));});
 await vi.waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(screen.queryByRole('alert')).toBeNull();
});
