import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionWorkspace,type ExternalConnection} from './ConnectionWorkspace';
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();});
const connection={id:'c',name:'图片连接',provider:'openai',adapter:'openai_images',current_version_id:'v',description:'原说明',status:'verified'} as ExternalConnection;
const actions={onCreateConnection:async()=>null,onTestConnection:async()=>({ready:false})};
it('protects a changed connection on Escape and keeps only non-secret input when reopened',async()=>{
 const user=userEvent.setup();render(<ConnectionWorkspace connections={[connection]} {...actions}/>);
 await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));
 fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'未保存名称'}});fireEvent.change(screen.getByLabelText(/^新的 API Key/),{target:{value:'synthetic-secret-draft'}});
 await user.keyboard('{Escape}');const guard=screen.getByRole('dialog',{name:'关闭前处理修改'});expect(guard).toBeTruthy();
 await user.click(within(guard).getByRole('button',{name:'关闭确认，继续编辑'}));expect((screen.getByLabelText(/^新的 API Key/) as HTMLInputElement).value).toBe('synthetic-secret-draft');
 await user.click(screen.getByRole('button',{name:'关闭连接窗口'}));await user.click(screen.getByRole('button',{name:'保留修改并关闭'}));
 await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));
 expect((screen.getByLabelText(/^连接名称/) as HTMLInputElement).value).toBe('未保存名称');expect((screen.getByLabelText(/^新的 API Key/) as HTMLInputElement).value).toBe('');
 expect(JSON.stringify({...localStorage,...sessionStorage})+location.href+JSON.stringify(history.state)).not.toContain('synthetic-secret-draft');
 await user.click(screen.getByRole('button',{name:'取消'}));await user.click(screen.getByRole('button',{name:'放弃修改并关闭'}));
 await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));expect((screen.getByLabelText(/^连接名称/) as HTMLInputElement).value).toBe('图片连接');
});
it('closes unchanged input without a prompt and keeps failed or unknown saves editable',async()=>{
 const user=userEvent.setup();render(<ConnectionWorkspace connections={[connection]} {...actions} onUpdateConnection={async()=>{throw Error('服务器冲突，请重新读取');}} onRotateConnection={async()=>null}/>);
 await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));await user.click(screen.getByRole('button',{name:'取消'}));expect(screen.queryByRole('dialog')).toBeNull();
 await user.click(screen.getByRole('button',{name:'图片连接 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'编辑连接'}));
 fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'冲突名称'}});await user.click(screen.getByRole('button',{name:'保存并测试'}));expect(await screen.findByText('服务器冲突，请重新读取')).toBeTruthy();expect(screen.getByRole('dialog',{name:'编辑连接'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'图片连接'}});fireEvent.change(screen.getByLabelText(/^新的 API Key/),{target:{value:'synthetic-unknown'}});await user.click(screen.getByRole('button',{name:'保存并测试'}));expect(await screen.findByText('连接保存未确认完成，请检查提示后重试。')).toBeTruthy();expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('synthetic-unknown');
});
it('does not revive discarded new connection names or secrets when reopened',async()=>{
 const user=userEvent.setup();render(<ConnectionWorkspace connections={[]} {...actions}/>);
 await user.click(screen.getByRole('button',{name:'新建连接'}));fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'新名称'}});fireEvent.change(screen.getByLabelText(/^Pexels API Key/),{target:{value:'synthetic-new'}});
 await user.click(screen.getByRole('button',{name:'取消'}));await user.click(screen.getByRole('button',{name:'放弃修改并关闭'}));await user.click(screen.getByRole('button',{name:'新建连接'}));expect((screen.getByLabelText(/^连接名称/)as HTMLInputElement).value).toBe('');expect((screen.getByLabelText(/^Pexels API Key/)as HTMLInputElement).value).toBe('');
});
it('names the exact revoked version and its recorded references and retains confirmation after a failed revoke',async()=>{
 let reject!:(cause:Error)=>void;const user=userEvent.setup(),revoke=vi.fn().mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;})).mockResolvedValue(undefined);const version={id:'old-v',connection_id:'c',version:2,provider:'openai',adapter:'openai_images',endpoint:'',created_at:'',is_current:false,status:'verified' as const,revoked_at:null,usage:{currentBlueprints:1,episodes:2,tasks:3,activeTasks:1,requests:2,savedSelections:0}};
 render(<ConnectionWorkspace connections={[connection]} versions={[version]} {...actions} onRevokeVersion={revoke}/>);
 await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByText('连接版本（1）'));await user.click(screen.getByRole('button',{name:'撤销版本'}));
 const confirmation=screen.getByRole('dialog',{name:'撤销连接版本'});expect(confirmation.textContent).toContain('图片连接 · v2');expect(confirmation.textContent).toContain('生产单 2');expect(confirmation.textContent).toContain('任务 3');expect(confirmation.textContent).toContain('待执行或执行中 1');expect(revoke).not.toHaveBeenCalled();
 await user.click(within(confirmation).getByRole('button',{name:'确认撤销 v2'}));act(()=>{document.body.tabIndex=-1;document.body.focus();});await act(async()=>reject(Error('会话已失效')));expect(document.activeElement).toBe(confirmation);document.body.removeAttribute('tabindex');expect(await screen.findByText('会话已失效')).toBeTruthy();expect(screen.getByRole('dialog',{name:'撤销连接版本'})).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'确认撤销 v2'}));expect(revoke).toHaveBeenLastCalledWith('old-v');expect(screen.queryByRole('dialog',{name:'撤销连接版本'})).toBeNull();
});
it('does not apply a retained connection draft to a changed server baseline',async()=>{
 const user=userEvent.setup(),view=render(<ConnectionWorkspace connections={[connection]} {...actions}/>);
 await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'较早的未保存名称'}});
 view.rerender(<ConnectionWorkspace connections={[{...connection,name:'服务器新名称',current_version_id:'new-v'}]} {...actions}/>);
 await user.click(screen.getByRole('button',{name:'取消'}));await user.click(screen.getByRole('button',{name:'保留修改并关闭'}));
 await user.click(screen.getByRole('button',{name:'服务器新名称 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'编辑连接'}));expect((screen.getByLabelText(/^连接名称/)as HTMLInputElement).value).toBe('服务器新名称');expect(screen.getByText('保留的修改所依据的连接已变化，已读取当前资料。')).toBeTruthy();
});
it('does not revive a kept connection draft after the user changes it back to the server values',async()=>{
 const user=userEvent.setup();render(<ConnectionWorkspace connections={[connection]} {...actions}/>);await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'暂存名称'}});await user.click(screen.getByRole('button',{name:'取消'}));await user.click(screen.getByRole('button',{name:'保留修改并关闭'}));await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'图片连接'}});await user.click(screen.getByRole('button',{name:'取消'}));expect(screen.queryByRole('dialog')).toBeNull();await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));expect((screen.getByLabelText(/^连接名称/)as HTMLInputElement).value).toBe('图片连接');
});

it('returns focus to the connection editor after a rejected save so Escape remains available',async()=>{
 const user=userEvent.setup();let reject!:(cause:Error)=>void;render(<ConnectionWorkspace connections={[connection]} {...actions} onUpdateConnection={()=>new Promise<void>((_resolve,fail)=>{reject=fail;})}/>);await user.click(screen.getByRole('button',{name:'图片连接'}));await user.click(screen.getByRole('button',{name:'编辑连接'}));fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'焦点验证'}});await user.click(screen.getByRole('button',{name:'保存并测试'}));act(()=>{document.body.tabIndex=-1;document.body.focus();});await act(async()=>reject(Error('保存冲突')));await screen.findByText('保存冲突');expect(document.activeElement).toBe(screen.getByRole('dialog',{name:'编辑连接'}));await user.keyboard('{Escape}');expect(screen.getByRole('dialog',{name:'关闭前处理修改'})).toBeTruthy();document.body.removeAttribute('tabindex');
});
