import {registeredAdapters} from '../worker/registeredAdapters';
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';

const workspace={id:'workspace',episodeId:'episode',revision:3,stale:false,clips:[
 {id:'clip-1',itemId:'visual-1',shotId:'S1',text:'第一镜',source:null},
 {id:'clip-2',itemId:'visual-2',shotId:'S2',text:'第二镜',source:null},
],visualCandidates:[],visualTasks:[{id:'running',taskId:'task',shotId:'S1',kind:'video',status:'running'}]} as unknown as ProductionWorkspace;
const material={id:'image',material_type:'image',source_path:'frame.png'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>{cleanup();sessionStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
function Host({command,initial=workspace,target='visual-1',onChange=()=>{}}:{command:(name:string,data:unknown)=>Promise<unknown>;initial?:ProductionWorkspace;target?:string;onChange?:(w:ProductionWorkspace)=>void}){
 const [w,set]=useState(initial);
 return <><output data-testid="revision">{w.revision}</output><output data-testid="tasks">{w.visualTasks?.map(t=>t.status).join(',')}</output>
  <button onClick={()=>set({...w,revision:8})}>external edit</button>
  <WorkspaceVisualPreparation workspace={w} command={command} onChange={value=>{set(value);onChange(value);}} materials={[material]} selectedTargetItemId={target}/></>;
}
function register(){fireEvent.click(screen.getByText('从本期素材选取'));fireEvent.change(screen.getByLabelText('选择本期图片'),{target:{value:'image'}});}

it('a slow poll cannot overwrite a later command at the same revision',async()=>{
 vi.useFakeTimers();const slow=deferred<Response>();let reads=0;
 vi.stubGlobal('fetch',vi.fn(()=>++reads===1?slow.promise:Promise.resolve(Response.json({workspace}))));
 const next={...workspace,visualTasks:[{...workspace.visualTasks![0],status:'completed' as const}]},command=vi.fn(async()=>next),changed=vi.fn();
 render(<Host command={command} onChange={changed}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(reads).toBe(1);
 register();await act(async()=>{});
 expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',expect.objectContaining({expectedRevision:3,targetItemId:'visual-1'}));
 expect(screen.getByTestId('tasks').textContent).toBe('completed');const calls=changed.mock.calls.length;
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 expect(changed).toHaveBeenCalledTimes(calls);expect(screen.getByTestId('tasks').textContent).toBe('completed');
});

it('Pexels and visual generation share an in-flight read while retaining the search draft',async()=>{
 vi.useFakeTimers();const slow=deferred<Response>();let reads=0;
 const service={...registeredAdapters.productionChoices().find(c=>c.provider==='pexels'&&c.adapter==='pexels_video')!,id:'pexels',connectionVersionId:'pexels-v',connectionName:'图库',executable:true};
 vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/local/connections'?Promise.resolve(Response.json({serviceCatalog:{groups:[{capability:'video',services:[service]}]}})):(reads++,slow.promise)));
 const w={...workspace,pexels:{requests:[{id:'search',taskId:'search-task',operation:'search',targetItemId:'visual-1',status:'running',parameters:{page:1}}]}} as unknown as ProductionWorkspace;
 const command=vi.fn();render(<Host command={command} initial={w}/>);
 await act(async()=>{});fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));fireEvent.click(screen.getByRole('menuitemradio',{name:/Pexels 素材检索/}));
 fireEvent.change(screen.getByLabelText('检索词'),{target:{value:'保留这个查询'}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(reads).toBe(1);
 await act(async()=>{slow.resolve(Response.json({workspace:{...w,revision:4}}));});
 expect(screen.getByTestId('revision').textContent).toBe('4');expect((screen.getByLabelText('检索词') as HTMLInputElement).value).toBe('保留这个查询');expect(command).not.toHaveBeenCalled();
});

it('a newer parent revision is used when the pre-command read returns an older version',async()=>{
 const slow=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>slow.promise));const command=vi.fn(async()=>({...workspace,revision:8}));
 render(<Host command={command}/>);register();
 fireEvent.click(screen.getByRole('button',{name:'external edit'}));
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 await waitFor(()=>expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',expect.objectContaining({expectedRevision:8})));
 expect(screen.getByTestId('revision').textContent).toBe('8');
});

it('a target switch cancels a slow pre-command read even if the transport ignores abort',async()=>{
 const slow=deferred<Response>();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url:string,options?:RequestInit)=>{signal=options?.signal??undefined;return slow.promise;}));
 const command=vi.fn(),props={command},view=render(<Host {...props}/>);register();
 view.rerender(<Host {...props} target="visual-2"/>);
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 expect(signal?.aborted).toBe(true);expect(command).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();
 expect((screen.getByLabelText('画面候选目标') as HTMLSelectElement).value).toBe('visual-2');
});

it('automatic task refresh preserves the unsubmitted video draft without a manual refresh button',async()=>{
 vi.useFakeTimers();
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:{groups:[]}}:{workspace:{...workspace,revision:4}})));
 const command=vi.fn(),props={command},view=render(<Host {...props}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));
 fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'第一镜未提交的动作'}});
 expect(screen.queryByLabelText(/本次费用预留/)).toBeNull();
 expect(screen.queryByRole('button',{name:/^刷新$/})).toBeNull();
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByTestId('revision').textContent).toBe('4');
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');
 view.rerender(<Host {...props} target="visual-2"/>);view.rerender(<Host {...props}/>);
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');
 view.unmount();render(<Host {...props}/>);
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');expect(screen.queryByLabelText(/本次费用预留/)).toBeNull();expect(command).not.toHaveBeenCalled();
});

it('a version conflict is shown without retrying, adopting or clearing choices',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async()=>{throw Error('工程版本已变化，请重新打开当前工作版本。');});
 render(<Host command={command}/>);register();
 expect((await screen.findByRole('alert')).textContent).toContain('工程版本已变化');expect(command).toHaveBeenCalledTimes(1);
});
