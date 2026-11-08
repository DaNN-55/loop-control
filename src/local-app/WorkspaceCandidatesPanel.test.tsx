import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceCandidatesPanel} from './WorkspaceCandidatesPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('preserves a local text draft across tool remounts and discards it for a newer narration input',()=>{
 const workspace={id:'workspace',episodeId:'episode',revision:1,stale:false,candidates:[],narration:[{shotId:'S1',clipId:'clip',text:'当前已保存正文',inputFingerprint:'a'.repeat(64),status:'completed'}]} as unknown as ProductionWorkspace;
 const drafts=new Map<string,{inputFingerprint:string;text:string}>(),command=vi.fn(),props={workspace,drafts,command,onChange:vi.fn()};const first=render(<WorkspaceCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('局部口播正文'),{target:{value:'尚未生成的局部改稿'}});first.unmount();const next=render(<WorkspaceCandidatesPanel {...props}/>);expect((screen.getByLabelText('局部口播正文') as HTMLTextAreaElement).value).toBe('尚未生成的局部改稿');expect(command).not.toHaveBeenCalled();
 next.rerender(<WorkspaceCandidatesPanel {...props} workspace={{...workspace,narration:[{...workspace.narration![0],inputFingerprint:'b'.repeat(64),text:'另一个已保存输入'}]}}/>);expect((screen.getByLabelText('局部口播正文') as HTMLTextAreaElement).value).toBe('另一个已保存输入');
});

const defaults={selection:{capability:'speech',provider:'test',adapter:'speech',model:'episode-voice'},voice:'本期音色',languageCode:'zh-CN',speakingRate:1};
const workspace={id:'w',episodeId:'e',revision:1,stale:false,project:{sha256:'saved-sha'},candidates:[{id:'candidate',kind:'audio',shotId:'S1',status:'available',durationSeconds:4,currentDurationSeconds:2,text:'口播',mainScriptText:'口播',relativePath:'voice.mp3'}],narration:[{shotId:'S1',clipId:'clip',text:'已保存正文',inputFingerprint:'frozen',status:'completed',defaults,selection:{capability:'speech',provider:'test',adapter:'speech',model:'voice'}}]} as unknown as ProductionWorkspace;
const plan={adoptionId:'adoption',candidateId:'candidate',projectSha256:'saved-sha',edit:{source:{kind:'audio'}},impact:{currentSeconds:2,sourceSeconds:4,appliedSeconds:4,deltaSeconds:2,affectedFragments:[{itemId:'later',label:'下一个镜头',kind:'video',startSeconds:2,endSeconds:6,changedStartSeconds:2,changedEndSeconds:4}]}};
it('shows the server impact before explicit native speech adoption and rejects a changed project',async()=>{
 let current=workspace;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));const command=vi.fn(async()=>plan),applyNativeEdit=vi.fn(),bridge={connected:true,save:vi.fn(),applyNativeEdit};
 render(<WorkspaceCandidatesPanel replacementOnly workspace={workspace} command={command} onChange={vi.fn()} bridge={bridge as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge}/>);expect(screen.queryByLabelText('局部口播正文')).toBeNull();expect(screen.queryByRole('button',{name:'生成新口播候选'})).toBeNull();fireEvent.change(screen.getByLabelText('候选时长处理'),{target:{value:'use-candidate'}});fireEvent.click(screen.getByRole('button',{name:'采用为口播主声'}));
 expect((await screen.findByRole('region',{name:'采用前核对'})).textContent).toContain('下一个镜头');expect(applyNativeEdit).not.toHaveBeenCalled();expect(command.mock.calls).toHaveLength(1);current={...workspace,project:{...workspace.project,sha256:'new-project'}};fireEvent.click(screen.getByRole('button',{name:'确认采用'}));await screen.findByText('工程已变化，请重新核对采用影响。');expect(applyNativeEdit).not.toHaveBeenCalled();expect(command.mock.calls).toHaveLength(1);
});
it.each(['unknown','publication'])('native speech %s retains recovery without posting another generation',async mode=>{
 const task={id:'task',taskId:'original-task',status:'failed',submissionUnknown:mode==='unknown',...(mode==='publication'?{publicationAttempt:0}:{})};const current={...workspace,narration:[{...workspace.narration![0],status:'failed',generationTask:task}]} as ProductionWorkspace;const fetcher=vi.fn(async(_path:string,_init?:RequestInit)=>Response.json({workspace:current}));vi.stubGlobal('fetch',fetcher);const command=vi.fn();render(<WorkspaceCandidatesPanel workspace={current} command={command} onChange={vi.fn()}/>);
 expect((screen.getByRole('button',{name:'生成新口播候选'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(mode==='unknown'?'口播提交结果未知':'口播发布结果待核对')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:mode==='unknown'?'刷新核对结果':'核对并恢复产物'}));await waitFor(()=>expect(fetcher).toHaveBeenCalled());expect(command).not.toHaveBeenCalled();if(mode==='unknown')expect(fetcher.mock.calls.every(args=>args.length===1||!(args[1] as RequestInit)?.method)).toBe(true);
});
it('requires a new impact review after leaving and returning to a duration choice',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));render(<WorkspaceCandidatesPanel workspace={workspace} command={vi.fn(async()=>plan)} onChange={vi.fn()}/>);const choice=screen.getByLabelText('候选时长处理');fireEvent.change(choice,{target:{value:'use-candidate'}});fireEvent.click(screen.getByRole('button',{name:'采用为口播主声'}));await screen.findByRole('region',{name:'采用前核对'});fireEvent.change(choice,{target:{value:'keep-target'}});expect(screen.queryByRole('region',{name:'采用前核对'})).toBeNull();fireEvent.change(choice,{target:{value:'use-candidate'}});expect(screen.queryByRole('region',{name:'采用前核对'})).toBeNull();
});
it('does not post generation when the authoritative refresh reveals an unknown speech submission',async()=>{
 const latest={...workspace,narration:[{...workspace.narration![0],generationTask:{taskId:'original',status:'failed',submissionUnknown:true}}]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:latest})));const command=vi.fn(async()=>workspace);render(<WorkspaceCandidatesPanel workspace={workspace} command={command} onChange={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'生成新口播候选'}));await screen.findByText('上次口播仍在执行或结果待核对，请先核对原任务。');expect(command).not.toHaveBeenCalled();
});
it('applies the reviewed native edit only after confirmation and adopts its saved revision',async()=>{
 let current=workspace;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));const command=vi.fn(async(name:string)=>name==='prepareWorkspaceCandidate'?plan:current),applyNativeEdit=vi.fn(async()=>{current={...workspace,revision:2,project:{...workspace.project,sha256:'adopted-sha'}};}),bridge={connected:true,save:vi.fn(),applyNativeEdit};render(<WorkspaceCandidatesPanel workspace={workspace} command={command} onChange={vi.fn()} bridge={bridge as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge}/>);fireEvent.change(screen.getByLabelText('候选时长处理'),{target:{value:'use-candidate'}});fireEvent.click(screen.getByRole('button',{name:'采用为口播主声'}));await screen.findByRole('region',{name:'采用前核对'});expect(applyNativeEdit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceCandidate',{episodeId:'e',workspaceId:'w',expectedRevision:2,candidateId:'candidate',adoptionId:'adoption',nativeApplied:true}));expect(applyNativeEdit).toHaveBeenCalledWith('apply-candidate',{edit:plan.edit});
});

it('uses the latest saved episode settings for a new candidate',async()=>{
 const latestDefaults={...defaults,speakingRate:1.25};
 const latest={...workspace,narration:[{...workspace.narration![0],defaults:latestDefaults}]} as ProductionWorkspace;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:latest})));
 const command=vi.fn(async()=>latest);
 render(<WorkspaceCandidatesPanel workspace={workspace} command={command} onChange={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'生成新口播候选'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining(latestDefaults)));
});
