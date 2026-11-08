import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act,cleanup,waitFor,within} from '@testing-library/react';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
const episode='legacy-order',script='main';
const legacySnapshot={episode:{id:episode,stage:'qc_review'},artifacts:[{id:'board-file',episode_id:episode,artifact_type:'storyboard',relative_path:'board.json',sha256:'a'.repeat(64),created_at:'2026-10-01'},{id:'render',episode_id:episode,artifact_type:'render',relative_path:'review.mp4',sha256:'b'.repeat(64),producer_task_id:'render-task',created_at:'2026-10-01'},{id:'project',episode_id:episode,artifact_type:'review_render_project',relative_path:'project.json',sha256:'c'.repeat(64),producer_task_id:'render-task',created_at:'2026-10-01'}],reviewPackages:[{id:'board',stage:'storyboard_review',revision_number:1,artifact_id:'board-file',context_snapshot:{worker_result:{storyboard:{shots:[{id:'S01',scriptSegment:'已有分镜正文',shotType:'a_roll',durationSeconds:3,productionMethod:'原画面'}]}}}},{id:'qc',stage:'qc_review',revision_number:2,artifact_id:'render',context_snapshot:{technical_evidence:{checks:[{name:'resolution',passed:true,detail:'原片分辨率通过'}]}}}],materialRevisions:[{id:script,material_type:'script',source_path:'原脚本.md',storage_path:'main.md',is_main_script:true}],shotPreparationDrafts:[],audioTracks:[],tasks:[],qcReviewIssues:[]} as unknown as EpisodeProductionSnapshot;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(snapshot:EpisodeProductionSnapshot|undefined,stage='qc_review'){
 const command=vi.fn();vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>{
 const path=String(input);if(path.includes('/legacy-project'))return Response.json({project:null});
 if(path.includes('workspace'))return Response.json({workspace:null});
 if(path.includes('main.md'))return new Response('# 已有主脚本\n\n## 正文\n保留的脚本正文');
 if(path.includes('/local-artifact-preview'))return Response.json({url:'/_local-artifact?ticket=test'});
 if(path.includes('project.json'))return Response.json({version:3,assets:[],timelines:[{id:'original',name:'原有时间线',width:360,height:640,fps:30,items:[]}]});
 return new Response('{}');
 }));
 render(<ProductionWorkspacePanel episodeId={episode} title="已有生产单" stage={stage} scriptRevisionId={script} boardId="board" materials={legacySnapshot.materialRevisions} command={command} onLegacy={()=>{}} legacySnapshot={snapshot}/>);
 return command;
}
it('shows distinct existing content at all four steps without preparing or recreating an order',async()=>{
 const command=mount(legacySnapshot);fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));await screen.findAllByText('已有分镜正文');expect(screen.queryByRole('button',{name:'准备素材匹配'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));await waitFor(()=>expect(screen.getByRole('document',{name:'主脚本预览'}).textContent).toContain('保留的脚本正文'));
 fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));await screen.findByRole('heading',{name:'已有剪辑工程'});expect(screen.getByRole('link',{name:'下载工程 project.json'})).toBeTruthy();expect(screen.queryByText('已有分镜正文')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));await screen.findByRole('heading',{name:'已有审核成片'});expect(screen.getByText('原片分辨率通过')).toBeTruthy();expect(screen.getByRole('link',{name:'下载审核成片'})).toBeTruthy();
 expect(command).not.toHaveBeenCalled();
});
it('keeps completed order inspection controls available without write controls',async()=>{
 const command=mount(legacySnapshot,'production_completed');fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));await screen.findAllByText('已有分镜正文');
 expect(screen.queryByRole('button',{name:'准备素材匹配'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));await screen.findByRole('link',{name:'下载工程 project.json'});expect((screen.getByRole('combobox',{name:'已有工程版本'}) as HTMLSelectElement).disabled).toBe(false);expect(command).not.toHaveBeenCalled();
});
it('gives new orders separate editing and export empty states instead of repeating matching controls',async()=>{
 mount(undefined,'waiting_input');fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));await screen.findByText('请先确认脚本。');fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));await screen.findByText('尚未建立剪辑工程。');expect(screen.queryByRole('button',{name:'用模型拆分镜'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));await screen.findByText('尚无导出或交付文件。');
});

it('explicitly adopts the selected native original without requesting preparation or generation',async()=>{
 const command=mount(legacySnapshot);command.mockRejectedValue(new Error('验收暂停于明确接入命令'));
 fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));const button=await screen.findByRole('button',{name:'继续编辑原工程'});
 await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));fireEvent.click(button);
 await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('adoptLegacyWorkspace',{episodeId:episode,expectedScriptRevisionId:script,reviewPackageId:'board',artifactId:'project',expectedSourceSha256:'c'.repeat(64)}));
 await screen.findByText('验收暂停于明确接入命令');
});

it('reads frozen member bindings when a pre-workbench order has no shot draft rows',async()=>{
 const frozen=structuredClone(legacySnapshot);frozen.artifacts.push({id:'old-video',episode_id:episode,artifact_type:'a_roll_video',relative_path:'old.mp4',sha256:'d'.repeat(64)} as typeof frozen.artifacts[number]);
 frozen.audioTracks=[{id:'old-audio',cue_id:'S01',relative_path:'old.mp3',sha256:'e'.repeat(64),duration_seconds:2.4} as typeof frozen.audioTracks[number]];
 frozen.reviewPackages.push({...frozen.reviewPackages[0],id:'frozen',stage:'production_ready',revision_number:1,context_snapshot:{storyboard_review_package_id:'board',members:[{member_key:'shot:S01',artifact:{id:'old-video'}},{member_key:'narration:S01',audio_track:{id:'old-audio'}}]}});
 frozen.reviewPackages[0].context_snapshot={worker_result:{storyboard:{shots:[{id:'S01',scriptSegment:'第一镜正文',durationSeconds:3},{id:'S02',scriptSegment:'第二镜正文',durationSeconds:4}]}}};
 frozen.artifacts.push({id:'second-video',episode_id:episode,artifact_type:'a_roll_video',relative_path:'second.mp4',sha256:'f'.repeat(64)} as typeof frozen.artifacts[number]);
 (frozen.reviewPackages.at(-1)!.context_snapshot as {members:unknown[]}).members.push({member_key:'shot:S02',artifact:{id:'second-video'}});
 const command=mount(frozen);fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));await screen.findByText('old.mp4');expect(screen.getByText(/已冻结旁白/)).toBeTruthy();expect(screen.queryByText('未保存画面匹配')).toBeNull();
 expect(screen.queryByRole('combobox',{name:'查看已有镜头'})).toBeNull();expect(screen.queryByRole('combobox',{name:'已有素材预览'})).toBeNull();expect(screen.queryByRole('heading',{name:'已有视觉资料'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'选择镜头 S02'}));await screen.findByText('second.mp4');const detail=document.querySelector('.legacy-preparation-detail') as HTMLElement;expect(within(detail).queryByText('old.mp4')).toBeNull();expect(within(detail).queryByText('第二镜正文')).toBeNull();expect(within(detail).getByText('S02 已选画面')).toBeTruthy();expect(command).not.toHaveBeenCalled();
});

it('does not claim an existing review video when a legacy order only has visual preparation',async()=>{
 const early=structuredClone(legacySnapshot);early.artifacts=[];early.reviewPackages=[{...early.reviewPackages[0],stage:'visual_review'}];
 const command=mount(early,'visual_review');fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));await screen.findByText('尚无审核成片。');expect(screen.getByText('尚未生成交付文件。')).toBeTruthy();expect(screen.queryByText(/已有审核成片可以查看和下载/)).toBeNull();expect(command).not.toHaveBeenCalled();
});

it('enables per-shot editing of the current HTML order explicitly from materials without asking for generation',async()=>{
 const snapshot=structuredClone(legacySnapshot);snapshot.artifacts.find(a=>a.id==='project')!.relative_path='original.html';
 const command=mount(snapshot);command.mockRejectedValue(new Error('验收停在接入'));fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));const entry=await screen.findByRole('button',{name:'启用逐镜头编辑'});await waitFor(()=>expect((entry as HTMLButtonElement).disabled).toBe(false));fireEvent.click(entry);await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('adoptLegacyWorkspace',{episodeId:episode,expectedScriptRevisionId:script,reviewPackageId:'board',artifactId:'project',expectedSourceSha256:'c'.repeat(64)}));
});

it('does not report missing production content while a completed workspace is still loading',async()=>{
 let finish!:(value:Response)=>void;vi.stubGlobal('fetch',vi.fn((input:unknown)=>String(input).includes('/workspace')?new Promise<Response>(r=>finish=r):Promise.resolve(new Response('# 主脚本'))));
 render(<ProductionWorkspacePanel episodeId={episode} title="已完成加载" stage="production_completed" scriptRevisionId={script} materials={legacySnapshot.materialRevisions} command={vi.fn()} onLegacy={()=>{}} legacySnapshot={legacySnapshot}/>);
 expect(screen.getByText('正在读取制作流程…')).toBeTruthy();expect(screen.queryByText('尚未准备')).toBeNull();expect(screen.queryByText('待确认')).toBeNull();expect(screen.queryByText('尚无审核成片。')).toBeNull();
 await act(async()=>finish(Response.json({workspace:null})));expect(await screen.findByRole('heading',{name:'已有审核成片'})).toBeTruthy();
});

it('a failed workspace read does not fall back to missing legacy content and can recover by reading again',async()=>{
 let reads=0;const command=vi.fn();vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>String(input).includes('/workspace')?(++reads===1?Response.json({error:'运行版本暂不可用'},{status:503}):Response.json({workspace:null})):new Response('# 主脚本')));
 render(<ProductionWorkspacePanel episodeId={episode} title="完成态恢复" stage="production_completed" scriptRevisionId={script} materials={legacySnapshot.materialRevisions} command={command} onLegacy={()=>{}} legacySnapshot={legacySnapshot}/>);
 await screen.findByRole('button',{name:'重新读取制作流程'});expect(screen.queryByText('尚无审核成片。')).toBeNull();expect(screen.queryByRole('heading',{name:'已有审核成片'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'重新读取制作流程'}));expect(await screen.findByRole('heading',{name:'已有审核成片'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
});
