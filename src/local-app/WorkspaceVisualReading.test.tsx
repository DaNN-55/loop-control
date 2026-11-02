import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVisualCandidatesPanel} from './WorkspaceVisualCandidatesPanel';
import type {ProductionWorkspace} from '../productionWorkspace';

const workspace={id:'workspace',episodeId:'episode',revision:3,stale:false,clips:[
 {id:'clip-1',itemId:'visual-1',shotId:'S1',text:'第一镜',source:null},
 {id:'clip-2',itemId:'visual-2',shotId:'S2',text:'第二镜',source:null},
],visualCandidates:[],visualTasks:[{id:'running',taskId:'task',shotId:'S1',kind:'video',status:'running'}]} as unknown as ProductionWorkspace;
const material={id:'image',material_type:'image',source_path:'frame.png'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>{cleanup();sessionStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
function Host({preparation,command,initial=workspace,target='visual-1',onChange=()=>{}}:{preparation:boolean;command:(name:string,data:unknown)=>Promise<unknown>;initial?:ProductionWorkspace;target?:string;onChange?:(w:ProductionWorkspace)=>void}){
 const [w,set]=useState(initial);
 return <><output data-testid="revision">{w.revision}</output><output data-testid="tasks">{w.visualTasks?.map(t=>t.status).join(',')}</output>
  <button onClick={()=>set({...w,revision:8})}>external edit</button>
  <WorkspaceVisualCandidatesPanel preparation={preparation} workspace={w} command={command} onChange={value=>{set(value);onChange(value);}} materials={[material]} selectedTargetItemId={target}/></>;
}
function register(preparation:boolean){
 if(preparation){fireEvent.click(screen.getByText('从本期素材选取'));fireEvent.change(screen.getByLabelText('选择本期图片'),{target:{value:'image'}});}
 else{fireEvent.change(screen.getByLabelText('本期画面素材'),{target:{value:'image'}});fireEvent.click(screen.getByRole('button',{name:'添加为画面候选'}));}
}

it.each([true,false])('a slow poll cannot overwrite a later command at the same revision (preparation=%s)',async preparation=>{
 vi.useFakeTimers();const slow=deferred<Response>();let reads=0;
 vi.stubGlobal('fetch',vi.fn(()=>++reads===1?slow.promise:Promise.resolve(Response.json({workspace}))));
 const next={...workspace,visualTasks:[{...workspace.visualTasks![0],status:'completed' as const}]},command=vi.fn(async()=>next),changed=vi.fn();
 render(<Host preparation={preparation} command={command} onChange={changed}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(reads).toBe(1);
 register(preparation);await act(async()=>{});
 expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',expect.objectContaining({expectedRevision:3,targetItemId:'visual-1'}));
 expect(screen.getByTestId('tasks').textContent).toBe('completed');const calls=changed.mock.calls.length;
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 expect(changed).toHaveBeenCalledTimes(calls);expect(screen.getByTestId('tasks').textContent).toBe('completed');
});

it('Pexels and visual generation share an in-flight read while retaining the search draft',async()=>{
 vi.useFakeTimers();const slow=deferred<Response>();let reads=0;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/local/connections'?Promise.resolve(Response.json({serviceCatalog:{groups:[]}})):(reads++,slow.promise)));
 const w={...workspace,pexels:{requests:[{id:'search',taskId:'search-task',operation:'search',targetItemId:'visual-1',status:'running',parameters:{page:1}}]}} as unknown as ProductionWorkspace;
 const command=vi.fn();render(<Host preparation command={command} initial={w}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'素材检索'}));
 fireEvent.change(screen.getByLabelText('检索词'),{target:{value:'保留这个查询'}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(reads).toBe(1);
 await act(async()=>{slow.resolve(Response.json({workspace:{...w,revision:4}}));});
 expect(screen.getByTestId('revision').textContent).toBe('4');expect((screen.getByLabelText('检索词') as HTMLInputElement).value).toBe('保留这个查询');expect(command).not.toHaveBeenCalled();
});

it.each([true,false])('a newer parent revision is used when the pre-command read returns an older version (preparation=%s)',async preparation=>{
 const slow=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>slow.promise));const command=vi.fn(async()=>({...workspace,revision:8}));
 render(<Host preparation={preparation} command={command}/>);register(preparation);
 fireEvent.click(screen.getByRole('button',{name:'external edit'}));
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 await waitFor(()=>expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',expect.objectContaining({expectedRevision:8})));
 expect(screen.getByTestId('revision').textContent).toBe('8');
});

it.each([true,false])('a target switch cancels a slow pre-command read even if the transport ignores abort (preparation=%s)',async preparation=>{
 const slow=deferred<Response>();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url:string,options?:RequestInit)=>{signal=options?.signal??undefined;return slow.promise;}));
 const command=vi.fn(),props={preparation,command},view=render(<Host {...props}/>);register(preparation);
 view.rerender(<Host {...props} target="visual-2"/>);
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 expect(signal?.aborted).toBe(true);expect(command).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();
 expect((screen.getByLabelText('画面候选目标') as HTMLSelectElement).value).toBe('visual-2');
});

it.each([true,false])('an explicit refresh preserves the unsubmitted video draft through target switches and reopening (preparation=%s)',async preparation=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:{groups:[]}}:{workspace:{...workspace,revision:4}})));
 const command=vi.fn(),props={preparation,command},view=render(<Host {...props}/>);
 if(preparation){fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));}
 else fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});
 fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'第一镜未提交的动作'}});
 expect(screen.queryByLabelText(/本次费用预留/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:preparation?'刷新':'刷新画面'}));await waitFor(()=>expect(screen.getByTestId('revision').textContent).toBe('4'));
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');
 view.rerender(<Host {...props} target="visual-2"/>);view.rerender(<Host {...props}/>);
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');
 view.unmount();render(<Host {...props}/>);
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');expect(screen.queryByLabelText(/本次费用预留/)).toBeNull();expect(command).not.toHaveBeenCalled();
});

it.each([true,false])('a version conflict is shown without retrying, adopting or clearing choices (preparation=%s)',async preparation=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async()=>{throw Error('工程版本已变化，请重新打开当前工作版本。');});
 render(<Host preparation={preparation} command={command}/>);register(preparation);
 expect((await screen.findByRole('alert')).textContent).toContain('工程版本已变化');expect(command).toHaveBeenCalledTimes(1);
 if(!preparation)expect((screen.getByLabelText('本期画面素材') as HTMLSelectElement).value).toBe('image');
});
