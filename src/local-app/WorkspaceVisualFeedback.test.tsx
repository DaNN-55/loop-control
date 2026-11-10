import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';

const candidate={id:'image',kind:'image',usage:'still',targetItemId:'target',shotId:'shot',status:'available',relativePath:'candidate.png',sha256:'a'.repeat(64),durationSeconds:3,currentDurationSeconds:3};
const base={id:'workspace',episodeId:'episode',revision:1,stale:false,project:{sha256:'original'},clips:[{id:'clip',itemId:'target',shotId:'shot',text:'山峰'}],visualCandidates:[candidate],visualTasks:[]} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.useRealTimers();});

it('only fades in new output from an observed task, without changing the current preview or adopting',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const command=vi.fn(),props={command,onChange:vi.fn(),materials:[]};
 const running={...base,visualTasks:[{id:'pending',taskId:'task',kind:'image',shotId:'shot',targetItemId:'target',status:'running',createdAt:new Date().toISOString()}]} as unknown as ProductionWorkspace;
 const view=render(<WorkspaceVisualPreparation {...props} workspace={running}/>);
 fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01'}));
 expect(screen.getByRole('button',{name:'预览图片候选 01'}).hasAttribute('data-arriving')).toBe(false);
 const output={...candidate,id:'output',taskId:'task',relativePath:'output.png'};
 const completed={...base,revision:2,visualCandidates:[...base.visualCandidates!,output],visualTasks:[]} as ProductionWorkspace;
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={completed}/>);
 expect(screen.getByRole('button',{name:'预览图片候选 02'}).hasAttribute('data-arriving')).toBe(true);
 expect(screen.getByRole('img',{name:'图片候选 1'}).getAttribute('src')).toContain('candidate.png');
 expect(command).not.toHaveBeenCalled();
 await act(async()=>{vi.advanceTimersByTime(250);});
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={{...completed}}/>);
 expect(screen.getByRole('button',{name:'预览图片候选 02'}).hasAttribute('data-arriving')).toBe(false);
 view.unmount();render(<WorkspaceVisualPreparation {...props} workspace={completed}/>);
 expect(document.querySelector('[data-arriving]')).toBeNull();
});

it('does not animate imported candidates or results first discovered when reopening a shot',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const props={command:vi.fn(),onChange:vi.fn(),materials:[]},view=render(<WorkspaceVisualPreparation {...props} workspace={base}/>);
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={{...base,visualCandidates:[...base.visualCandidates!,{...candidate,id:'unobserved',taskId:'other-task'}]} as ProductionWorkspace}/>);
 expect(document.querySelector('[data-arriving]')).toBeNull();
});

it.each([false,true])('only signals adoption after a successful response (failed=%s)',async failed=>{
 let current=base,finish!:(value:ProductionWorkspace)=>void,reject!:(error:Error)=>void;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current,serviceCatalog:{groups:[]}})));
 const plan={adoptionId:'prepared',candidateId:'image',projectSha256:'original',edit:{},impact:{currentSeconds:3,sourceSeconds:3,appliedSeconds:3,deltaSeconds:0,captionRecheck:false,affectedFragments:[]}};
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?plan:new Promise<ProductionWorkspace>((resolve,no)=>{finish=resolve;reject=no;}));
 function App(){const [workspace,setWorkspace]=useState(base);return <WorkspaceVisualPreparation workspace={workspace} command={command} onChange={value=>{current=value;setWorkspace(value);}} materials={[]} currentVisualKind="image" currentVisualPath={workspace.visualCandidates?.find(c=>c.status==='adopted')?.relativePath}/>;}
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:/采用(?:图片|视频)到当前镜头/}));
 fireEvent.click(await screen.findByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));expect(document.querySelector('[data-adoption-feedback]')).toBeNull();
 await act(async()=>{if(failed)reject(Error('采用失败'));else finish({...base,revision:2,visualCandidates:[{...base.visualCandidates![0],status:'adopted'}]});});
 if(failed){expect(await screen.findByRole('alert')).toBeTruthy();expect(document.querySelector('[data-adoption-feedback]')).toBeNull();}
 else{
  const adopted=screen.getByRole('button',{name:'预览图片候选 01，已采用'});
  expect(adopted.hasAttribute('data-adoption-feedback')).toBe(true);expect(adopted.querySelector('.workspace-thumbnail-adopted')).toBeTruthy();
  await waitFor(()=>expect(adopted.hasAttribute('data-adoption-feedback')).toBe(false));
  expect(adopted.querySelector('.workspace-thumbnail-adopted')).toBeTruthy();
 }
});

it('hides superseded known failures after a new task is actually queued but retains unknown submissions',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const failure={id:'failure',taskId:'old',kind:'image',targetItemId:'target',shotId:'shot',status:'failed',createdAt:'2026-11-09T01:00:00Z',submissionOutcome:'rejected',error:'旧轮失败'};
 const props={command:vi.fn(),onChange:vi.fn(),materials:[]};
 const view=render(<WorkspaceVisualPreparation {...props} workspace={{...base,visualTasks:[failure]} as unknown as ProductionWorkspace}/>);
 expect(screen.getByText(/旧轮失败/)).toBeTruthy();
 const next={...failure,id:'new',taskId:'new',status:'running',createdAt:'2026-11-09T01:01:00Z',error:undefined};
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={{...base,visualTasks:[next,failure]} as unknown as ProductionWorkspace}/>);
 expect(screen.queryByText(/旧轮失败/)).toBeNull();
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={{...base,visualTasks:[next,{...failure,submissionUnknown:true,submissionOutcome:'unknown'}]} as unknown as ProductionWorkspace}/>);
 expect(screen.getByText(/旧轮失败/)).toBeTruthy();
});
