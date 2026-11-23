import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspacePublicationPanel} from './WorkspacePublicationPanel';
import {localRequest,localCommand} from './client';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspacePublication} from '../workspacePublication';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
vi.mock('./WorkspaceDraft',()=>({useWorkspaceOwnerId:()=> 'owner'}));
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();});
const state:WorkspacePublication={workspaceId:'workspace',revision:1,content:{title:'手写',description:'原简介',tags:['原'],instruction:''},cover:null,basisContentSha256:'video',previousText:null,updatedAt:null};
const w={id:'workspace',episodeId:'episode',contentSha256:'video',coverInputs:[]} as unknown as ProductionWorkspace;
const services=[{id:'selected',connectionName:'我的模型',executable:true,connectionVersionId:'cv',models:['gpt-5.6-luna'],provider:'openai',adapter:'openai_responses'}];
function reads(){vi.mocked(localRequest).mockImplementation(async path=>path==='connections'?{serviceCatalog:{groups:[{capability:'language_model',services}]}}:path.endsWith('publication-ai')?null:state);}
it('reuses the explicitly selected model, generates once, replaces one editable set and can undo',async()=>{
 reads();localStorage.setItem('loop-control.script-studio-model:owner','selected:gpt-5.6-luna');
 const generated={...state,revision:2,content:{...state.content,title:'新标题'},previousText:state.content};
 vi.mocked(localCommand).mockImplementation(async command=>command==='generate'?{status:'completed',publication:generated}:({...state,revision:3}));
 render(<WorkspacePublicationPanel workspace={w}/>);await screen.findByText('gpt-5.6-luna');expect(localCommand).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('重新生成文案'));fireEvent.click(screen.getByRole('button',{name:'重新生成发布文案'}));await screen.findByText('新标题');
 expect(localCommand).toHaveBeenCalledWith('generate',expect.objectContaining({expectedRevision:1,selection:expect.objectContaining({model:'gpt-5.6-luna',connectionVersionId:'cv'})}),undefined,'episodes/episode/publication-ai');
 fireEvent.click(screen.getByRole('button',{name:'撤回本次替换'}));await screen.findByText('手写');expect(screen.queryByRole('button',{name:'采用文案'})).toBeNull();
});
it('does not silently choose a replacement provider when the remembered model is unavailable',async()=>{
 reads();localStorage.setItem('loop-control.script-studio-model:owner','old-provider:unavailable');render(<WorkspacePublicationPanel workspace={w}/>);await screen.findByLabelText('标题');
 fireEvent.click(screen.getByText('重新生成文案'));fireEvent.click(screen.getByRole('button',{name:'重新生成发布文案'}));await screen.findByText('请明确选择本次模型。');expect(screen.getByRole('menuitemradio',{name:'gpt-5.6-luna'}).getAttribute('aria-checked')).toBe('false');expect(localCommand).not.toHaveBeenCalled();expect(screen.getByText('手写')).toBeTruthy();
});
it('does not overwrite typing with a late AI replacement',async()=>{
 reads();localStorage.setItem('loop-control.script-studio-model:owner','selected:gpt-5.6-luna');let finish!:(value:unknown)=>void;
 vi.mocked(localCommand).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));render(<WorkspacePublicationPanel workspace={w}/>);await screen.findByText('gpt-5.6-luna');
 fireEvent.click(screen.getByText('重新生成文案'));fireEvent.click(screen.getByRole('button',{name:'重新生成发布文案'}));await waitFor(()=>expect(localCommand).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'编辑文案'}));fireEvent.change(screen.getByLabelText('标题'),{target:{value:'我正在写'}});
 await act(async()=>finish({status:'completed',publication:{...state,revision:2,content:{...state.content,title:'晚到文案'}}}));await waitFor(()=>expect(screen.queryByText('正在生成文案…')).toBeNull());expect(screen.getByLabelText('标题')).toHaveProperty('value','我正在写');
});

it('chooses through the shared model menu without generating and offers refresh and setup',async()=>{
 reads();render(<WorkspacePublicationPanel workspace={w}/>);await screen.findByText('手写');fireEvent.click(screen.getByText('重新生成文案'));fireEvent.click(screen.getByRole('button',{name:'选择文案模型'}));
 const option=await screen.findByRole('menuitemradio',{name:'gpt-5.6-luna'});expect(screen.getByRole('button',{name:'刷新模型连接'})).toBeTruthy();expect(screen.getByRole('button',{name:'配置制作服务'})).toBeTruthy();fireEvent.click(option);
 expect(screen.getByRole('button',{name:'选择文案模型'}).textContent).toContain('gpt-5.6-luna');expect(localCommand).not.toHaveBeenCalled();expect(localStorage.getItem('loop-control.script-studio-model:owner')).toBe('selected:gpt-5.6-luna');
});

it('keeps manual publication actions on completed orders without offering a new generation',async()=>{
 reads();
 render(<WorkspacePublicationPanel workspace={w} completedView/>);
 expect(await screen.findByRole('button',{name:'复制全部'})).toBeTruthy();
 expect(screen.queryByText('重新生成文案')).toBeNull();
 expect(screen.queryByText('AI 生成文案')).toBeNull();
 expect(localRequest).not.toHaveBeenCalledWith('connections');
 fireEvent.click(screen.getByRole('button',{name:'编辑文案'}));
 expect(screen.getByRole('textbox',{name:'标题'})).toHaveProperty('value','手写');
 expect(localCommand).not.toHaveBeenCalled();
});

it('allows completed orders to check an existing request without creating another',async()=>{
 vi.mocked(localRequest).mockImplementation(async path=>path.endsWith('publication-ai')?{requestId:'prior',status:'unknown',message:'请核对上次请求。'}:state);
 render(<WorkspacePublicationPanel workspace={w} completedView/>);
 const recover=await screen.findByRole('button',{name:'核对原请求'});
 await act(async()=>{fireEvent.click(recover);});
 expect(localRequest).toHaveBeenCalledTimes(3);
 expect(screen.queryByText('重新生成文案')).toBeNull();
 expect(localCommand).not.toHaveBeenCalled();
});
