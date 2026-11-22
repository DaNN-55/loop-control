import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspacePublicationPanel} from './WorkspacePublicationPanel';
import {localRequest,localCommand} from './client';
import {emptyPublicationContent,type WorkspacePublication} from '../workspacePublication';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
vi.mock('./WorkspaceDraft',()=>({useWorkspaceOwnerId:()=> 'owner'}));
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();});
const initial:WorkspacePublication={workspaceId:'workspace',revision:0,content:{...emptyPublicationContent,tags:[]},cover:null,basisContentSha256:'video',previousText:null,updatedAt:null};
const workspace={id:'workspace',episodeId:'episode',contentSha256:'video',exports:[],coverInputs:[]} as unknown as ProductionWorkspace;
it('keeps typing local until explicit save, returns to reading mode and copies all fields',async()=>{
 vi.mocked(localRequest).mockResolvedValue(initial);
 vi.mocked(localCommand).mockImplementation(async(_name,data)=>({...initial,revision:1,content:(data as {content:WorkspacePublication['content']}).content}));
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 render(<WorkspacePublicationPanel workspace={workspace}/>);fireEvent.click(await screen.findByRole('button',{name:'自己填写'}));
 fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'晨光'}});fireEvent.change(screen.getByRole('textbox',{name:'标签'}),{target:{value:'清晨，山野'}});
 await new Promise(resolve=>setTimeout(resolve,550));expect(localCommand).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存文案'}));await screen.findByRole('button',{name:'编辑文案'});expect(screen.queryByRole('textbox',{name:'标题'})).toBeNull();
 expect(localCommand).toHaveBeenCalledWith('save',expect.objectContaining({expectedRevision:0,content:expect.objectContaining({title:'晨光',tags:['清晨','山野']})}),undefined,'episodes/episode/publication');
 fireEvent.click(screen.getByRole('button',{name:'复制全部'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith('晨光\n\n#清晨 #山野'));
});
it('cancels local edits without writing over the saved version',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...initial,revision:2,content:{...initial.content,title:'原文'}});render(<WorkspacePublicationPanel workspace={workspace}/>);
 fireEvent.click(await screen.findByRole('button',{name:'编辑文案'}));fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'取消的修改'}});fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(screen.getByText('原文')).toBeTruthy();expect(screen.queryByRole('textbox',{name:'标题'})).toBeNull();expect(localCommand).not.toHaveBeenCalled();
});
it('retains failed saves for retry instead of hiding the editor',async()=>{
 vi.mocked(localRequest).mockResolvedValue(initial);vi.mocked(localCommand).mockRejectedValueOnce(Error('连接中断')).mockImplementation(async(_name,data)=>({...initial,revision:1,content:(data as {content:WorkspacePublication['content']}).content}));
 render(<WorkspacePublicationPanel workspace={workspace}/>);fireEvent.click(await screen.findByRole('button',{name:'自己填写'}));fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'必须保留'}});fireEvent.click(screen.getByRole('button',{name:'保存文案'}));
 await screen.findByText('连接中断');expect(screen.getByRole('textbox',{name:'标题'})).toHaveProperty('value','必须保留');fireEvent.click(screen.getByRole('button',{name:'重试保存'}));await screen.findByRole('button',{name:'编辑文案'});expect(screen.getByText('必须保留')).toBeTruthy();expect(localCommand).toHaveBeenCalledTimes(2);
});
it('retains the saved draft when video content changes and asks for a check without generating',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...initial,revision:1,content:{...initial.content,title:'保留的文案'}});
 render(<WorkspacePublicationPanel workspace={{...workspace,contentSha256:'new-video'}}/>);
 expect(await screen.findByText('保留的文案')).toBeTruthy();expect(screen.queryByRole('textbox',{name:'标题'})).toBeNull();
 expect(screen.getByText('视频已更新，请核对发布资料。')).toBeTruthy();expect(localCommand).not.toHaveBeenCalled();
});

it('restores an unsaved Owner draft on reopening without silently saving it',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...initial,revision:2,content:{...initial.content,title:'已保存'}});
 const first=render(<WorkspacePublicationPanel workspace={workspace}/>);fireEvent.click(await screen.findByRole('button',{name:'编辑文案'}));fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'尚未保存的本机草稿'}});first.unmount();
 render(<WorkspacePublicationPanel workspace={workspace}/>);await waitFor(()=>expect(screen.getByRole('textbox',{name:'标题'})).toHaveProperty('value','尚未保存的本机草稿'));await new Promise(resolve=>setTimeout(resolve,550));expect(localCommand).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(screen.getByText('已保存')).toBeTruthy();expect(localStorage.getItem('loop-control.publication-draft:'+JSON.stringify(['owner','episode','workspace']))).toBeNull();
});
