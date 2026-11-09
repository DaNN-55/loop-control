import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import {useWorkspaceCandidateReview} from './useWorkspaceCandidateReview';
import {useWorkspaceReading} from './useWorkspaceReading';

const workspace={id:'w',episodeId:'e',revision:1,project:{sha256:'original'}} as ProductionWorkspace;
const plan={adoptionId:'adoption',candidateId:'candidate',projectSha256:'original',edit:{source:{kind:'audio'}},impact:{currentSeconds:2,sourceSeconds:4,appliedSeconds:4,deltaSeconds:2,affectedFragments:[]}} as unknown as WorkspaceCandidatePreparation;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(command:(name:string,data:unknown)=>Promise<unknown>){
 let current=workspace;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));const changed=vi.fn();
 const hook=renderHook(({scope,w})=>{const reader=useWorkspaceReading(w,changed,'S1','读取失败');return useWorkspaceCandidateReview({workspace:w,scope,reader,command});},{initialProps:{scope:'S1',w:workspace}});
 return{...hook,changed,setCurrent:(value:ProductionWorkspace)=>{current=value;}};
}
it('cancel invalidates an in-flight preparation instead of reviving its review',async()=>{
 const slow=deferred<WorkspaceCandidatePreparation>(),command=vi.fn(()=>slow.promise),f=setup(command);let request!:Promise<void>;
 await act(async()=>{request=f.result.current.prepare('candidate');});await waitFor(()=>expect(command).toHaveBeenCalledOnce());
 act(()=>f.result.current.cancel());await act(async()=>{slow.resolve(plan);await request;});expect(f.result.current.plan).toBeNull();
});

it('invalidates a pending preparation when the provided project changes',async()=>{
 const slow=deferred<WorkspaceCandidatePreparation>(),command=vi.fn(()=>slow.promise),f=setup(command);let request!:Promise<void>;
 await act(async()=>{request=f.result.current.prepare('candidate');});
 f.rerender({scope:'S1',w:{...workspace,revision:2,project:{...workspace.project,sha256:'edited'}}});
 await act(async()=>{slow.resolve(plan);await request;});expect(f.result.current.plan).toBeNull();expect(f.result.current.pending).toBe(false);
});

it('does not allow a confirmation callback captured before cancellation to adopt',async()=>{
 const command=vi.fn(async()=>plan),f=setup(command);await act(async()=>{await f.result.current.prepare('candidate');});
 const confirm=f.result.current.confirm;
 await act(async()=>{f.result.current.cancel();await confirm();});expect(command).toHaveBeenCalledTimes(1);
});

it('keeps the newest preparation when an older response arrives last',async()=>{
 const a=deferred<WorkspaceCandidatePreparation>(),b=deferred<WorkspaceCandidatePreparation>();
 const f=setup(vi.fn((_name,data)=>((data as {candidateId:string}).candidateId==='A'?a:b).promise));let first!:Promise<void>,second!:Promise<void>;
 await act(async()=>{first=f.result.current.prepare('A');});await act(async()=>{second=f.result.current.prepare('B');});
 await act(async()=>{b.resolve({...plan,candidateId:'B'});await second;});
 await act(async()=>{a.resolve({...plan,candidateId:'A'});await first;});expect(f.result.current.plan?.candidateId).toBe('B');
});
it('suppresses stale errors and leaves the newest pending request locked',async()=>{
 const a=deferred<WorkspaceCandidatePreparation>(),b=deferred<WorkspaceCandidatePreparation>();let count=0;
 const f=setup(vi.fn(()=>++count===1?a.promise:b.promise));let first!:Promise<void>,second!:Promise<void>;
 await act(async()=>{first=f.result.current.prepare('A');});await act(async()=>{second=f.result.current.prepare('B');});
 await act(async()=>{a.reject(Error('old failure'));await expect(first).resolves.toBeUndefined();});expect(f.result.current.pending).toBe(true);
 await act(async()=>{b.resolve({...plan,candidateId:'B'});await second;});expect(f.result.current.pending).toBe(false);expect(f.result.current.plan?.candidateId).toBe('B');
});
it('fresh preparation reads can establish a new project baseline',async()=>{
 const next={...workspace,revision:2,project:{...workspace.project,sha256:'new-baseline'}},nextPlan={...plan,projectSha256:'new-baseline'};
 const command=vi.fn(async()=>nextPlan),f=setup(command);f.setCurrent(next);
 await act(async()=>{await f.result.current.prepare('candidate');});f.rerender({scope:'S1',w:next});
 expect(f.result.current.plan).toEqual(nextPlan);expect(command).toHaveBeenCalledWith('prepareWorkspaceCandidate',expect.objectContaining({expectedRevision:2}));
});
it('keeps a same-SHA review and confirms with the latest revision exactly once',async()=>{
 const adopted=deferred<ProductionWorkspace>(),command=vi.fn(async(name)=>name==='prepareWorkspaceCandidate'?plan:adopted.promise),f=setup(command);
 await act(async()=>{await f.result.current.prepare('candidate');});const latest={...workspace,revision:7};f.setCurrent(latest);f.rerender({scope:'S1',w:latest});
 const confirm=f.result.current.confirm;let first!:Promise<void>;
 await act(async()=>{first=confirm();await confirm();});expect(command).toHaveBeenLastCalledWith('adoptWorkspaceCandidate',expect.objectContaining({expectedRevision:7,adoptionId:'adoption'}));
 await act(async()=>{adopted.resolve({...latest,revision:8});await first;});expect(command).toHaveBeenCalledTimes(2);
});
it('cancellation before the confirmation read completes sends no adoption',async()=>{
 const command=vi.fn(async()=>plan),f=setup(command);await act(async()=>{await f.result.current.prepare('candidate');});
 const read=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>read.promise));let confirmed!:Promise<void>;
 await act(async()=>{confirmed=f.result.current.confirm();});act(()=>f.result.current.cancel());
 await act(async()=>{read.resolve(Response.json({workspace}));await confirmed;});expect(command).toHaveBeenCalledTimes(1);expect(f.result.current.pending).toBe(false);
});
it('publishes a posted adoption after local cancellation without claiming rollback or running local success',async()=>{
 const adopted=deferred<ProductionWorkspace>(),command=vi.fn(async(name)=>name==='prepareWorkspaceCandidate'?plan:adopted.promise),f=setup(command),success=vi.fn();
 await act(async()=>{await f.result.current.prepare('candidate');});let confirmed!:Promise<void>;
 await act(async()=>{confirmed=f.result.current.confirm(success);});act(()=>f.result.current.cancel());
 expect(f.result.current.pending).toBe(true);await act(async()=>{await f.result.current.prepare('another');});expect(command).toHaveBeenCalledTimes(2);
 const changed={...workspace,revision:2,project:{...workspace.project,sha256:'adopted'}};
 await act(async()=>{adopted.resolve(changed);await confirmed;});expect(f.changed).toHaveBeenLastCalledWith(changed);expect(success).not.toHaveBeenCalled();expect(f.result.current.pending).toBe(false);
});
it('adoption new SHA does not swallow its success callback',async()=>{
 const adopted=deferred<ProductionWorkspace>(),command=vi.fn(async(name)=>name==='prepareWorkspaceCandidate'?plan:adopted.promise),f=setup(command),success=vi.fn();
 await act(async()=>{await f.result.current.prepare('candidate');});let confirmed!:Promise<void>;
 await act(async()=>{confirmed=f.result.current.confirm(success);});
 const changed={...workspace,revision:2,project:{...workspace.project,sha256:'adopted'}};f.rerender({scope:'S1',w:changed});
 await act(async()=>{adopted.resolve(changed);await confirmed;});expect(success).toHaveBeenCalledExactlyOnceWith(changed,plan);
});
it('a posted result from an abandoned owner cannot publish into a returned scope',async()=>{
 const adopted=deferred<ProductionWorkspace>(),command=vi.fn(async(name)=>name==='prepareWorkspaceCandidate'?plan:adopted.promise),f=setup(command),success=vi.fn();
 await act(async()=>{await f.result.current.prepare('candidate');});let confirmed!:Promise<void>;
 await act(async()=>{confirmed=f.result.current.confirm(success);});const reads=f.changed.mock.calls.length;
 f.rerender({scope:'S2',w:workspace});f.rerender({scope:'S1',w:workspace});
 await act(async()=>{adopted.resolve({...workspace,revision:2});await confirmed;});expect(f.changed).toHaveBeenCalledTimes(reads);expect(success).not.toHaveBeenCalled();expect(f.result.current.plan).toBeNull();
});
it('locks out a new preparation while the confirmation read is pending',async()=>{
 const command=vi.fn(async(name)=>name==='prepareWorkspaceCandidate'?plan:{...workspace,revision:2}),f=setup(command);
 await act(async()=>{await f.result.current.prepare('candidate');});const read=deferred<Response>();vi.stubGlobal('fetch',vi.fn(async()=>(await read.promise).clone()));let confirmed!:Promise<void>;
 await act(async()=>{confirmed=f.result.current.confirm();});
 let other!:Promise<void>;await act(async()=>{other=f.result.current.prepare('other');});
 await act(async()=>{read.resolve(Response.json({workspace}));await Promise.all([confirmed,other]);});
 expect(command.mock.calls.map(([name])=>name)).toEqual(['prepareWorkspaceCandidate','adoptWorkspaceCandidate']);
});
