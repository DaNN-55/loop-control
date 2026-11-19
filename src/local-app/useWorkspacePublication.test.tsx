import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useWorkspacePublication} from './useWorkspacePublication';
import {localRequest,localCommand} from './client';
import {emptyPublicationContent,type WorkspacePublication} from '../workspacePublication';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();});
const initial:WorkspacePublication={workspaceId:'workspace',revision:0,content:{...emptyPublicationContent,tags:[]},cover:null,basisContentSha256:'video',previousText:null,updatedAt:null};
function Form({episode='episode'}:{episode?:string}){const p=useWorkspacePublication(episode,'workspace');return <><label>标题<input value={p.content.title} disabled={!p.state} onChange={e=>p.edit({...p.content,title:e.target.value})}/></label>{p.error&&<p role="alert">{p.error}</p>}</>;}
it('autosaves the latest edit after an earlier save settles without overwriting typing',async()=>{
 vi.mocked(localRequest).mockResolvedValue(initial);
 let finish!:(value:WorkspacePublication)=>void;
 vi.mocked(localCommand).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockImplementation(async(_name,data)=>({...initial,revision:2,content:(data as {content:WorkspacePublication['content']}).content}));
 render(<Form/>);await waitFor(()=>expect(screen.getByRole('textbox')).toHaveProperty('disabled',false));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'第一版'}});
 await waitFor(()=>expect(localCommand).toHaveBeenCalledTimes(1));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'继续手改'}});
 await act(async()=>finish({...initial,revision:1,content:{...initial.content,title:'第一版'}}));
 expect(screen.getByRole('textbox')).toHaveProperty('value','继续手改');
 await waitFor(()=>expect(localCommand).toHaveBeenCalledTimes(2));
 expect(vi.mocked(localCommand).mock.calls[1][1]).toMatchObject({expectedRevision:1,content:{title:'继续手改'}});
});
it('keeps edits visible after a save fails instead of entering an automatic retry loop',async()=>{
 vi.mocked(localRequest).mockResolvedValue(initial);vi.mocked(localCommand).mockRejectedValue(Error('连接中断，修改未保存。'));
 render(<Form/>);await waitFor(()=>expect(screen.getByRole('textbox')).toHaveProperty('disabled',false));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'必须保留'}});
 await screen.findByRole('alert');expect(screen.getByRole('textbox')).toHaveProperty('value','必须保留');expect(localCommand).toHaveBeenCalledTimes(1);
});
