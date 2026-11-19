import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspacePublicationPanel} from './WorkspacePublicationPanel';
import {localRequest,localCommand} from './client';
import {emptyPublicationContent,type WorkspacePublication} from '../workspacePublication';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const initial:WorkspacePublication={workspaceId:'workspace',revision:0,content:{...emptyPublicationContent,tags:[]},cover:null,basisContentSha256:'video',previousText:null,updatedAt:null};
const workspace={id:'workspace',episodeId:'episode',contentSha256:'video',exports:[],coverInputs:[]} as unknown as ProductionWorkspace;
it('allows optional manual text before confirmation, autosaves and copies fields separately',async()=>{
 vi.mocked(localRequest).mockResolvedValue(initial);
 vi.mocked(localCommand).mockImplementation(async(_name,data)=>({...initial,revision:1,content:(data as {content:WorkspacePublication['content']}).content}));
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 render(<WorkspacePublicationPanel workspace={workspace}/>);
 fireEvent.click(await screen.findByRole('button',{name:'自己填写'}));
 fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'晨光'}});
 fireEvent.change(screen.getByRole('textbox',{name:'标签'}),{target:{value:'清晨，山野'}});
 await waitFor(()=>expect(localCommand).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByRole('button',{name:'复制标题'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith('晨光'));
 fireEvent.click(screen.getByRole('button',{name:'复制标签'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith('#清晨 #山野'));
 expect(screen.queryByRole('button',{name:'保存'})).toBeNull();expect(screen.queryByRole('button',{name:'复制全部'})).toBeNull();
});
it('retains the saved draft when video content changes and asks for a check without generating',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...initial,revision:1,content:{...initial.content,title:'保留的文案'}});
 render(<WorkspacePublicationPanel workspace={{...workspace,contentSha256:'new-video'}}/>);
 expect(await screen.findByRole('textbox',{name:'标题'})).toHaveProperty('value','保留的文案');
 expect(screen.getByText('视频已更新，请核对发布资料。')).toBeTruthy();expect(localCommand).not.toHaveBeenCalled();
});
