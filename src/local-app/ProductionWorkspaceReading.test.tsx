import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./WorkspaceNarrationPanel',()=>({WorkspaceNarrationPanel:({workspace,onChanged}:{workspace:ProductionWorkspace;onChanged:(w:ProductionWorkspace)=>void})=><>
 <output data-testid="parent-speech">{workspace.revision}:{workspace.narration?.[0].status}:{workspace.narration?.[0].adoptedAudioTrackId??'none'}</output>
 <button onClick={()=>onChanged({...workspace,narration:workspace.narration!.map(n=>({...n,status:'completed'}))})}>publish command result</button>
 </>}));
const workspace={id:'w',episodeId:'e',revision:3,scriptRevisionId:'script',clips:[{id:'clip',itemId:'visual',shotId:'S1',text:'第一镜',source:null}],project:{relativePath:'project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'p'},readiness:{deliverable:false,placeholders:['visual'],missingSources:[]},stale:false,narration:[{shotId:'S1',clipId:'clip',text:'已确认口播',inputFingerprint:'input',status:'running',taskId:'task'}]} as unknown as ProductionWorkspace;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>{cleanup();sessionStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
function setup(){vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path==='/api/local/connections'?{serviceCatalog:{version:1,groups:[]}}:{workspace})));}
function panel(command:(name:string,data:unknown)=>Promise<unknown>){return <ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="script" materials={[]} command={command} onLegacy={()=>{}}/>;}
it('keeps the existing first-assembly command and publishes its resulting native revision',async()=>{
 setup();const command=vi.fn(async()=>({...workspace,revision:4,narration:[{...workspace.narration![0],status:'completed',audioTrackId:'voice',adoptedAudioTrackId:'voice'}]}));
 render(panel(command));await act(async()=>{});
 expect(command).toHaveBeenCalledExactlyOnceWith('refreshWorkspaceNarration',{episodeId:'e',workspaceId:'w',expectedRevision:3});
 expect(screen.getByTestId('parent-speech').textContent).toBe('4:completed:voice');
});
it('a parent command result fences a delayed narration refresh even at the same revision',async()=>{
 setup();const slow=deferred<ProductionWorkspace>(),command=vi.fn(()=>slow.promise);render(panel(command));await act(async()=>{});
 expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('tab',{name:'字幕与口播'}));fireEvent.click(screen.getByRole('button',{name:'publish command result'}));
 await act(async()=>{slow.resolve(workspace);});expect(screen.getByTestId('parent-speech').textContent).toBe('3:completed:none');
});
it('does not overlap narration refresh commands while the previous reply is pending',async()=>{
 setup();const slow=deferred<ProductionWorkspace>(),command=vi.fn(()=>slow.promise);const view=render(panel(command));await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(command).toHaveBeenCalledTimes(1);view.unmount();await act(async()=>{slow.resolve({...workspace,revision:9});});
});
it('preserves a narration refresh conflict as an error without generating or adopting',async()=>{
 setup();const command=vi.fn(async(_name:string)=>{throw Error('工程版本已变化，请重新打开当前工作版本。');});render(panel(command));await act(async()=>{});
 expect(screen.getByRole('alert').textContent).toContain('工程版本已变化');expect(command).toHaveBeenCalledTimes(1);
 expect(command.mock.calls[0][0]).toBe('refreshWorkspaceNarration');
});

it('ignores an old refresh conflict after a newer command result was accepted',async()=>{
 setup();let reject!:(cause:Error)=>void;const slow=new Promise<ProductionWorkspace>((_resolve,fail)=>{reject=fail;});
 render(panel(vi.fn(()=>slow)));await act(async()=>{});fireEvent.click(screen.getByRole('tab',{name:'字幕与口播'}));fireEvent.click(screen.getByRole('button',{name:'publish command result'}));
 await act(async()=>{reject(Error('旧刷新版本冲突'));});expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByTestId('parent-speech').textContent).toBe('3:completed:none');
});
