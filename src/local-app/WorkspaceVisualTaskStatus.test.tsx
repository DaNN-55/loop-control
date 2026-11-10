import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';
const base={id:'workspace',episodeId:'episode',revision:1,stale:false,project:{sha256:'project'},clips:[{id:'clip',itemId:'target',shotId:'shot',text:'镜头'}],visualCandidates:[],selectedImages:[]} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('distinguishes unknown submission from failure and only offers a read-only reconciliation',async()=>{
 const workspace={...base,visualTasks:[{id:'unknown',taskId:'task-unknown',shotId:'shot',kind:'image' as const,status:'failed',error:'图片请求回执未收到',submissionOutcome:'started' as const,providerTaskId:null,requestState:'submitting',submissionUnknown:true,canResume:false}]};const command=vi.fn(),read=vi.fn(async()=>Response.json({workspace}));vi.stubGlobal('fetch',read);
 render(<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 expect(screen.getByText(/^图片提交结果未知/)).toBeTruthy();expect(screen.getByText(/图片请求回执未收到/)).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'查看图片任务详情'}));expect(screen.getByText(/请先在原供应商核对/)).toBeTruthy();expect(screen.queryByRole('button',{name:'恢复画面任务'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'刷新核对结果'}));await waitFor(()=>expect(read).toHaveBeenCalled());expect(command).not.toHaveBeenCalled();
});
it('held publication exposes the original attempt and reconciliation route without allowing provider retry',()=>{
 const workspace={...base,visualTasks:[{id:'held',taskId:'10000000-0000-4000-8000-000000000001',shotId:'shot',kind:'video' as const,status:'running',error:null,publicationAttempt:0,submissionOutcome:'received' as const,providerTaskId:'remote-original',canResume:false}]};
 render(<WorkspaceVisualPreparation workspace={workspace} command={vi.fn()} onChange={()=>{}} materials={[]}/>);
 expect(screen.getByText('视频发布结果待核对')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'查看视频任务详情'}));expect(screen.getByText(/10000000-0000-4000-8000-000000000001.*尝试 0/)).toBeTruthy();expect(screen.getByRole('button',{name:'核对并恢复产物'})).toBeTruthy();expect(screen.queryByRole('button',{name:'恢复画面任务'})).toBeNull();
});

it('narration retains unknown submission evidence and blocks another paid preparation',async()=>{
 const {WorkspaceNarrationPanel}=await import('./WorkspaceNarrationPanel');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const n={clipId:'clip',shotId:'shot',mode:'tts',text:'正文',status:'failed',error:null,confirmed:true,generationTask:{id:'speech',taskId:'speech-task',status:'failed',error:'语音回执未收到',reservationCents:100,connectionName:'本次语音连接',model:'seed-tts-2.0',createdAt:'2026-11-09T07:00:00.000Z',submissionOutcome:'started',submissionUnknown:true}};
 render(<WorkspaceNarrationPanel episodeId="episode" workspace={{...base,narration:[n]} as unknown as ProductionWorkspace} pending={false} command={vi.fn()} onChanged={()=>{}} selectedShotId="shot"/>);
 expect(screen.getByText(/^口播提交结果未知/)).toBeTruthy();expect((screen.getByRole('button',{name:'生成口播'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'查看口播任务详情'}));expect(screen.getByText(/¥1.00/)).toBeTruthy();expect(screen.getByText(/本次语音连接/)).toBeTruthy();expect(screen.getByText(/本机未保存供应商任务编号/)).toBeTruthy();expect(screen.getByText('speech-task')).toBeTruthy();const open=vi.fn();window.addEventListener('open-external-connections',open,{once:true});fireEvent.click(screen.getByRole('button',{name:'打开连接配置'}));expect(open).toHaveBeenCalledTimes(1);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect((screen.getByRole('button',{name:'生成口播'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('button',{name:'刷新核对结果'})).toBeTruthy();
});
it('audio publication remains explicitly recoverable and never offers ordinary retry',async()=>{
 const {WorkspaceAudioPreparation}=await import('./WorkspaceAudioPanel');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const p={id:'audio',kind:'sfx',shotId:'shot',description:'雨声',durationSeconds:1,offsetSeconds:0,anchor:'shot',taskId:'audio-task',status:'running',generationTask:{id:'audio',taskId:'audio-task',status:'running',error:null,publicationAttempt:0}};
 render(<WorkspaceAudioPreparation workspace={{...base,audio:{mix:{voices:[],sounds:[]},preparations:[p]}} as unknown as ProductionWorkspace} command={vi.fn()} onChange={()=>{}} selectedShotId="shot"/>);
 fireEvent.click(screen.getByRole('button',{name:'音效'}));
 expect(screen.getByText('音频发布结果待核对')).toBeTruthy();expect(screen.getByRole('button',{name:'核对并恢复产物'})).toBeTruthy();expect(screen.queryByRole('button',{name:'重试'})).toBeNull();
});

it('shows real image and video milestones without reporting a made-up percentage',()=>{
 const workspace={...base,visualTasks:[
  {id:'image',taskId:'image-task',shotId:'shot',kind:'image' as const,status:'running',error:null,submissionOutcome:'started' as const},
  {id:'video',taskId:'video-task',shotId:'shot',kind:'video' as const,status:'running',error:null,providerTaskId:'original',videoPhase:'queued' as const}
 ]};
 const props={command:vi.fn(),onChange:vi.fn(),materials:[]};
 const view=render(<WorkspaceVisualPreparation workspace={workspace} {...props}/>);
 const image=screen.getByRole('progressbar',{name:'图片生成进度'});
 expect(image.getAttribute('aria-valuetext')).toBe('等待供应商返回图片');
 expect(image.hasAttribute('aria-valuenow')).toBe(false);
 expect(screen.getByRole('progressbar',{name:'视频生成进度'}).getAttribute('aria-valuetext')).toBe('供应商排队中');
 view.rerender(<WorkspaceVisualPreparation workspace={{...workspace,visualTasks:[{...workspace.visualTasks[0],submissionOutcome:'received'}]}} {...props}/>);
 expect(screen.getByRole('progressbar',{name:'图片生成进度'}).getAttribute('aria-valuetext')).toBe('已收到图片，正在验证并保存');
});

it('shows a local rejection compactly and opens full details without growing the result area',async()=>{
 const {WorkspaceVisualTaskStatus}=await import('./WorkspaceVisualTaskStatus');
 const task={id:'local',taskId:'local-task',status:'failed',error:'MiniMax 参考图校验未通过，未发送到供应商。',submissionOutcome:'not_sent' as const,reservationCents:240};
 render(<WorkspaceVisualTaskStatus task={task} label="视频" onResume={vi.fn()} onRefresh={vi.fn()} onReconcile={vi.fn()}/>);
 expect(screen.queryByText(/本次请求在本机被拦截/)).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();
 screen.getByRole('button',{name:'查看视频任务详情'}).focus();fireEvent.click(screen.getByRole('button',{name:'查看视频任务详情'}));
 expect(screen.getByRole('dialog',{name:'视频任务详情'})).toBeTruthy();expect(screen.getByText(/本次请求在本机被拦截/)).toBeTruthy();
 expect(screen.queryByText(/供应商已明确拒绝/)).toBeNull();fireEvent.keyDown(window,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'查看视频任务详情'}));
});
