import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceSourceVoicePanel} from './WorkspaceSourceVoicePanel';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const source={id:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64)};
const workspace=()=>({id:'workspace',episodeId:'episode',revision:4,clips:[{id:'clip',itemId:'video',shotId:'shot-1',text:'原镜头',source:{kind:'video',materialRevisionId:'material',relativePath:'video.mp4'},voiceInput:{version:'workspace-voice-input/v1',mode:'source',audioTrack:source,visual:{materialRevisionId:'material',sha256:'b'.repeat(64)},visualDraft:{version:'workspace-visual-draft/v1',segments:[{startSeconds:0,endSeconds:2}],composition:{version:'shot-composition/v1',layout:'full',slots:[{id:'full',fit:'cover',focalPoint:{x:.5,y:.5},clipSegmentIndex:0}]}}}}],audio:{mix:{voices:[{shotId:'shot-1',mode:'none'}],sounds:[]},preparations:[]}})as unknown as ProductionWorkspace;
const project=()=>({version:3,activeTimelineId:'timeline',assets:[],timelines:[{id:'timeline',items:[{id:'video',kind:'video',name:'原片',src:'video.mp4',sourceAssetId:'material',startFrame:0,durationInFrames:60}],tracks:{},trackOrder:[],fps:30}]})as unknown as OpenChatCutProject;
it('keeps the original voice as an unadopted choice and submits only the exact registered file on explicit adoption',async()=>{
 const w=workspace(),command=vi.fn(async()=>w),changed=vi.fn();render(<WorkspaceSourceVoicePanel workspace={w} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={changed}/>);
 expect(screen.getByText('原登记原声 · 尚未设为主声')).toBeTruthy();expect(command).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('当前原片'),{target:{value:'video'}});expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'采用原登记原声'}));await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('adoptWorkspaceRecordedVoice',{episodeId:'episode',workspaceId:'workspace',expectedRevision:4,shotId:'shot-1',audioTrackId:source.id,expectedSha256:source.sha256}));expect(changed).toHaveBeenCalledOnce();
});
it('prepares current source audio only on explicit request and keeps its ready result unadopted until a second explicit action',async()=>{
 const w=workspace();delete w.clips[0].voiceInput;
 const queued={...w,revision:5,audio:{...w.audio!,preparations:[{id:'preparation',kind:'source',shotId:'shot-1',sourceItemId:'video',description:'当前原片',status:'ready',taskId:'task',audioTrackId:null,generationTask:{taskId:'task',status:'ready'}}]}}as unknown as ProductionWorkspace;
 const ready={...queued,audio:{...queued.audio!,preparations:[{...queued.audio!.preparations[0],status:'completed',audioTrackId:source.id,relativePath:'voice.mp3',sha256:source.sha256,generationTask:{taskId:'task',status:'completed'}}]}}as unknown as ProductionWorkspace;
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceAudio'?queued:ready),changed=vi.fn();
 const view=render(<WorkspaceSourceVoicePanel workspace={w} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={changed}/>);
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'准备当前原片原声'}));await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspaceAudio',{episodeId:'episode',workspaceId:'workspace',expectedRevision:4,kind:'source',shotId:'shot-1',sourceItemId:'video'}));
 view.rerender(<WorkspaceSourceVoicePanel workspace={queued} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={changed}/>);expect(screen.queryByRole('button',{name:'采用原片原声 当前原片'})).toBeNull();
 view.rerender(<WorkspaceSourceVoicePanel workspace={ready} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={changed}/>);expect(command).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'采用原片原声 当前原片'}));await waitFor(()=>expect(command).toHaveBeenLastCalledWith('adoptWorkspaceAudio',{episodeId:'episode',workspaceId:'workspace',expectedRevision:5,preparationId:'preparation'}));
});
it('requires publication recovery before preparing the same source again and never offers adoption or retry for a held result',()=>{
 const w=workspace();delete w.clips[0].voiceInput;
 w.audio!.preparations=[{id:'held',kind:'source',shotId:'shot-1',sourceItemId:'video',description:'待核对原声',status:'completed',taskId:'task',audioTrackId:source.id,relativePath:'voice.mp3',sha256:source.sha256,generationTask:{taskId:'task',status:'completed',publicationAttempt:1}}]as unknown as NonNullable<ProductionWorkspace['audio']>['preparations'];
 const command=vi.fn();render(<WorkspaceSourceVoicePanel workspace={w} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={vi.fn()}/>);
 expect((screen.getByRole('button',{name:'准备当前原片原声'})as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('button',{name:'采用原片原声 待核对原声'})).toBeNull();expect(screen.queryByRole('button',{name:'重试原声准备'})).toBeNull();expect(screen.getByRole('button',{name:'核对并恢复产物'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
});
it('keeps an adopted registered file separate from current video extraction and only prepares on an explicit action',async()=>{
 const w=workspace();w.audio!.preparations=[{id:'recorded',kind:'source',shotId:'shot-1',sourceItemId:'video',description:'原登记原声',status:'ready',taskId:null,audioTrackId:source.id,relativePath:'voice.mp3',sha256:source.sha256,adoptedItemId:'workspace-source-shot-shot-1',source:{provider:'registered',audioTrackId:source.id}}]as unknown as NonNullable<ProductionWorkspace['audio']>['preparations'];
 const command=vi.fn().mockResolvedValue(w);render(<WorkspaceSourceVoicePanel workspace={w} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={vi.fn()}/>);
 const prepare=screen.getByRole('button',{name:'准备当前原片原声'})as HTMLButtonElement;expect(prepare.disabled).toBe(false);expect(screen.queryByRole('heading',{name:'原登记原声'})).toBeNull();expect(command).not.toHaveBeenCalled();
 fireEvent.click(prepare);await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'source',sourceItemId:'video'})));
});
it('submits an adoption once and discards its late reply after switching workspaces',async()=>{
 const w=workspace(),changed=vi.fn();let finish!:(value:ProductionWorkspace)=>void;
 const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));
 const view=render(<WorkspaceSourceVoicePanel workspace={w} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'采用原登记原声'}));fireEvent.click(screen.getByRole('button',{name:'采用原登记原声'}));await waitFor(()=>expect(command).toHaveBeenCalledOnce());
 const other={...workspace(),id:'other-workspace',episodeId:'other-episode'};view.rerender(<WorkspaceSourceVoicePanel workspace={other} project={project()} selectedShotId="shot-1" pending={false} command={command} onChanged={changed}/>);
 await act(async()=>{finish({...w,revision:5});});expect(changed).not.toHaveBeenCalled();expect(command).toHaveBeenCalledOnce();
});
it.each(['read-only','pending','stale','inactive'] as const)('does not submit a recorded source choice while %s',state=>{
 const w={...workspace(),stale:state==='stale'},command=vi.fn();render(<WorkspaceSourceVoicePanel workspace={w} project={project()} selectedShotId="shot-1" pending={state==='pending'} readOnly={state==='read-only'} active={state!=='inactive'} command={command} onChanged={vi.fn()}/>);
 const button=screen.getByRole('button',{name:'采用原登记原声'})as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(command).not.toHaveBeenCalled();
});
