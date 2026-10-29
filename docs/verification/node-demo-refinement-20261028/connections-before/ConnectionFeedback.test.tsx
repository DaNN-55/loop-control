import {act,fireEvent,render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionWorkspace,ExternalConnectionPicker,type ExternalConnection} from './ConnectionWorkspace';
afterEach(cleanup);
function edit(name:string){fireEvent.click(screen.getByRole('button',{name}));fireEvent.click(screen.getByRole('button',{name:'编辑连接'}));}
it('shows immediate testing feedback and prevents duplicate retry while the real callback is pending',async()=>{
 let complete!:()=>void;const waiting=new Promise<void>(resolve=>complete=resolve),test=vi.fn(()=>waiting);
 const connection={id:'connection-fixture',name:'Wan fixture',provider:'bailian',adapter:'wan_video',current_version_id:'version-fixture',status:'retryable',last_verification_detail:'真实Keychain及在线验证尚未启用。'} as ExternalConnection;
 render(<ExternalConnectionPicker adapter="wan_video" provider="bailian" connections={[connection]} selectedVersionId="version-fixture" versions={[{id:'version-fixture',connection_id:connection.id,provider:'bailian',adapter:'wan_video',is_current:true,version:2,status:'retryable',revoked_at:null,created_at:'',endpoint:'https://dashscope.aliyuncs.com'}]} onSelectVersion={()=>{}} onTestConnection={test}/>);
 fireEvent.click(screen.getByRole('button',{name:'重新测试'}));
 const button=screen.getByRole('button',{name:'测试中…'});expect((button as HTMLButtonElement).disabled).toBe(true);expect(button.getAttribute('data-pending')).toBe('true');expect(test).toHaveBeenCalledTimes(1);
 await act(async()=>complete());expect(screen.getByRole('button',{name:'重新测试'})).toBeTruthy();
});
it('retests the selected connection when several connections share a Provider',async()=>{
 const test=vi.fn().mockResolvedValue({ready:true,detail:'连接验证通过。'});
 const row=(id:string,name:string)=>({id,name,provider:'pexels',adapter:'pexels_video',current_version_id:id+'-version',status:'verified'}) as ExternalConnection;
 const rows=[row('first','Other connection'),row('chosen','Chosen connection')];
 const versions=rows.map(r=>({id:r.current_version_id!,connection_id:r.id,provider:'pexels',adapter:'pexels_video',is_current:true,version:1,status:'verified' as const,revoked_at:null,created_at:'',endpoint:'https://api.pexels.com'}));
 render(<ExternalConnectionPicker adapter="pexels_video" provider="pexels" connections={rows} selectedVersionId="chosen-version" versions={versions} onSelectVersion={()=>{}} onTestConnection={test}/>);
 fireEvent.click(screen.getByRole('button',{name:'重新测试'}));await screen.findByText('连接验证通过。');expect(test).toHaveBeenCalledWith('chosen');
});
it('shows feedback during automatic verification after a credential update and prevents duplicate rotation',async()=>{
 let complete!:(value:unknown)=>void;const waiting=new Promise(resolve=>complete=resolve),test=vi.fn(()=>waiting);
 const connection={id:'updated',name:'Selected Wan',provider:'bailian',adapter:'wan_video',status:'unverified'} as ExternalConnection;
 const rotate=vi.fn().mockResolvedValue({...connection,current_version_id:'updated-v2'});
 render(<ExternalConnectionPicker adapter="wan_video" provider="bailian" connections={[connection]} selectedVersionId="" onSelectVersion={()=>{}} onRotateConnection={rotate} onTestConnection={test}/>);
 fireEvent.click(screen.getByRole('button',{name:'更新连接'}));fireEvent.change(screen.getByLabelText('编辑连接 API Key'),{target:{value:'synthetic-test-only'}});const save=screen.getByRole('button',{name:'保存连接更新'});fireEvent.click(save);fireEvent.click(save);
 await screen.findAllByRole('button',{name:'测试中…'});expect(rotate).toHaveBeenCalledTimes(1);expect(test).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('编辑连接 API Key') as HTMLInputElement).value==='').toBe(true);
 await act(async()=>complete({ready:true,detail:'连接验证通过。'}));await screen.findByText('连接验证通过。');expect(screen.queryByLabelText('编辑连接 API Key')).toBeNull();
});
it('does not choose among multiple verified connections or replace an explicit unavailable reference',()=>{
 const select=vi.fn();const rows=['one','two'].map(id=>({id,name:id,provider:'pexels',adapter:'pexels_video',current_version_id:id+'-v',status:'verified'}as ExternalConnection));
 const versions=rows.map(row=>({id:row.current_version_id!,connection_id:row.id,provider:'pexels',adapter:'pexels_video',is_current:true,version:1,status:'verified'as const,revoked_at:null,created_at:'',endpoint:'https://api.pexels.com'}));
 const view=render(<ExternalConnectionPicker provider="pexels" adapter="pexels_video" connections={rows} versions={versions} selectedVersionId="" onSelectVersion={select}/>);
 expect(select).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('外部连接 使用已保存连接'),{target:{value:'two-v'}});expect(select).toHaveBeenCalledWith('two-v');select.mockClear();
 view.rerender(<ExternalConnectionPicker provider="pexels" adapter="pexels_video" connections={rows} versions={versions} selectedVersionId="missing-v" onSelectVersion={select}/>);expect(select).not.toHaveBeenCalled();expect(screen.getByText('原连接当前不可用，请显式选择可用版本。')).toBeTruthy();
});
it('reports an unconfirmed create beside the submit action and retains the credential draft',async()=>{
 const create=vi.fn().mockResolvedValue(null);
 render(<ConnectionWorkspace connections={[]} onCreateConnection={create} onTestConnection={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'新建连接'}));
 fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'Seedance'}});
 fireEvent.change(screen.getByLabelText(/^Pexels API Key/),{target:{value:'synthetic-draft'}});
 fireEvent.click(screen.getByRole('button',{name:'保存并测试'}));
 const alert=await screen.findByRole('alert');expect(alert.closest('form')).toBeTruthy();expect(alert.textContent).toContain('未确认完成');
 expect((screen.getByLabelText(/^Pexels API Key/)as HTMLInputElement).value).toBe('synthetic-draft');
});
it('keeps the created connection selected and announces saving, testing and the named result',async()=>{
 let finish!:(value:unknown)=>void;const test=vi.fn(()=>new Promise(resolve=>finish=resolve));
 const connection={id:'seedance-created',name:'方舟连接',provider:'volcengine',adapter:'seedance_video',status:'unverified'}as ExternalConnection;
 const {useState}=await import('react');
 function Harness(){const[connections,setConnections]=useState<ExternalConnection[]>([]);return <ConnectionWorkspace connections={connections} onCreateConnection={async()=>{setConnections([connection]);return connection;}} onTestConnection={test}/>;}
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'新建连接'}));
 fireEvent.change(screen.getByLabelText('连接类型'),{target:{value:'seedance_video'}});
 fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:connection.name}});
 fireEvent.change(screen.getByLabelText(/^火山方舟 Seedance API Key/),{target:{value:'synthetic-key'}});
 fireEvent.click(screen.getByRole('button',{name:'保存并测试'}));
 await screen.findByText('正在测试连接');
 expect((screen.getByLabelText(/^连接名称/)as HTMLInputElement).value).toBe(connection.name);
 expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('');
 await act(async()=>finish({ready:true,detail:'连接验证通过；尚未执行内容生成。'}));
 const result=screen.getByRole('status');expect(result.textContent).toContain('连接测试通过');expect(result.textContent).toContain(connection.name);
 expect((screen.getByLabelText(/^连接名称/)as HTMLInputElement).value).toBe(connection.name);
});
it('keeps the selected connection and edited fields after a failed test with one visible failure result',async()=>{
 const connection={id:'saved-ark',name:'方舟连接',provider:'volcengine',adapter:'seedance_video',status:'verified',description:'保留说明'}as ExternalConnection;
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onUpdateConnection={vi.fn().mockResolvedValue(undefined)} onTestConnection={vi.fn().mockResolvedValue({ready:false,detail:'服务拒绝认证（HTTP 401）。'})}/>);
 edit(connection.name);
 fireEvent.change(screen.getByLabelText(/^连接说明/),{target:{value:'未保存的说明'}});
 fireEvent.click(screen.getByRole('button',{name:'保存并测试'}));
 const result=await screen.findByRole('alert');expect(result.textContent).toContain('连接测试未通过');expect(result.textContent).toContain('HTTP 401');
 expect(screen.getAllByRole('alert')).toHaveLength(1);
 expect((screen.getByLabelText(/^连接名称/)as HTMLInputElement).value).toBe(connection.name);
 expect((screen.getByLabelText(/^连接说明/)as HTMLTextAreaElement).value).toBe('未保存的说明');
});
it('shows the saved verification result when reopening an existing connection',()=>{
 const connection={id:'reopen-ark',name:'已保存的方舟',provider:'volcengine',adapter:'seedance_video',status:'verified',last_verified_at:'2026-10-27T13:00:00Z',last_verification_detail:'已验证；运行时仍检查密钥可用性。'}as ExternalConnection;
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 edit(connection.name);
 const result=screen.getByRole('status');expect(result.textContent).toContain('连接测试通过');expect(result.textContent).toContain(connection.name);expect(result.querySelector('time')?.dateTime).toBe(connection.last_verified_at);
});
