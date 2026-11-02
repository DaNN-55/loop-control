import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {WorkspaceVisualCandidatesPanel} from './WorkspaceVisualCandidatesPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const base={id:'workspace',episodeId:'episode',revision:1,stale:false,project:{sha256:'project'},clips:[{id:'clip',itemId:'target',shotId:'shot',text:'镜头'}],visualCandidates:[],selectedImages:[]} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it.each(['preparation','native'])('%s distinguishes unknown submission from failure and only offers a read-only reconciliation',async mode=>{
 const workspace={...base,visualTasks:[{id:'unknown',taskId:'task-unknown',shotId:'shot',kind:'image' as const,status:'failed',error:'图片请求回执未收到',submissionOutcome:'started' as const,providerTaskId:null,requestState:'submitting',submissionUnknown:true,canResume:false}]};const command=vi.fn(),read=vi.fn(async()=>Response.json({workspace}));vi.stubGlobal('fetch',read);
 const View=mode==='preparation'?WorkspaceVisualPreparation:WorkspaceVisualCandidatesPanel;
 render(<View workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 expect(screen.getByText(/^图片提交结果未知/)).toBeTruthy();expect(screen.getByText(/图片请求回执未收到/)).toBeTruthy();expect(screen.getByText(/请先在原供应商核对/)).toBeTruthy();expect(screen.queryByRole('button',{name:'恢复画面任务'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'刷新核对结果'}));await waitFor(()=>expect(read).toHaveBeenCalled());expect(command).not.toHaveBeenCalled();
});
it('held publication exposes the original attempt and reconciliation route without allowing provider retry',()=>{
 const workspace={...base,visualTasks:[{id:'held',taskId:'10000000-0000-4000-8000-000000000001',shotId:'shot',kind:'video' as const,status:'running',error:null,publicationAttempt:0,submissionOutcome:'received' as const,providerTaskId:'remote-original',canResume:false}]};
 render(<WorkspaceVisualPreparation workspace={workspace} command={vi.fn()} onChange={()=>{}} materials={[]}/>);
 expect(screen.getByText('视频发布结果待核对')).toBeTruthy();expect(screen.getByText(/原任务.*尝试 0/)).toBeTruthy();expect(screen.getByRole('button',{name:'核对并恢复产物'})).toBeTruthy();expect(screen.queryByRole('button',{name:'恢复画面任务'})).toBeNull();
});

it('narration retains unknown submission evidence and blocks another paid preparation',async()=>{
 const {WorkspaceNarrationPanel}=await import('./WorkspaceNarrationPanel');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const n={clipId:'clip',shotId:'shot',mode:'tts',text:'正文',status:'failed',error:null,confirmed:true,generationTask:{id:'speech',taskId:'speech-task',status:'failed',error:'语音回执未收到',submissionOutcome:'started',submissionUnknown:true}};
 render(<WorkspaceNarrationPanel episodeId="episode" workspace={{...base,narration:[n]} as unknown as ProductionWorkspace} pending={false} command={vi.fn()} onChanged={()=>{}} selectedShotId="shot"/>);
 expect(screen.getByText(/^口播提交结果未知/)).toBeTruthy();expect((screen.getByRole('button',{name:'确认匹配并准备口播'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('button',{name:'刷新核对结果'})).toBeTruthy();
});
it('audio publication remains explicitly recoverable and never offers ordinary retry',async()=>{
 const {WorkspaceAudioPreparation}=await import('./WorkspaceAudioPanel');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const p={id:'audio',kind:'sfx',shotId:'shot',description:'雨声',durationSeconds:1,offsetSeconds:0,anchor:'shot',taskId:'audio-task',status:'running',generationTask:{id:'audio',taskId:'audio-task',status:'running',error:null,publicationAttempt:0}};
 render(<WorkspaceAudioPreparation workspace={{...base,audio:{mix:{voices:[],sounds:[]},preparations:[p]}} as unknown as ProductionWorkspace} command={vi.fn()} onChange={()=>{}} selectedShotId="shot"/>);
 expect(screen.getByText('音频发布结果待核对')).toBeTruthy();expect(screen.getByRole('button',{name:'核对并恢复产物'})).toBeTruthy();expect(screen.queryByRole('button',{name:'重试'})).toBeNull();
});
