import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LogStorageSettings} from './LogStorageSettings';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>request(path,init)}));
const state={activeDirectory:'/test/logs',configuredDirectory:'/test/logs',defaultDirectory:'/test/logs',pending:false,warning:null};
afterEach(()=>{cleanup();request.mockReset();});
it('reads a compact location without editing and discards a cancelled directory draft',async()=>{
 request.mockResolvedValue(state);const changed=vi.fn();
 render(<LogStorageSettings csrf="synthetic" compact onStateChange={changed}/>);
 await screen.findByText('/test/logs');expect(screen.queryByRole('textbox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'修改日志位置'}));
 fireEvent.change(screen.getByRole('textbox',{name:'日志保存目录'}),{target:{value:'/test/changed'}});
 await waitFor(()=>expect(changed).toHaveBeenLastCalledWith({busy:false,dirty:true}));
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByText('/test/logs')).toBeTruthy();
 expect(changed).toHaveBeenLastCalledWith({busy:false,dirty:false});
 expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
});
it('keeps a failed log save editable and opens only the server-owned current directory',async()=>{
 request.mockImplementation(async(_path:string,init?:RequestInit)=>{
  if(!init?.body)return state;const body=JSON.parse(String(init.body));
  if(body.command==='open')return {opened:true};throw Error('保存失败');
 });
 render(<LogStorageSettings csrf="synthetic" compact/>);await screen.findByText('/test/logs');
 fireEvent.click(screen.getByRole('button',{name:'打开日志文件夹'}));
 await waitFor(()=>expect(JSON.parse(request.mock.calls.at(-1)![1].body)).toEqual({command:'open'}));
 fireEvent.click(screen.getByRole('button',{name:'修改日志位置'}));
 fireEvent.change(screen.getByRole('textbox',{name:'日志保存目录'}),{target:{value:'/test/new'}});
 fireEvent.click(screen.getByRole('button',{name:'保存日志位置'}));await screen.findByText('保存失败');
 expect(screen.getByRole('textbox',{name:'日志保存目录'})).toHaveProperty('value','/test/new');
});
