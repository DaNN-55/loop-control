import {render,screen,fireEvent,waitFor,cleanup,act,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import userEvent from '@testing-library/user-event';
import {productionScriptTemplate} from '../reviews/productionScript';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {workspaceMaterialDragType} from './WorkspaceMaterialDrop';
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',storyboardPackageId:'b',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'shot-S01-clip',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'episodes/e/project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:['shot-S01-clip'],missingSources:[]},stale:false} as const;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('opens a single file picker and detects mixed media formats in one batch',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path==='/api/local/connections'?{serviceCatalog:{version:1,groups:[]}}:{workspace})));
 const command=vi.fn(async(_name:string,data:unknown)=>{
  const {sourcePath}=data as {sourcePath:string};
  return {id:sourcePath,storage_path:'episodes/e/'+sourcePath};
 });
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:'本期素材 · 0'}));
 expect(screen.getByRole('button',{name:'拖入图片加入候选'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'拖入参考图'})).toBeTruthy();
 const input=screen.getByLabelText('上传制作素材');
 const openPicker=vi.spyOn(input,'click').mockImplementation(()=>{});
 try{
  await userEvent.click(screen.getByRole('button',{name:'导入本期素材'}));
  expect(openPicker).toHaveBeenCalledOnce();
 }finally{openPicker.mockRestore();}
 expect(screen.queryByRole('menu')).toBeNull();
 expect(input).toHaveProperty('multiple',true);
 for(const extension of ['.png','.mov','.mp3'])expect(input.getAttribute('accept')).toContain(extension);
 fireEvent.change(input,{target:{files:[
  new File(['audio'],'intro.mp3',{type:'audio/mpeg'}),
  new File(['invalid'],'notes.txt',{type:'text/plain'}),
  new File(['image'],'cover.PNG',{type:'image/png'}),
  new File(['video'],'clip.mov'),
 ]}});
 expect((await screen.findByRole('status',{name:'上传提示'})).textContent).toContain('已导入 3 项，1 项失败');
 expect(command.mock.calls).toEqual([
  ['importMaterial',expect.objectContaining({materialType:'audio',materialPurpose:'general_reference',sourcePath:'intro.mp3'})],
  ['importMaterial',expect.objectContaining({materialType:'image',materialPurpose:'visual_reference',sourcePath:'cover.PNG'})],
  ['importMaterial',expect.objectContaining({materialType:'video',materialPurpose:'visual_reference',sourcePath:'clip.mov',mimeType:'application/octet-stream'})],
 ]);
 expect(screen.getByRole('alert').textContent).toContain('notes.txt');
 expect(screen.getByRole('button',{name:'收起本期素材'}).textContent).toBe('本期素材 · 3');
 expect(within(screen.getByRole('list',{name:'素材清单'})).getAllByRole('listitem')).toHaveLength(3);
});
it('shows a dismissible success toast from the actual shelf upload and retains the imported material',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async()=>({id:'image',storage_path:'episodes/e/image.png'}));
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:'本期素材 · 0'}));
 fireEvent.change(screen.getByLabelText('上传制作素材'),{target:{files:[new File(['image'],'image.png',{type:'image/png'})]}});
 expect((await screen.findByRole('status',{name:'上传提示'})).textContent).toContain('已导入 1 项素材');
 fireEvent.click(screen.getByRole('button',{name:'关闭上传提示'}));expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();
 expect(screen.getByRole('button',{name:'收起本期素材'}).textContent).toBe('本期素材 · 1');expect(within(screen.getByRole('list',{name:'素材清单'})).getByRole('button',{name:'预览 image.png'})).toBeTruthy();expect(screen.getByText('已导入 1 项素材')).toBeTruthy();expect(command).toHaveBeenCalledExactlyOnceWith('importMaterial',expect.objectContaining({sourcePath:'image.png'}));
});
it('shows shelf validation failures in the same toast and can reopen their retained details',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn();
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:'本期素材 · 0'}));
 fireEvent.change(screen.getByLabelText('上传制作素材'),{target:{files:[new File(['text'],'notes.txt',{type:'text/plain'})]}});
 expect((await screen.findByRole('status',{name:'上传提示'})).textContent).toContain('已导入 0 项，1 项失败');
 fireEvent.click(screen.getByRole('button',{name:'收起本期素材'}));fireEvent.click(screen.getByRole('button',{name:'查看'}));
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('素材导入结果')));
 expect(within(screen.getByLabelText('素材导入结果')).getByRole('alert').textContent).toContain('notes.txt');expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'关闭上传提示'}));expect(within(screen.getByLabelText('素材导入结果')).getByRole('alert').textContent).toContain('请选择图片、视频或 MP3');
});
function startMaterialDrag(source:HTMLElement){
 const data=new Map<string,string>();
 const dataTransfer={get types(){return [...data.keys()];},setData:(type:string,value:string)=>data.set(type,value),getData:(type:string)=>data.get(type)??''};
 fireEvent.dragStart(source,{dataTransfer});
 expect(dataTransfer.types).toContain(workspaceMaterialDragType);
 return dataTransfer;
}
function dragMaterial(source:HTMLElement,target:HTMLElement){
 const dataTransfer=startMaterialDrag(source);
 fireEvent.dragOver(target,{dataTransfer});
 fireEvent.drop(target,{dataTransfer});
 fireEvent.dragEnd(source,{dataTransfer});
}
const shelfMaterial=(id:string,source_path:string,material_type:string,material_purpose='visual_reference')=>({
 id,source_path,material_type,material_purpose,storage_path:'episodes/e/'+source_path,is_main_script:false,
});
it('shows both large image drop zones and removes an unused candidate without adopting it',async()=>{
 const candidates:Array<{id:string;kind:string;usage:string;status:string;relativePath:string;targetItemId:string;materialRevisionId?:string}>=[{id:'previous',kind:'image',usage:'still',status:'available',relativePath:'episodes/e/previous.png',targetItemId:'shot-S01-clip'},
  {id:'protected',kind:'image',usage:'still',status:'adopted',relativePath:'episodes/e/protected.png',targetItemId:'shot-S01-clip'}];
 let latest={...workspace,visualCandidates:candidates};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:latest})));
 const command=vi.fn(async(name:string,data:unknown)=>{
  if(name==='importMaterial')return {id:'dropped-image',storage_path:'episodes/e/frame.png'};
  if(name==='registerWorkspaceVisualCandidate'&&(data as {materialRevisionId:string}).materialRevisionId==='dropped-image'){
   latest={...latest,visualCandidates:[{...candidates[0],id:'new',relativePath:'episodes/e/frame.png',materialRevisionId:'dropped-image'},...candidates]};
  }
  if(name==='registerWorkspaceVisualCandidate'&&(data as {materialRevisionId:string}).materialRevisionId==='video'){
   latest={...latest,visualCandidates:[{...candidates[0],id:'video-candidate',kind:'video',usage:'video',relativePath:'episodes/e/clip.mp4',materialRevisionId:'video'},...latest.visualCandidates]};
  }
  if(name==='rejectWorkspaceVisualCandidate')latest={...latest,visualCandidates:latest.visualCandidates.filter(c=>c.id!=='new')};
  return latest;
 });
 const {container}=render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s"
  materials={[shelfMaterial('video','clip.mp4','video')]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');
 fireEvent.drop(container.querySelector('.workspace-material-shelf')!,{
  dataTransfer:{files:[new File(['image'],'frame.png',{type:'image/png'})]},
 });
 const image=await screen.findByRole('button',{name:'预览 frame.png'});
 const video=screen.getByRole('button',{name:'预览 clip.mp4'});
 expect(screen.queryByRole('group',{name:'图片来源'})).toBeNull();
 expect(screen.queryByRole('button',{name:'拖入图片加入候选'})).toBeNull();
 fireEvent.dragEnd(video,{dataTransfer:startMaterialDrag(video)});
 expect(screen.queryByRole('button',{name:'拖入图片加入候选'})).toBeNull();
 expect(command).toHaveBeenCalledExactlyOnceWith('importMaterial',expect.objectContaining({
  materialType:'image',materialPurpose:'visual_reference',sourcePath:'frame.png',
 }));
 const dataTransfer=startMaterialDrag(image);
 const imageTarget=screen.getByRole('button',{name:'拖入图片加入候选'});
 expect(imageTarget.getAttribute('data-surface')).toBe('preview');
 expect(screen.getByRole('button',{name:'拖入参考图'}).closest('.workspace-reference-surface')).toBeTruthy();
 fireEvent.drop(imageTarget,{dataTransfer});
 fireEvent.dragEnd(image,{dataTransfer});
 await waitFor(()=>expect(command).toHaveBeenNthCalledWith(2,'registerWorkspaceVisualCandidate',expect.objectContaining({
  targetItemId:'shot-S01-clip',materialRevisionId:'dropped-image',
 })));
 dragMaterial(image,screen.getByRole('button',{name:'拖入参考图'}));
 expect(screen.queryByRole('button',{name:'拖入参考图'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'移除参考图 1'}));
 expect(screen.getByRole('button',{name:'拖入参考图'})).toBeTruthy();
 expect(screen.queryByText('从本期素材选取')).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'预览图片候选 01'}).getAttribute('aria-pressed')).toBe('true'));
 expect(screen.getByRole('button',{name:'预览图片候选 03'})).toBeTruthy();

 fireEvent.click(screen.getByRole('button',{name:'移除候选'}));
 await waitFor(()=>expect(command).toHaveBeenNthCalledWith(3,'rejectWorkspaceVisualCandidate',expect.objectContaining({candidateId:'new'})));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'预览图片候选 03'})).toBeNull());
 expect(screen.queryByRole('button',{name:'上传素材'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));
 expect(screen.getByRole('button',{name:'拖入视频加入候选'})).toBeTruthy();
 const firstFrameTarget=screen.getByLabelText('视频生成输入框');
 dragMaterial(image,firstFrameTarget);
 const firstFrame=screen.getByAltText('已选视频首帧');
 expect(screen.getByRole('button',{name:'添加画面参考素材'})).toBeTruthy();
 const frameDrag=startMaterialDrag(image);
 expect(screen.getByLabelText('视频生成输入框').contains(firstFrame)).toBe(true);
 fireEvent.dragEnd(image,{dataTransfer:frameDrag});
 fireEvent.click(screen.getByRole('button',{name:'清除首帧'}));
 expect(screen.queryByRole('combobox',{name:'画面首帧图片'})).toBeNull();
 expect(screen.queryByAltText('已选视频首帧')).toBeNull();
 expect(screen.getByRole('button',{name:'添加画面参考素材'})).toBeTruthy();
 fireEvent.click(video);
 const videoTarget=screen.getByRole('button',{name:'拖入视频加入候选'});
 expect(videoTarget.getAttribute('aria-disabled')).toBeNull();
 fireEvent.click(videoTarget);
 await waitFor(()=>expect(command).toHaveBeenNthCalledWith(4,'registerWorkspaceVisualCandidate',expect.objectContaining({
  targetItemId:'shot-S01-clip',materialRevisionId:'video',usage:'video',
 })));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'拖入视频加入候选'})).toBeNull());
 const videoDrag=startMaterialDrag(video);
 expect(screen.getByRole('button',{name:'拖入视频加入候选'})).toBeTruthy();
 fireEvent.dragEnd(video,{dataTransfer:videoDrag});
 expect(screen.queryByRole('button',{name:'拖入视频加入候选'})).toBeNull();
 expect(command).toHaveBeenCalledTimes(4);
});
it('accepts one unassigned MP3 for voice and queues local audio candidates without adopting them',async()=>{
 const withNarration={...workspace,narration:[{shotId:'S01',clipId:'clip',enabled:true,mode:'none',status:'draft',text:'第一镜口播'}]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:withNarration})));
 const command=vi.fn().mockResolvedValue(withNarration);
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" command={command} onLegacy={()=>{}}
  materials={[shelfMaterial('audio','unassigned.mp3','audio','general_reference'),shelfMaterial('music','music.mp3','audio','background_music')]}/>);
 await screen.findByText('第一镜');
 fireEvent.click(screen.getByRole('button',{name:'本期素材 · 2'}));
 const audio=screen.getByRole('button',{name:'预览 unassigned.mp3'}),music=screen.getByRole('button',{name:'预览 music.mp3'});
 fireEvent.click(screen.getByRole('tab',{name:'字幕与口播'}));
 fireEvent.click(screen.getByRole('button',{name:'口播来源'}));
 fireEvent.click(screen.getByRole('menuitemradio',{name:'人工口播'}));
 expect(screen.getByRole('button',{name:'口播来源'}).textContent).toContain('人工口播');
 const musicDrag=startMaterialDrag(music);
 expect(screen.getByRole('button',{name:'拖入口播文件'}).getAttribute('data-drag-over')).toBeNull();
 fireEvent.dragEnd(music,{dataTransfer:musicDrag});
 expect(screen.getByRole('button',{name:'加入候选'})).toHaveProperty('disabled',true);
 const voiceDrag=startMaterialDrag(audio);
 const voiceTarget=screen.getByRole('button',{name:'拖入口播文件'});
 fireEvent.dragOver(voiceTarget,{dataTransfer:voiceDrag});
 fireEvent.drop(voiceTarget,{dataTransfer:voiceDrag});
 fireEvent.dragEnd(audio,{dataTransfer:voiceDrag});
 expect(screen.getByRole('button',{name:'拖入口播文件，已选 unassigned.mp3'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'加入候选'})).toBeTruthy();
 expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'配乐与声音'}));
 for(const [kind,label] of [['bgm','整期配乐'],['sfx','音效']] as const){
  fireEvent.click(screen.getByRole('button',{name:label}));
  const transfer=startMaterialDrag(audio),target=screen.getByRole('button',{name:kind==='bgm'?'使用已选配乐':'使用已选音效'});
  fireEvent.dragOver(target,{dataTransfer:transfer});fireEvent.drop(target,{dataTransfer:transfer});fireEvent.dragEnd(audio,{dataTransfer:transfer});
  await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind,materialRevisionId:'audio'})));
 }
 expect(command.mock.calls.map(call=>call[0])).toEqual(['prepareWorkspaceAudio','prepareWorkspaceAudio']);
});
it('four-step navigation reads durable state and does not submit approvals or generation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" boardId="b" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('button',{name:/^分镜台/});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));});expect(screen.getByText('还有 1 处占位')).toBeTruthy();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));});expect(command).not.toHaveBeenCalled();
});
it('automatically prepares the persisted storyboard draft',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn(async()=>workspace);render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" boardId="b" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');expect(command).toHaveBeenCalledWith('prepareWorkspace',{episodeId:'e',reviewPackageId:'b',expectedScriptRevisionId:'s'});
});
it('shows the four-step shell on a new episode without mounting old workflow actions',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="fresh" title="新单" stage="waiting_input" scriptRevisionId={null} materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('navigation',{name:'四步制作步骤'});expect(screen.getByRole('textbox',{name:'主脚本'})).toBeTruthy();expect(screen.queryByRole('button',{name:'旧分镜批准'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));expect(command).not.toHaveBeenCalled();expect(screen.getByText('请先确认脚本。')).toBeTruthy();
});
it('keeps an unsaved script draft while navigating read-only steps',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 render(<ProductionWorkspacePanel episodeId="fresh" title="新单" stage="waiting_input" scriptRevisionId={null} materials={[]} command={vi.fn()} onLegacy={()=>{}}/>);
 await screen.findByRole('textbox',{name:'主脚本'});fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'未提交的脚本草稿'}});fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('未提交的脚本草稿');
});
it('requires an explicit recovery choice before replacing a legacy working edit',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn().mockRejectedValueOnce(Error('发现旧剪辑工作版本，请明确保留或封存。')).mockResolvedValue(workspace);
 render(<ProductionWorkspacePanel episodeId="e" title="工程" stage="script_approved" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('region',{name:'旧剪辑工作版本处理'});expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'保留旧编辑并继续'}));await screen.findByText('第一镜');expect(command).toHaveBeenLastCalledWith('prepareWorkspace',{episodeId:'e',expectedScriptRevisionId:'s',legacyDecision:'preserve'});
});
it('shows only analysis progress during preparation and retries the same local action on failure',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:null})));
 let fail!:(error:Error)=>void;
 const command=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;})).mockResolvedValueOnce(workspace);
 render(<ProductionWorkspacePanel episodeId="e" title="工程" stage="script_approved" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('正在分析脚本并拆分镜头…');
 expect(screen.queryByRole('button',{name:'导入本期素材'})).toBeNull();
 expect(screen.queryByRole('heading',{name:'分镜台'})).toBeNull();
 await act(async()=>fail(Error('分镜文件无法写入')));
 expect(screen.getByRole('alert').textContent).toContain('分镜文件无法写入');
 fireEvent.click(screen.getByRole('button',{name:'重试'}));
 await screen.findByText('第一镜');
 expect(command.mock.calls).toEqual(Array(2).fill(['prepareWorkspace',{episodeId:'e',expectedScriptRevisionId:'s'}]));
});

it('keeps the workspace visible if an older backend returns a planning receipt',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:null})));
 const command=vi.fn().mockResolvedValue({planning:true,taskId:'old-plan',status:'ready'});
 render(<ProductionWorkspacePanel episodeId="e" title="工程" stage="script_approved" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 expect((await screen.findByRole('alert')).textContent).toContain('后端仍在使用旧版分镜流程');
 expect(screen.getByRole('navigation',{name:'四步制作步骤'})).toBeTruthy();
});

it('preserves image and video prompt drafts when switching the unified tabs',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('tab',{name:'图片'});fireEvent.change(screen.getByLabelText('图片提示词'),{target:{value:'保留图片草稿'}});fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'保留视频动作'}});fireEvent.click(screen.getByRole('tab',{name:'图片'}));expect((screen.getByLabelText('图片提示词') as HTMLTextAreaElement).value).toBe('保留图片草稿');fireEvent.click(screen.getByRole('tab',{name:'视频'}));expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('保留视频动作');expect(command).not.toHaveBeenCalled();
});
it('disables workspace write forms on a completed order even when legacy content remains inspectable',async()=>{
 const legacy={episode:{id:'e'},reviewPackages:[],artifacts:[{id:'old-final',episode_id:'e',artifact_type:'final_render',relative_path:'episodes/e/old-final.mp4',sha256:'f'.repeat(64),created_at:'2026-10-30'}],materialRevisions:[],audioTracks:[]} as unknown as import('../episodes/episodeSnapshot').EpisodeProductionSnapshot;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));render(<ProductionWorkspacePanel episodeId="e" title="已完成工程" stage="production_completed" scriptRevisionId="s" materials={[]} command={vi.fn()} onLegacy={()=>{}} legacySnapshot={legacy}/>);await screen.findByText('先导出最终视频，检查后确认这份文件。');fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));expect(await screen.findByText('已完成工程',{selector:'h3'})).toBeTruthy();expect(screen.getByRole('button',{name:/^剪辑工作台/}).textContent).toContain('只读');expect(screen.getByRole('article',{name:'S01 镜头配置'})).toBeTruthy();expect(screen.queryByRole('button',{name:'保存字幕'})).toBeNull();expect(screen.queryByRole('combobox',{name:'字幕片段'})).toBeNull();expect(screen.getByRole('article',{name:'S01 镜头配置'}).querySelector('details')).toBeNull();fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));fireEvent.click(screen.getByRole('tab',{name:'字幕与口播'}));expect((screen.getByRole('tab',{name:'画面'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'选择镜头 01'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));expect(screen.queryByRole('button',{name:'正在导出与检查…'})).toBeNull();
});
it('keeps another shot’s video generation draft when adopting an image advances the project',async()=>{
 const second={id:'clip2',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜',source:null};
 const candidate={id:'candidate-picture',kind:'image',usage:'still',clipId:second.id,shotId:second.shotId,targetItemId:second.itemId,taskId:null,inputFingerprint:'i'.repeat(64),relativePath:'picture.png',sha256:'p'.repeat(64),fileSize:10,durationSeconds:3,currentDurationSeconds:3,status:'available',width:100,height:100,materialRevisionId:'picture'};
 const initial={...workspace,clips:[...workspace.clips,second],visualCandidates:[candidate]},next={...initial,revision:2,project:{...workspace.project,sha256:'b'.repeat(64)}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:initial})));const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?{adoptionId:'adoption',candidateId:'candidate-picture',projectSha256:workspace.project.sha256,edit:{targetItemId:second.itemId},impact:{currentSeconds:3,sourceSeconds:3,appliedSeconds:3,deltaSeconds:0,startSeconds:0,endSeconds:3,fps:30,affectedFragments:[]}}:next);
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'第一镜未提交的动作'}});fireEvent.click(screen.getByRole('button',{name:'选择镜头 02'}));fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01'}));fireEvent.click(screen.getByRole('button',{name:'采用图片到当前镜头'}));await screen.findByRole('group',{name:'采用前核对'});expect(command).not.toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',expect.anything());fireEvent.click(screen.getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',expect.objectContaining({candidateId:'candidate-picture',adoptionId:'adoption'})));fireEvent.click(screen.getByRole('button',{name:'选择镜头 01'}));expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一镜未提交的动作');
});
it('keeps one delivery form and its metadata, cover and issue drafts across workflow navigation',async()=>{
 vi.stubGlobal('URL',class extends URL {static createObjectURL=vi.fn(()=>'blob:cover');static revokeObjectURL=vi.fn();});
 const w={...workspace,exports:[{id:'export',status:'ready',current:true,confirmed:true,checks:[],projectContentVersion:1,contentSha256:'content',artifact:{relativePath:'episodes/e/final.mp4',sha256:'final',fileSize:123}}]};
 const command=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('textbox',{name:'标题'});fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'未提交的交付标题'}});fireEvent.change(screen.getByRole('textbox',{name:'标签'}),{target:{value:'晨光,山野'}});fireEvent.change(screen.getByRole('textbox',{name:'简介'}),{target:{value:'未提交的交付说明'}});fireEvent.change(screen.getByRole('textbox',{name:'问题记录'}),{target:{value:'待提交的问题'}});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],'draft-cover.png',{type:'image/png'})]}});
 await screen.findByRole('img',{name:'交付封面预览'});fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));expect((screen.getByRole('textbox',{name:'标题'}) as HTMLInputElement).value).toBe('未提交的交付标题');expect((screen.getByRole('textbox',{name:'标签'}) as HTMLInputElement).value).toBe('晨光,山野');expect((screen.getByRole('textbox',{name:'简介'}) as HTMLTextAreaElement).value).toBe('未提交的交付说明');expect((screen.getByRole('textbox',{name:'问题记录'}) as HTMLTextAreaElement).value).toBe('待提交的问题');expect(screen.getByText('draft-cover.png')).toBeTruthy();expect(document.querySelectorAll('input[aria-label="封面"]')).toHaveLength(1);expect(command).not.toHaveBeenCalled();
});
it('pauses delivery polling while its retained draft tree is hidden and resumes one interval on return',async()=>{
 vi.useFakeTimers();try{
  const w={...workspace,deliveries:[{id:'delivery',status:'running'}]},command=vi.fn(),fetcher=vi.fn(async(_input:unknown)=>Response.json({workspace:w}));vi.stubGlobal('fetch',fetcher);await act(async()=>{render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);});fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));const reads=()=>fetcher.mock.calls.filter(([input])=>String(input).endsWith('/workspace')).length;
  const before=reads();await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});expect(reads()).toBe(before+1);fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));const hidden=reads();await act(async()=>{await vi.advanceTimersByTimeAsync(7500);});expect(reads()).toBe(hidden);fireEvent.click(screen.getByRole('button',{name:/^检查与交付/}));await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});expect(reads()).toBe(hidden+1);expect(command).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});

it('preserves an explicit script step while the initial workspace finishes loading',async()=>{
 let resolve:(value:Response)=>void=()=>{};const first=new Promise<Response>(r=>{resolve=r;});let reads=0;vi.stubGlobal('fetch',vi.fn(async()=>++reads===1?first:Response.json({workspace})));render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={vi.fn()} onLegacy={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));await act(async()=>{resolve(Response.json({workspace:{...workspace,nativeEditRevision:2}}));});await waitFor(()=>expect(screen.getByRole('button',{name:/^脚本确认/}).getAttribute('aria-current')).toBe('page'));
});

it('enters the existing native project directly from the editing step without rebuilding it',async()=>{
 const readyWorkspace={...workspace,readiness:{...workspace.readiness,placeholders:[]}};
 const command=vi.fn(async()=>({studioUrl:'http://127.0.0.1:5001/#/editor/loop-control-e',workspace:{projectId:'loop-control-e',relativePath:'episodes/e/project.json',sha256:workspace.project.sha256},productionWorkspace:readyWorkspace}));vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:readyWorkspace})));render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));await screen.findByTitle('OpenChatCut 剪辑工程');expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenCalledWith('openWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:1});expect(screen.queryByRole('button',{name:'打开剪辑工作台'})).toBeNull();
});
it('keeps project history out of the four-step interface without changing records',async()=>{
 const w={...workspace,recovery:{decision:'preserve',sha256:'old-project',relativePath:'old.json',fileSize:10},history:[{revision:1,sha256:'saved-project',scriptRevisionId:'s',reason:'保存原编辑'}]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn();const{container}=render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}} historicalReadOnly/>);await screen.findByText('第一镜');
 for(const name of ['脚本确认','分镜台','剪辑工作台','检查与交付']){fireEvent.click(screen.getByRole('button',{name:new RegExp('^'+name)}));expect(container.querySelector('.workspace-version-history')).toBeNull();expect(screen.queryByRole('button',{name:'查看所选工程'})).toBeNull();}expect(command).not.toHaveBeenCalled();
});

it('keeps a revised pending script on step one while preserving the stale saved project',async()=>{
 const command=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:{...workspace,nativeEditRevision:2,stale:true}})));render(<ProductionWorkspacePanel episodeId="e" title="待确认修订" scriptRevisionId="new" stage="waiting_input" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('脚本修改待确认，原工程已暂停编辑。请先确认脚本，原工程与素材均已保留。');expect(screen.getByRole('button',{name:/^脚本确认/}).getAttribute('aria-current')).toBe('page');expect(screen.getByRole('textbox',{name:'主脚本'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
});

it('reuses the saved script revision when continuing an existing workspace without a second reason',async()=>{
 const changed={...workspace,scriptRevisionId:'script-new',revision:2};const command=vi.fn(async(name:string)=>name==='reconfirmScript'?{id:'script-new'}:name==='replanWorkspace'?changed:{});
 vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>String(input).includes('_local-artifact')?new Response('原脚本'):Response.json({workspace})));
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[{id:'s',material_type:'script',source_path:'script.md',storage_path:'script.md',is_main_script:true}]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:/^脚本确认/}));await screen.findByRole('document',{name:'主脚本预览'});fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'调整后的脚本'}});fireEvent.change(screen.getByRole('textbox',{name:'脚本修订原因'}),{target:{value:'调整叙事顺序'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('replanWorkspace',{episodeId:'e',workspaceId:'w',expectedRevision:1,expectedScriptRevisionId:'script-new',reason:'调整叙事顺序'}));expect(screen.queryByRole('textbox',{name:'重规划原因'})).toBeNull();expect(command).toHaveBeenCalledWith('reconfirmScript',expect.objectContaining({reason:'调整叙事顺序'}));
});

it('blocks entering the editor until every shot has an adopted readable visual',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:/^剪辑工作台/}));expect(await screen.findByText('请先为每个镜头采用可用的图片或视频，再进入剪辑工作台。')).toBeTruthy();expect(command).not.toHaveBeenCalled();expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();});

it('deletes only the selected material shot after confirmation and selects the remaining neighbor',async()=>{
 const second={id:'clip2',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜',source:null},two={...workspace,clips:[...workspace.clips,second]},next={...workspace,revision:2};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:two})));const command=vi.fn(async()=>next);render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:'选择镜头 02'}));await userEvent.click(screen.getByRole('button',{name:'镜头 02操作'}));await userEvent.click(await screen.findByRole('menuitem',{name:'删除镜头'}));expect(screen.getByRole('dialog',{name:'删除镜头'}).textContent).toContain('第二镜');expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:/^取消$/}));expect(screen.queryByRole('dialog')).toBeNull();expect(command).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'镜头 02操作'}));await userEvent.click(await screen.findByRole('menuitem',{name:'删除镜头'}));fireEvent.click(screen.getByRole('button',{name:'确认删除镜头'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(command).toHaveBeenCalledExactlyOnceWith('editWorkspaceStructure',{episodeId:'e',workspaceId:'w',expectedRevision:1,operation:{kind:'remove',shotId:'S02'}});expect(screen.queryByRole('button',{name:'选择镜头 02'})).toBeNull();expect(screen.getByRole('button',{name:'选择镜头 01'}).getAttribute('aria-pressed')).toBe('true');await userEvent.click(screen.getByRole('button',{name:'镜头 01操作'}));expect((await screen.findByRole('menuitem',{name:'删除镜头'})).getAttribute('aria-disabled')).toBe('true');
});
it('keeps the selected shot and deletion dialog when the saved revision is stale',async()=>{
 const two={...workspace,clips:[...workspace.clips,{id:'clip2',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜',source:null}]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:two})));const command=vi.fn(async()=>{throw Error('工程版本已变化，请刷新后重试。');});render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');await userEvent.click(screen.getByRole('button',{name:'镜头 01操作'}));await userEvent.click(await screen.findByRole('menuitem',{name:'删除镜头'}));fireEvent.click(screen.getByRole('button',{name:'确认删除镜头'}));await screen.findByText('工程版本已变化，请刷新后重试。');expect(screen.getByRole('dialog',{name:'删除镜头'})).toBeTruthy();expect(screen.getByRole('button',{name:'选择镜头 01'})).toBeTruthy();expect(screen.getByRole('button',{name:'选择镜头 02'})).toBeTruthy();
});

it('appends a shot after the final shot and selects it only after the saved result returns',async()=>{
 const second={id:'clip2',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜',source:null},added={id:'clip3',itemId:'shot-added-clip',shotId:'added-clip3',text:'追加镜头',source:null},two={...workspace,clips:[...workspace.clips,second]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:two})));let resolve!:(value:unknown)=>void;const command=vi.fn(()=>new Promise(done=>{resolve=done;}));render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');const add=screen.getByRole('button',{name:'新增镜头'});expect(add.closest('td')?.colSpan).toBe(6);fireEvent.click(add);fireEvent.change(screen.getByRole('textbox',{name:'新镜头文案'}),{target:{value:'追加镜头'}});fireEvent.submit(screen.getByRole('textbox',{name:'新镜头文案'}).closest('form')!);fireEvent.submit(screen.getByRole('textbox',{name:'新镜头文案'}).closest('form')!);
 expect(command).toHaveBeenCalledExactlyOnceWith('editWorkspaceStructure',{episodeId:'e',workspaceId:'w',expectedRevision:1,operation:{kind:'insert',afterShotId:'S02',text:'追加镜头'}});expect(screen.getByRole('button',{name:'选择镜头 01'}).getAttribute('aria-pressed')).toBe('true');await act(async()=>resolve({...two,revision:2,clips:[...two.clips,added]}));expect(screen.getByRole('button',{name:'选择镜头 03'}).getAttribute('aria-pressed')).toBe('true');expect(screen.queryByRole('textbox',{name:'新镜头文案'})).toBeNull();
});
it('retains an insert draft and the saved shot order when a structure update fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async()=>{throw Error('工程版本已变化，请刷新后重试。');});render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:'新增镜头'}));const text=screen.getByRole('textbox',{name:'新镜头文案'});fireEvent.change(text,{target:{value:'未保存的新镜头'}});fireEvent.submit(text.closest('form')!);await screen.findByText('工程版本已变化，请刷新后重试。');expect((text as HTMLTextAreaElement).value).toBe('未保存的新镜头');expect(screen.getAllByRole('row',{name:/^镜头 \d/})).toHaveLength(1);
});
it('saves row drag and keyboard sorting through the revisioned move command without changing selection',async()=>{
 const second={id:'clip2',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜',source:null},two={...workspace,clips:[...workspace.clips,second]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:two})));const command=vi.fn().mockResolvedValueOnce({...two,revision:2,clips:[second,...workspace.clips]}).mockResolvedValueOnce({...two,revision:3});render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');
 const dataTransfer={setData:vi.fn(),effectAllowed:'',dropEffect:''};fireEvent.dragStart(screen.getByRole('row',{name:'镜头 02'}),{dataTransfer});fireEvent.drop(screen.getByRole('row',{name:'镜头 01'}),{dataTransfer});await waitFor(()=>expect(screen.getAllByRole('row',{name:/^镜头 \d/})[0].textContent).toContain('第二镜'));expect(command).toHaveBeenLastCalledWith('editWorkspaceStructure',{episodeId:'e',workspaceId:'w',expectedRevision:1,operation:{kind:'move',shotId:'S02',beforeShotId:'S01'}});expect(screen.getByRole('button',{name:'选择镜头 02'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.keyDown(screen.getByRole('row',{name:'镜头 01'}),{key:'ArrowDown',altKey:true});await waitFor(()=>expect(command).toHaveBeenLastCalledWith('editWorkspaceStructure',{episodeId:'e',workspaceId:'w',expectedRevision:2,operation:{kind:'move',shotId:'S02',beforeShotId:null}}));await waitFor(()=>expect(screen.getAllByRole('row',{name:/^镜头 \d/})[0].textContent).toContain('第一镜'));
});
it('disables row actions and sorting on historical read-only orders while retaining shot selection',async()=>{
 const second={id:'clip2',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜',source:null};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:{...workspace,clips:[...workspace.clips,second]}})));const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="历史" historicalReadOnly scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByText('第一镜');expect(screen.queryByRole('button',{name:'新增镜头'})).toBeNull();expect(screen.queryByRole('button',{name:'镜头 01操作'})).toBeNull();expect(screen.getByRole('row',{name:'镜头 01'}).draggable).toBe(false);fireEvent.keyDown(screen.getByRole('row',{name:'镜头 01'}),{key:'ArrowDown',altKey:true});fireEvent.click(screen.getByRole('row',{name:'镜头 02'}));expect(screen.getByRole('button',{name:'选择镜头 02'}).getAttribute('aria-pressed')).toBe('true');expect(command).not.toHaveBeenCalled();
});

it('keeps the stale reason visible and explicitly resumes formatting-only revisions without recreating the project',async()=>{
 const stale={...workspace,stale:true,scriptResume:{canReuse:true,reason:'脚本仅有排版变更，可确认修订并沿用原工程。'}};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:stale})));const command=vi.fn(async()=>({...workspace,revision:2,scriptRevisionId:'current'}));render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="current" stage="waiting_input" materials={[]} command={command} onLegacy={()=>{}}/>);
 const action=await screen.findByRole('button',{name:'确认排版修订，继续原工程'});expect(screen.getByRole('region',{name:'恢复原工程'})).toBeTruthy();expect(command).not.toHaveBeenCalled();fireEvent.click(action);await waitFor(()=>expect(command).toHaveBeenCalledWith('resumeWorkspaceEditing',{episodeId:'e',workspaceId:'w',expectedRevision:1,expectedScriptRevisionId:'current',expectedProjectSha256:workspace.project.sha256}));expect(command).toHaveBeenCalledTimes(1);
});

it('returns from budget settings to the original preparation target without auto-opening an existing native edit',async()=>{
 const command=vi.fn(),second={...workspace.clips[0],id:'second',itemId:'shot-S02-clip',shotId:'S02',text:'第二镜'},saved={...workspace,nativeEditRevision:2,clips:[...workspace.clips,second],readiness:{deliverable:true,placeholders:[],missingSources:[]}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:saved})));
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}} preparationEntry={{shotId:'S02',targetItemId:'shot-S02-clip'}}/>);
 await screen.findByRole('row',{name:'镜头 02'});expect(screen.getByRole('button',{name:/^分镜台/}).getAttribute('aria-current')).toBe('page');expect(screen.getByRole('button',{name:'选择镜头 02'}).getAttribute('aria-pressed')).toBe('true');expect(screen.queryByRole('region',{name:'整期剪辑工作台'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('keeps AudioSkin playback enabled in a completed order while narration and music show read-only facts',async()=>{
 const completed={...workspace,narration:[{shotId:'S01',clipId:'clip',mode:'manual',status:'completed',text:'已有口播',durationSeconds:6}],usedNarration:[{shotId:'S01',taskId:'task',audioTrackId:'voice',sha256:'voice-sha',text:'已有口播',sourceInFrame:0,durationInFrames:180,fps:30}],candidates:[{id:'voice',kind:'audio',shotId:'S01',taskId:'task',audioTrackId:'voice',sha256:'voice-sha',status:'adopted',relativePath:'voice.mp3',text:'已有口播',durationSeconds:6}]};
 const command=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:completed})));
 const {container}=render(<ProductionWorkspacePanel episodeId="e" title="已完成工程" stage="production_completed" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('先导出最终视频，检查后确认这份文件。');fireEvent.click(screen.getByRole('button',{name:/^分镜台/}));fireEvent.click(screen.getByRole('tab',{name:'字幕与口播'}));
 const media=await screen.findByLabelText('S01 已采用口播试听');expect(media.closest('fieldset')?.disabled).toBe(false);expect(container.querySelector('.app-audio-player button')?.matches(':disabled')).toBe(false);expect(screen.queryByRole('textbox',{name:'口播正文'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'配乐与声音'}));expect(screen.getByRole('region',{name:'配乐与声音制作记录'})).toBeTruthy();expect(screen.queryByRole('combobox',{name:'来源'})).toBeNull();expect(screen.queryByRole('button',{name:'上传 MP3'})).toBeNull();expect(command).not.toHaveBeenCalled();
});

it('saves optional sound intent only on request and restores the right text when switching shots',async()=>{
 let stored={...workspace,clips:[{...workspace.clips[0],soundIntent:''},{...workspace.clips[0],id:'second',itemId:'shot-S02-second',shotId:'S02',text:'第二镜',soundIntent:'结尾的钟声'}]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:stored})));
 const command=vi.fn(async(name:string,data:unknown)=>{expect(name).toBe('saveWorkspaceSoundIntent');const input=data as {shotId:string;soundIntent:string};stored={...stored,clips:stored.clips.map(c=>c.shotId===input.shotId?{...c,soundIntent:input.soundIntent}:c)};return stored;});
 const view=render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByRole('tab',{name:'配乐与声音'}));fireEvent.click(screen.getByRole('button',{name:'音效'}));
 fireEvent.change(screen.getByRole('textbox',{name:'音效意图或检索词'}),{target:{value:'开门时一声轻响'}});expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存音效意图'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceSoundIntent',{episodeId:'e',workspaceId:'w',expectedRevision:1,expectedProjectSha256:'a'.repeat(64),shotId:'S01',soundIntent:'开门时一声轻响'}));
 fireEvent.click(screen.getByText('第二镜'));fireEvent.click(screen.getByRole('button',{name:'音效'}));expect((await screen.findByRole('textbox',{name:'音效意图或检索词'} ) as HTMLTextAreaElement).value).toBe('结尾的钟声');
 fireEvent.click(screen.getByText('第一镜'));expect((screen.getByRole('textbox',{name:'音效意图或检索词'}) as HTMLTextAreaElement).value).toBe('开门时一声轻响');
 view.unmount();render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 fireEvent.click(await screen.findByRole('tab',{name:'配乐与声音'}));fireEvent.click(screen.getByRole('button',{name:'音效'}));expect(await screen.findByRole('textbox',{name:'音效意图或检索词'})).toHaveProperty('value','开门时一声轻响');expect(command).toHaveBeenCalledTimes(1);
});

it('keeps revision editing unavailable until the actual script baseline has loaded',async()=>{
 let resolveScript!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.startsWith('/_local-artifact')?new Promise<Response>(resolve=>{resolveScript=resolve;}):Response.json({workspace:null})));
 render(<ProductionWorkspacePanel episodeId="baseline-e" title="脚本读取" scriptRevisionId="baseline-script" stage="script_approved" materials={[{id:'baseline-script',material_type:'script',source_path:'script.md',storage_path:'script.md',is_main_script:true}]} command={vi.fn()} onLegacy={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:/^脚本确认/}));expect((screen.getByRole('button',{name:'修改脚本'}) as HTMLButtonElement).disabled).toBe(true);await act(async()=>resolveScript(new Response('实际服务器正文')));expect((screen.getByRole('button',{name:'修改脚本'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('实际服务器正文');
});

it('builds the storyboard automatically for a confirmed v2 script without showing the general importer',async()=>{
 const scriptPath='episodes/e/script.md';
 const structuredWorkspace={...workspace,clips:[{...workspace.clips[0],shotId:'shot-01'}]};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.startsWith('/_local-artifact')
  ? new Response(productionScriptTemplate)
  : Response.json({workspace:null})));
 const command=vi.fn(async()=>structuredWorkspace);
 render(<ProductionWorkspacePanel episodeId="e" title="工程" stage="script_approved" scriptRevisionId="s"
  materials={[{id:'s',material_type:'script',source_path:'script.md',storage_path:scriptPath,is_main_script:true}]}
  command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');
 expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspace',{episodeId:'e',expectedScriptRevisionId:'s'});
 expect(screen.queryByRole('button',{name:'导入本期素材'})).toBeNull();
});

it('keeps preparation and its local draft available after Studio launch fails',async()=>{
 const readyWorkspace={...workspace,readiness:{...workspace.readiness,placeholders:[],missingSources:[]}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:readyWorkspace})));
 const command=vi.fn(async()=>{throw Error('测试：剪辑连接失败');});
 render(<ProductionWorkspacePanel episodeId="e" title="剪辑隔离验证" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));

 fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'未提交的分镜提示词'}});
 fireEvent.click(screen.getByRole('button',{name:'进入剪辑工作台'}));
 expect(await screen.findByText('测试：剪辑连接失败')).toBeTruthy();
 expect(screen.getByRole('button',{name:/^分镜台/}).getAttribute('aria-current')).toBe('page');
 expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('未提交的分镜提示词');
 expect(command).toHaveBeenCalledExactlyOnceWith('openWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:1});
});

it('keeps a visual upload failure in transient feedback and recovery instead of duplicating it as a workspace error',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path==='/api/local/connections'?{serviceCatalog:{version:1,groups:[]}}:{workspace})));
 const command=vi.fn(async(name:string)=>{if(name==='importMaterial')throw Error('文件内容无法解码。');return workspace;});
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('textbox',{name:'图片提示词'});fireEvent.change(screen.getByLabelText('导入生成参考图'),{target:{files:[new File(['invalid'],'bad.png',{type:'image/png'})]}});
 await screen.findByRole('status',{name:'上传提示'});expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('文件内容无法解码');expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.queryByLabelText('上传记录')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'关闭上传提示'}));expect(screen.queryByRole('status',{name:'上传提示'})).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('region',{name:'上传结果'}).textContent).toContain('文件内容无法解码');expect(command).toHaveBeenCalledTimes(1);
});
