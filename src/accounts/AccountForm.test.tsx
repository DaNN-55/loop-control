import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {AccountForm} from './AccountForm';
afterEach(cleanup);
it('keeps unsupported account identifiers visible and explains the required format',async()=>{
 const submit=vi.fn(),user=userEvent.setup();render(<AccountForm isPending={false} onClose={()=>{}} onSubmit={submit}/>);
 await user.type(screen.getByLabelText('账号标识'),'内容 Studio!');
 expect(screen.getByLabelText('账号标识')).toHaveProperty('value','内容 Studio!');
 expect(screen.getByRole('alert').textContent).toContain('小写英文、数字和连字符');
 fireEvent.submit(screen.getByRole('form',{name:'新建账号'}));expect(submit).not.toHaveBeenCalled();
});
it('shows submission failure inside the account form and keeps entered values for retry',async()=>{
 const user=userEvent.setup();render(<AccountForm isPending={false} onClose={()=>{}} onSubmit={async()=>{throw new Error('账号标识已存在');}}/>);
 await user.type(screen.getByLabelText('账号名称'),'内容工作室');await user.type(screen.getByLabelText('账号标识'),'content-studio');await user.click(screen.getByRole('button',{name:'创建账号'}));
 expect((await screen.findByRole('alert')).textContent).toBe('账号标识已存在');expect(screen.getByLabelText('账号名称')).toHaveProperty('value','内容工作室');
});
