import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import {useWorkspaceCandidateReview} from './useWorkspaceCandidateReview';
import {useWorkspaceReading} from './useWorkspaceReading';

const workspace={id:'w',episodeId:'e',revision:1,project:{sha256:'original'}} as ProductionWorkspace;
const plan={adoptionId:'adoption',candidateId:'candidate',projectSha256:'original',edit:{source:{kind:'audio'}},impact:{currentSeconds:2,sourceSeconds:4,appliedSeconds:4,deltaSeconds:2,affectedFragments:[]}} as unknown as WorkspaceCandidatePreparation;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(command:(name:string,data:unknown)=>Promise<unknown>){
 let current=workspace;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));
 const onChanged=vi.fn();
 const hook=renderHook(({scope})=>{
  const reader=useWorkspaceReading(workspace,onChanged,'S1','读取失败');
  return useWorkspaceCandidateReview({workspace,scope,reader,command});
 },{initialProps:{scope:'use-candidate'}});
 return {...hook,onChanged,setCurrent:(value:ProductionWorkspace)=>{current=value;}};
}
it('requires explicit confirmation and sends the server adoption identity with the latest revision',async()=>{
 const changed={...workspace,revision:2},command=vi.fn(async(name:string)=>name==='prepareWorkspaceCandidate'?plan:changed),f=setup(command);
 await act(async()=>{await f.result.current.prepare('candidate');});
 expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspaceCandidate',{episodeId:'e',workspaceId:'w',expectedRevision:1,candidateId:'candidate',durationPolicy:'use-candidate'});
 expect(f.result.current.plan).toEqual(plan);f.setCurrent({...workspace,revision:2});
 await act(async()=>{await f.result.current.confirm();});
 expect(command).toHaveBeenLastCalledWith('adoptWorkspaceCandidate',{episodeId:'e',workspaceId:'w',expectedRevision:2,candidateId:'candidate',adoptionId:'adoption'});
 expect(f.onChanged).toHaveBeenLastCalledWith(changed);expect(f.result.current.plan).toBeNull();
});
it('rejects an authoritative project change before confirming and does not post adoption',async()=>{
 const command=vi.fn(async()=>plan),f=setup(command);
 await act(async()=>{await f.result.current.prepare('candidate');});
 f.setCurrent({...workspace,project:{...workspace.project,sha256:'new-project'}});
 await act(async()=>{await expect(f.result.current.confirm()).rejects.toThrow('工程已变化，请重新核对采用影响。');});
 expect(command).toHaveBeenCalledTimes(1);expect(f.result.current.plan).toBeNull();
});
it('never revives a prepared plan after switching review scope away and back',async()=>{
 const command=vi.fn(async()=>plan),f=setup(command);
 await act(async()=>{await f.result.current.prepare('candidate');});
 expect(f.result.current.plan).toEqual(plan);f.rerender({scope:'keep-target'});expect(f.result.current.plan).toBeNull();
 f.rerender({scope:'use-candidate'});expect(f.result.current.plan).toBeNull();
 await act(async()=>{await f.result.current.confirm();});expect(command).toHaveBeenCalledTimes(1);
});
it('ignores a prepared response that arrives after the review owner unmounts',async()=>{
 let resolve!:(value:WorkspaceCandidatePreparation)=>void;
 const response=new Promise<WorkspaceCandidatePreparation>(done=>{resolve=done;}),command=vi.fn(()=>response),f=setup(command);let request!:Promise<void>;
 await act(async()=>{request=f.result.current.prepare('candidate');});await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));
 f.unmount();await act(async()=>{resolve(plan);await request;});expect(command).toHaveBeenCalledTimes(1);
});
