import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceVisualCandidatesPanel} from './WorkspaceVisualCandidatesPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const workspace={id:'workspace',episodeId:'episode',revision:3,stale:false,clips:[{id:'clip-1',itemId:'visual-1',shotId:'S1',text:'第一片段',source:null},{id:'clip-2',itemId:'visual-2',shotId:'S1',text:'同镜第二片段',source:null}],visualCandidates:[{id:'candidate',kind:'video',usage:'video',clipId:'clip-1',shotId:'S1',targetItemId:'visual-1',taskId:null,inputFingerprint:'a'.repeat(64),text:'',mainScriptText:'',audioTrackId:null,relativePath:'episodes/episode/new.mp4',sha256:'b'.repeat(64),fileSize:100,durationSeconds:2,currentDurationSeconds:3,status:'available',width:640,height:360}]} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('Owner explicitly chooses a target duration policy and adopts only the selected visual instance',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?{adoptionId:'adoption',edit:{targetItemId:'visual-1'}}:workspace),onChange=vi.fn();
 render(<WorkspaceVisualCandidatesPanel workspace={workspace} command={command} onChange={onChange} materials={[]}/>);
 expect((screen.getByRole('button',{name:'采用此画面'}) as HTMLButtonElement).disabled).toBe(true);
 expect(command).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('视觉候选时长处理'),{target:{value:'use-candidate'}});
 expect((screen.getByRole('button',{name:'采用此画面'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('保留其他片段位置，接受本次空隙或覆盖'));fireEvent.click(screen.getByRole('button',{name:'采用此画面'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,candidateId:'candidate',adoptionId:'adoption'}));
 expect(command).toHaveBeenCalledWith('prepareWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,candidateId:'candidate',durationPolicy:'use-candidate',acceptTimelineImpact:true,motionPolicy:'preserve-target'});
});
it('Owner registers an image candidate against the chosen clip without changing another instance',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async()=>workspace);
 render(<WorkspaceVisualCandidatesPanel workspace={workspace} command={command} onChange={()=>{}} materials={[{id:'image',material_type:'image',source_path:'reference.png'}]}/>);
 fireEvent.change(screen.getByLabelText('画面候选目标'),{target:{value:'visual-2'}});fireEvent.change(screen.getByLabelText('本期画面素材'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('图片使用方式'),{target:{value:'pan-zoom'}});fireEvent.change(screen.getByLabelText('候选时长（秒）'),{target:{value:'2.4'}});
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'添加为画面候选'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,targetItemId:'visual-2',materialRevisionId:'image',usage:'pan-zoom',durationSeconds:2.4}));
});
it('Owner explicitly requests a first-frame visual candidate and native write readiness gates mutations',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async()=>workspace),bridge={connected:false,save:vi.fn(),applyNativeEdit:vi.fn()} as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge;
 const props={workspace,command,onChange:()=>{},materials:[{id:'image',material_type:'image',source_path:'frame.png'}],bridge};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});
 expect((screen.getByRole('button',{name:'生成画面候选'}) as HTMLButtonElement).disabled).toBe(true);expect(command).not.toHaveBeenCalled();
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} bridge={{...bridge,connected:true}}/>);
 fireEvent.change(screen.getByLabelText('画面首帧图片'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'缓慢推近'}});fireEvent.change(screen.getByLabelText('本次费用预留（分）'),{target:{value:'90'}});
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'生成画面候选'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,targetItemId:'visual-1',firstFrameMaterialRevisionId:'image',prompt:'缓慢推近',durationSeconds:3,reservationCents:90}));
 expect(bridge.save).toHaveBeenCalledTimes(1);
});
it('Owner upload registers the original before adding its source to the live native pool',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async(name:string)=>name==='importMaterial'?{id:'uploaded'}:name==='prepareWorkspaceVisualPool'?{asset:{id:'material-uploaded',kind:'image',src:'/media/uploads/registered.png'}}:workspace),bridge={connected:true,save:vi.fn(async()=>{}),applyNativeEdit:vi.fn(async()=>({}))} as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge,onChange=vi.fn();
 render(<WorkspaceVisualCandidatesPanel workspace={workspace} command={command} onChange={onChange} bridge={bridge} materials={[]}/>);
 fireEvent.change(screen.getByLabelText('上传补充画面'),{target:{files:[new File(['source bytes'],'photo.png',{type:'image/png'})]}});
 await waitFor(()=>expect(bridge.applyNativeEdit).toHaveBeenCalledWith('add-registered-source',{asset:{id:'material-uploaded',kind:'image',src:'/media/uploads/registered.png'}}));
 expect(command).toHaveBeenCalledWith('importMaterial',expect.objectContaining({episodeId:'episode',sourcePath:'photo.png',materialType:'image',materialPurpose:'visual_reference'}));
 expect(command).toHaveBeenCalledWith('prepareWorkspaceVisualPool',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,materialRevisionId:'uploaded'});
 expect(command.mock.calls.some(call=>call[0].includes('adopt')||call[0].includes('registerWorkspaceVisualCandidate'))).toBe(false);
 expect(onChange).toHaveBeenCalledWith(workspace);
});
it('pending visual generation remains a task until explicitly adopted',()=>{
 const w={...workspace,visualTasks:[{id:'request',taskId:'provider-task',status:'running',error:null}]};
 render(<WorkspaceVisualCandidatesPanel workspace={w} command={vi.fn()} onChange={()=>{}} materials={[]}/>);
 expect(screen.getByText('画面生成中')).toBeTruthy();expect(screen.getByLabelText('视觉任务 provider-task')).toBeTruthy();
});
it('live adoption waits for native persistence and uses the post-save workspace revision',async()=>{
 const updated={...workspace,revision:8};vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({workspace:{...workspace,revision:7}})).mockResolvedValueOnce(Response.json({workspace:updated})));
 const bridge={connected:true,save:vi.fn(async()=>{}),applyNativeEdit:vi.fn(async()=>({}))} as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge;
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?{adoptionId:'adoption',edit:{targetItemId:'visual-1'}}:updated),onChange=vi.fn();
 render(<WorkspaceVisualCandidatesPanel workspace={workspace} command={command} onChange={onChange} bridge={bridge} materials={[]}/>);
 fireEvent.change(screen.getByLabelText('视觉候选时长处理'),{target:{value:'use-candidate'}});fireEvent.click(screen.getByLabelText('保留其他片段位置，接受本次空隙或覆盖'));fireEvent.click(screen.getByRole('button',{name:'采用此画面'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:8,candidateId:'candidate',adoptionId:'adoption',nativeApplied:true}));
 expect(bridge.save).toHaveBeenCalledTimes(1);expect(bridge.applyNativeEdit).toHaveBeenCalledWith('apply-candidate',{edit:{targetItemId:'visual-1'}});expect(command).toHaveBeenCalledWith('prepareWorkspaceVisualCandidate',expect.objectContaining({expectedRevision:7}));expect(onChange).toHaveBeenCalledWith(updated);
});
it('a failed visual request preserves the Owner local choices for correction',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async()=>{throw Error('图片指纹已变化');});
 render(<WorkspaceVisualCandidatesPanel workspace={workspace} command={command} onChange={()=>{}} materials={[{id:'image',material_type:'image',source_path:'reference.png'}]}/>);
 fireEvent.change(screen.getByLabelText('本期画面素材'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('图片使用方式'),{target:{value:'pan-zoom'}});fireEvent.change(screen.getByLabelText('候选时长（秒）'),{target:{value:'2.4'}});fireEvent.click(screen.getByRole('button',{name:'添加为画面候选'}));await screen.findByRole('alert');
 expect((screen.getByLabelText('本期画面素材') as HTMLSelectElement).value).toBe('image');expect((screen.getByLabelText('图片使用方式') as HTMLSelectElement).value).toBe('pan-zoom');expect((screen.getByLabelText('候选时长（秒）') as HTMLInputElement).value).toBe('2.4');
});
it('only explicitly resumable visual tasks expose the existing Provider recovery action',async()=>{
 const w={...workspace,visualTasks:[{id:'request',taskId:'known-provider-task',status:'blocked',error:'供应商任务可恢复',canResume:true},{id:'unknown',taskId:'unknown-task',status:'blocked',error:'提交结果未知',canResume:false}]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn(async()=>w);
 render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={()=>{}} materials={[]}/>);
 expect(screen.getAllByRole('button',{name:'恢复画面任务'})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'恢复画面任务'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('retryWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,candidateId:'request'}));
});
it('actual source and short TTS windows derive read-only request timing while none remains editable',async()=>{
 const source={...workspace,visualTargets:[{targetItemId:'visual-1',voiceMode:'source' as const,durationSeconds:5,providerDurationSeconds:5,minimumSeconds:4,maximumSeconds:15}]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:source})));const command=vi.fn(async()=>source),props={workspace:source,command,onChange:()=>{},materials:[{id:'image',material_type:'image',source_path:'frame.png'}]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});
 expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('5');expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).readOnly).toBe(true);expect(screen.getByText('服务请求 5 秒')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('画面首帧图片'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'缓慢推近'}});fireEvent.change(screen.getByLabelText('本次费用预留（分）'),{target:{value:'90'}});fireEvent.click(screen.getByRole('button',{name:'生成画面候选'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',expect.objectContaining({durationSeconds:5})));
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...source,visualTargets:[{...source.visualTargets[0],voiceMode:'none',durationSeconds:null,providerDurationSeconds:null}]}}/>);expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).readOnly).toBe(false);fireEvent.change(screen.getByLabelText('生成时长（秒）'),{target:{value:'6'}});expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('6');
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...source,visualTargets:[{...source.visualTargets[0],voiceMode:'tts',durationSeconds:2.4,providerDurationSeconds:4}]}}/>);expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).readOnly).toBe(true);expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('2.4');expect(screen.getByText('服务请求 4 秒')).toBeTruthy();expect(screen.getByText('服务最短 4 秒，画面按主声 2.4 秒使用。')).toBeTruthy();
});
it('changed post-save main voice timing requires reconfirmation before a paid visual request',async()=>{
 const source={...workspace,visualTargets:[{targetItemId:'visual-1',voiceMode:'source' as const,durationSeconds:5,providerDurationSeconds:5,minimumSeconds:4,maximumSeconds:15}]},changed={...source,visualTargets:[{...source.visualTargets[0],voiceMode:'tts' as const,durationSeconds:6,providerDurationSeconds:6}]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:changed})));const command=vi.fn(),onChange=vi.fn(),props={workspace:source,command,onChange,materials:[{id:'image',material_type:'image',source_path:'frame.png'}]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});fireEvent.change(screen.getByLabelText('画面首帧图片'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'缓慢推近'}});fireEvent.change(screen.getByLabelText('本次费用预留（分）'),{target:{value:'90'}});fireEvent.click(screen.getByRole('button',{name:'生成画面候选'}));await screen.findByText('当前主声窗口已变化，请重新确认后生成画面。');
 expect(onChange).toHaveBeenCalledWith(changed);expect(command).not.toHaveBeenCalled();expect((screen.getByLabelText('画面动作') as HTMLInputElement).value).toBe('缓慢推近');
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...source,visualTargets:[{...source.visualTargets[0],durationSeconds:16,providerDurationSeconds:16}]}}/>);expect(screen.getByText('主声窗口超过服务上限 15 秒，请先明确拆分镜头。')).toBeTruthy();expect((screen.getByRole('button',{name:'生成画面候选'}) as HTMLButtonElement).disabled).toBe(true);
});

it('starts both tabs with placeholders and keeps API fields out of the upload flow',()=>{
 const w={...workspace,clips:[workspace.clips[0]],visualCandidates:[]};render(<WorkspaceVisualCandidatesPanel workspace={w} command={vi.fn()} onChange={vi.fn()} materials={[]} preparation/>);
 expect(screen.getByText('尚未添加图片')).toBeTruthy();expect(screen.queryByRole('textbox',{name:'图片提示词'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));expect(screen.getByText('尚未添加视频')).toBeTruthy();expect(screen.queryByLabelText('画面动作')).toBeNull();
});
it('preserves each target’s generation draft across tabs and shot selection',async()=>{
 const props={workspace,command:vi.fn(),onChange:vi.fn(),materials:[],selectedShotId:'S1',preparation:true};const{rerender}=render(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'第一片段的动作草稿'}});
 rerender(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-2"/>);fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'第二片段的动作草稿'}});
 rerender(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('第一片段的动作草稿');expect(props.command).not.toHaveBeenCalled();
});
it('image carousel browsing does not adopt or change the explicitly chosen video first frame',()=>{
 const images=[1,2,3,4].map(i=>({...workspace.visualCandidates![0],id:'image-'+i,kind:'image' as const,usage:'still' as const,materialRevisionId:'material-'+i,relativePath:'image-'+i+'.png'}));
 const w={...workspace,visualCandidates:images};const command=vi.fn();render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={vi.fn()} materials={[]} preparation/>);
 expect(screen.getByText('第 1 / 4 张')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'下一张图片'}));expect(screen.getByText('第 2 / 4 张')).toBeTruthy();expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'用作视频首帧'}));expect((screen.getByLabelText('画面首帧图片') as HTMLSelectElement).value).toBe('material-2');
 fireEvent.click(screen.getByRole('tab',{name:'图片'}));fireEvent.click(screen.getByRole('button',{name:'下一张图片'}));fireEvent.click(screen.getByRole('tab',{name:'视频'}));expect((screen.getByLabelText('画面首帧图片') as HTMLSelectElement).value).toBe('material-2');expect(command).not.toHaveBeenCalled();
});
it('explicit image generation freezes reference IDs, count, quality and dimensions without adopting',async()=>{
 const w={...workspace,visualCandidates:[],visualConfiguration:{imageModel:'gpt-image-2',videoModel:null,videoProvider:null}};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn(async(_name:string,_data:unknown)=>w);
 render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={vi.fn()} materials={[{id:'reference',material_type:'image',source_path:'ref.png'}]} preparation/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));fireEvent.change(screen.getByLabelText('图片提示词'),{target:{value:'保留主体，改变背景'}});fireEvent.change(screen.getByLabelText('添加本期参考图'),{target:{value:'reference'}});fireEvent.change(screen.getByLabelText('生成图片数量'),{target:{value:'4'}});fireEvent.change(screen.getByLabelText('图片质量'),{target:{value:'high'}});fireEvent.change(screen.getByLabelText('本次费用预留（元）'),{target:{value:'2.50'}});
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceImageCandidates',expect.objectContaining({targetItemId:'visual-1',model:'gpt-image-2',prompt:'保留主体，改变背景',settings:{count:4,size:'864x1536',quality:'high'},referenceMaterialRevisionIds:['reference'],reservationCents:250})));expect(command.mock.calls.some(([name])=>name.includes('adopt'))).toBe(false);
});
it('keeps the adopted video when manually choosing an image as fallback',async()=>{
 const image={...workspace.visualCandidates![0],kind:'image' as const,id:'still',materialRevisionId:'image',usage:'still' as const,relativePath:'image.png'};const w={...workspace,visualCandidates:[image]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn(async()=>w);
 render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={vi.fn()} materials={[]} preparation currentVisualKind="video" currentVisualPath="current.mp4"/>);fireEvent.click(screen.getByRole('tab',{name:'图片'}));fireEvent.click(screen.getByRole('button',{name:'采用此图片'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('retainWorkspaceImageCandidate',expect.objectContaining({candidateId:'still'})));expect(command).toHaveBeenCalledTimes(1);
});
it('reuses a generated video’s frozen inputs only on request, then generates a separate candidate',async()=>{
 const generated={...workspace,visualConfiguration:{imageModel:null,videoModel:'wan2.6-i2v-flash',videoProvider:'bailian'},visualCandidates:[{...workspace.visualCandidates![0],taskId:'task',generation:{prompt:'原始运镜',firstFrameMaterialRevisionId:'image',durationSeconds:4}}]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:generated})));const command=vi.fn(async(_name:string,_data:unknown)=>generated);render(<WorkspaceVisualCandidatesPanel workspace={generated} command={command} onChange={vi.fn()} materials={[{id:'image',material_type:'image',source_path:'frame.png'}]} preparation/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'复用生成设置'}));expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('原始运镜');fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'减慢推进'}});fireEvent.change(screen.getByLabelText('本次费用预留（元）'),{target:{value:'0.90'}});fireEvent.click(screen.getByRole('button',{name:'生成视频'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',expect.objectContaining({prompt:'减慢推进',firstFrameMaterialRevisionId:'image',durationSeconds:4})));expect(command.mock.calls.some(([name])=>name.includes('adopt'))).toBe(false);
});
