import userEvent from '@testing-library/user-event';
import {render,screen,within,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceVisualCandidatesPanel} from './WorkspaceVisualCandidatesPanel';
import {WorkspaceMaterialSelectionProvider,useWorkspaceMaterialSelection,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
const preparation:WorkspaceCandidatePreparation={adoptionId:'adoption',candidateId:'candidate',projectSha256:'original',edit:{targetItemId:'visual-1',expectedTarget:null,durationPolicy:'use-candidate',source:{id:'candidate-source',kind:'video',src:'episodes/episode/new.mp4',sha256:'b'.repeat(64),inputFingerprint:'a'.repeat(64),durationSeconds:2}},impact:{currentSeconds:3,sourceSeconds:2,appliedSeconds:2,deltaSeconds:-1,startSeconds:0,endSeconds:2,fps:30,affectedFragments:[]}};
const workspace={project:{sha256:'original'},id:'workspace',episodeId:'episode',revision:3,stale:false,clips:[{id:'clip-1',itemId:'visual-1',shotId:'S1',text:'第一片段',source:null},{id:'clip-2',itemId:'visual-2',shotId:'S1',text:'同镜第二片段',source:null}],visualCandidates:[{id:'candidate',kind:'video',usage:'video',clipId:'clip-1',shotId:'S1',targetItemId:'visual-1',taskId:null,inputFingerprint:'a'.repeat(64),text:'',mainScriptText:'',audioTrackId:null,relativePath:'episodes/episode/new.mp4',sha256:'b'.repeat(64),fileSize:100,durationSeconds:2,currentDurationSeconds:3,status:'available',width:640,height:360}]} as unknown as ProductionWorkspace;
const videoChoice={capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:'video-a'};
const videoCatalog={serviceCatalog:{groups:[{capability:'video',services:[{id:'video-a',provider:'volcengine',adapter:'seedance_video',models:['doubao-seedance-2-0-260128'],connectionVersionId:'video-a',connectionName:'Video A',mode:'generation',executable:true,constraints:{durationSeconds:{min:4,max:15,integer:true}}}]}]}};
async function closeComposer(){const button=screen.queryByRole('button',{name:/^关闭(图片规格|视频规格|生成数量|画面输入模式|生成时长|高级视频设置)$/});if(button)await userEvent.click(button);}
async function chooseModel(kind:'图片'|'视频',model:string,connection?:string){
 await closeComposer();await userEvent.click(screen.getByRole('button',{name:kind+'连接与模型'}));
 const options=await screen.findAllByRole('menuitemradio',{name:new RegExp('^'+model)});
 const option=connection?options.find(option=>option.textContent?.includes(connection)):options[0];expect(option).toBeTruthy();await userEvent.click(option!);
 if(!model.startsWith('Pexels')){await screen.findByRole('dialog',{name:kind+'规格'});await closeComposer();}
}
async function chooseVideo(){if(screen.queryByRole('button',{name:'视频连接与模型'})){await chooseModel('视频','doubao-seedance-2-0-260128');return;}await screen.findAllByRole('option',{name:/doubao-seedance-2-0-260128$/});fireEvent.change(screen.getByLabelText('视频连接与模型'),{target:{value:'video-a:doubao-seedance-2-0-260128'}});}
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('Owner explicitly chooses a target duration policy and adopts only the selected visual instance',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?preparation:workspace),onChange=vi.fn();
 render(<WorkspaceVisualCandidatesPanel workspace={workspace} command={command} onChange={onChange} materials={[]}/>);
 expect((screen.getByRole('button',{name:'采用此画面'}) as HTMLButtonElement).disabled).toBe(true);
 expect(command).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('视觉候选时长处理'),{target:{value:'use-candidate'}});
 expect((screen.getByRole('button',{name:'采用此画面'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('保留其他片段位置，接受本次空隙或覆盖'));fireEvent.click(screen.getByRole('button',{name:'采用此画面'}));
 expect(await screen.findByRole('region',{name:'采用前核对'})).toBeTruthy();expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
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
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?videoCatalog:{workspace})));const command=vi.fn(async()=>workspace),bridge={connected:false,save:vi.fn(),applyNativeEdit:vi.fn()} as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge;
 const props={workspace,command,onChange:()=>{},materials:[{id:'image',material_type:'image',source_path:'frame.png'}],bridge};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});
 expect((screen.getByRole('button',{name:'生成画面候选'}) as HTMLButtonElement).disabled).toBe(true);expect(command).not.toHaveBeenCalled();
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} bridge={{...bridge,connected:true}}/>);await chooseVideo();fireEvent.change(screen.getByLabelText('生成时长（秒）'),{target:{value:'4'}});
 fireEvent.change(screen.getByLabelText('画面首帧图片'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'缓慢推近'}});
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'生成画面候选'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,targetItemId:'visual-1',selection:videoChoice,firstFrameMaterialRevisionId:'image',prompt:'缓慢推近',durationSeconds:4}));
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
 const updated={...workspace,revision:8};vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({workspace:{...workspace,revision:7}})).mockImplementation(async()=>Response.json({workspace:updated})));
 const bridge={connected:true,save:vi.fn(async()=>{}),applyNativeEdit:vi.fn(async()=>({}))} as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge;
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?preparation:updated),onChange=vi.fn();
 render(<WorkspaceVisualCandidatesPanel replacementOnly workspace={workspace} command={command} onChange={onChange} bridge={bridge} materials={[]}/>);
 expect(screen.queryByLabelText('画面候选来源')).toBeNull();
 fireEvent.change(screen.getByLabelText('视觉候选时长处理'),{target:{value:'use-candidate'}});fireEvent.click(screen.getByLabelText('保留其他片段位置，接受本次空隙或覆盖'));fireEvent.click(screen.getByRole('button',{name:'采用此画面'}));
 await screen.findByRole('region',{name:'采用前核对'});expect(bridge.applyNativeEdit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:8,candidateId:'candidate',adoptionId:'adoption',nativeApplied:true}));
 expect(bridge.save).toHaveBeenCalledTimes(2);expect(bridge.applyNativeEdit).toHaveBeenCalledWith('apply-candidate',{edit:preparation.edit});expect(command).toHaveBeenCalledWith('prepareWorkspaceVisualCandidate',expect.objectContaining({expectedRevision:7}));expect(onChange).toHaveBeenCalledWith(updated);
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
 const source={...workspace,visualTargets:[{targetItemId:'visual-1',voiceMode:'source' as const,durationSeconds:5,providerDurationSeconds:5,minimumSeconds:4,maximumSeconds:15}]};vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?videoCatalog:{workspace:source})));const command=vi.fn(async()=>source),props={workspace:source,command,onChange:()=>{},materials:[{id:'image',material_type:'image',source_path:'frame.png'}]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});await chooseVideo();
 expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('5');expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).readOnly).toBe(true);expect(screen.getByText('服务请求 5 秒')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('画面首帧图片'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'缓慢推近'}});fireEvent.click(screen.getByRole('button',{name:'生成画面候选'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',expect.objectContaining({durationSeconds:5})));
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...source,visualTargets:[{...source.visualTargets[0],voiceMode:'none',durationSeconds:null,providerDurationSeconds:null}]}}/>);expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).readOnly).toBe(false);fireEvent.change(screen.getByLabelText('生成时长（秒）'),{target:{value:'6'}});expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('6');
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...source,visualTargets:[{...source.visualTargets[0],voiceMode:'tts',durationSeconds:2.4,providerDurationSeconds:4}]}}/>);expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).readOnly).toBe(true);expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('2.4');expect(screen.getByText('服务请求 4 秒')).toBeTruthy();expect(screen.getByText('服务最短 4 秒，画面按主声 2.4 秒使用。')).toBeTruthy();
});
it('changed post-save main voice timing requires reconfirmation before a paid visual request',async()=>{
 const source={...workspace,visualTargets:[{targetItemId:'visual-1',voiceMode:'source' as const,durationSeconds:5,providerDurationSeconds:5,minimumSeconds:4,maximumSeconds:15}]},changed={...source,visualTargets:[{...source.visualTargets[0],voiceMode:'tts' as const,durationSeconds:6,providerDurationSeconds:6}]};vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?videoCatalog:{workspace:changed})));const command=vi.fn(),onChange=vi.fn(),props={workspace:source,command,onChange,materials:[{id:'image',material_type:'image',source_path:'frame.png'}]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});await chooseVideo();fireEvent.change(screen.getByLabelText('画面首帧图片'),{target:{value:'image'}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'缓慢推近'}});fireEvent.click(screen.getByRole('button',{name:'生成画面候选'}));await screen.findByText('当前主声窗口已变化，请重新确认后生成画面。');
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
it('image thumbnails preview without adopting or changing the explicitly chosen video first frame',()=>{
 const images=[1,2,3,4].map(i=>({...workspace.visualCandidates![0],id:'image-'+i,kind:'image' as const,usage:'still' as const,materialRevisionId:'material-'+i,relativePath:'image-'+i+'.png'}));
 const w={...workspace,visualCandidates:images};const command=vi.fn();render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={vi.fn()} materials={[]} preparation/>);
 expect(screen.queryByRole('button',{name:'采用到当前镜头'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'预览图片候选 02'}));expect(screen.getByAltText('图片候选 2').getAttribute('src')).toContain('image-2.png');expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));fireEvent.click(screen.getByRole('button',{name:'用作视频首帧'}));expect(screen.getByAltText('已选视频首帧').getAttribute('src')).toContain('image-2.png');
 fireEvent.click(screen.getByRole('tab',{name:'图片'}));fireEvent.click(screen.getByRole('button',{name:'预览图片候选 03'}));fireEvent.click(screen.getByRole('tab',{name:'视频'}));expect(screen.getByAltText('已选视频首帧').getAttribute('src')).toContain('image-2.png');expect(command).not.toHaveBeenCalled();
});
it('explicit image generation freezes reference IDs, count, quality and dimensions without adopting',async()=>{
 const w={...workspace,visualCandidates:[],visualConfiguration:{imageModel:'gpt-image-2',videoModel:null,videoProvider:null}};vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:{groups:[{capability:'image',services:[{id:'image-a',connectionVersionId:'image-a',connectionName:'Image A',connectionVersion:1,provider:'openai',adapter:'openai_images',models:['gpt-image-2'],executable:true,constraints:{sizes:['864x1536'],qualities:['auto','high'],counts:[1,4],referenceImages:{max:16}}}]}]}}:{workspace:w})));const command=vi.fn(async(_name:string,_data:unknown)=>w);
 render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={vi.fn()} materials={[{id:'reference',material_type:'image',source_path:'ref.png'}]} preparation/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));fireEvent.change(screen.getByLabelText('图片提示词'),{target:{value:'保留主体，改变背景'}});fireEvent.click(screen.getByRole('button',{name:'添加参考图'}));fireEvent.click(screen.getByRole('checkbox',{name:'参考图 ref.png'}));fireEvent.click(screen.getByRole('button',{name:'关闭参考图选择'}));await chooseModel('图片','gpt-image-2');fireEvent.click(screen.getByRole('button',{name:'生成数量'}));fireEvent.click(screen.getByRole('button',{name:'生成 4 张图片'}));await closeComposer();fireEvent.click(screen.getByRole('button',{name:'图片规格'}));fireEvent.change(screen.getByLabelText('图片质量'),{target:{value:'high'}});await closeComposer();expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceImageCandidates',expect.objectContaining({targetItemId:'visual-1',selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:'image-a'},prompt:'保留主体，改变背景',settings:{count:4,size:'864x1536',quality:'high'},referenceMaterialRevisionIds:['reference']})));expect(command.mock.calls.some(([name])=>name.includes('adopt'))).toBe(false);
});
it.each(['image','video']as const)('keeps the original %s draft visible when its model is disabled in connection settings',async kind=>{
 const services={image:{id:'image-a',connectionVersionId:'image-a',provider:'openai',adapter:'openai_images',models:['gpt-image-2'],executable:true,constraints:{sizes:['864x1536'],qualities:['auto'],counts:[1],referenceImages:{max:16}}},video:videoCatalog.serviceCatalog.groups[0].services[0]};let enabled=true;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:kind,services:[{...services[kind],models:enabled?services[kind].models:[]}]}]}})));
 const props={workspace:{...workspace,visualCandidates:[]},command:vi.fn(),onChange:vi.fn(),materials:[],preparation:true};
 render(<WorkspaceVisualCandidatesPanel {...props}/>);if(kind==='video')fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));
 const kindName=kind==='image'?'图片':'视频',label=kindName+'连接与模型';await chooseModel(kindName,services[kind].models[0]);
 fireEvent.change(screen.getByLabelText(kind==='image'?'图片提示词':'画面动作'),{target:{value:'保留我的草稿'}});
 enabled=false;fireEvent.focus(window);
 await waitFor(()=>expect(screen.getByRole('button',{name:label}).textContent).toContain('选择'+kindName+'模型'));fireEvent.click(screen.getByRole('button',{name:label}));expect(await screen.findByText(kind==='image'?'暂无可用图片模型。':'暂无可用视频模型。')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'关闭模型选择'}));expect(screen.queryByRole('option',{name:/原选择不可用/})).toBeNull();expect(screen.getByRole('button',{name:label}).textContent).toContain('选择'+kindName+'模型');expect((screen.getByLabelText(kind==='image'?'图片提示词':'画面动作')as HTMLTextAreaElement).value).toBe('保留我的草稿');
 expect((screen.getByRole('button',{name:kind==='image'?'生成图片':'生成视频'})as HTMLButtonElement).disabled).toBe(true);expect(props.command).not.toHaveBeenCalled();
});
it('keeps the adopted video when manually choosing an image as fallback',async()=>{
 const image={...workspace.visualCandidates![0],kind:'image' as const,id:'still',materialRevisionId:'image',usage:'still' as const,relativePath:'image.png'};const w={...workspace,visualCandidates:[image]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn(async()=>w);
 render(<WorkspaceVisualCandidatesPanel workspace={w} command={command} onChange={vi.fn()} materials={[]} preparation currentVisualKind="video" currentVisualPath="current.mp4"/>);fireEvent.click(screen.getByRole('tab',{name:'图片'}));fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01'}));fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));expect(screen.getByText('仅保留备用，当前视频不变')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'保留为备用图片'}));const review=await screen.findByRole('group',{name:'采用前核对'});expect(command).not.toHaveBeenCalled();fireEvent.click(within(review).getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('retainWorkspaceImageCandidate',expect.objectContaining({candidateId:'still'})));expect(command).toHaveBeenCalledTimes(1);
});
it.each(['图片','视频'] as const)('keeps %s candidate actions without a generation settings entry',label=>{
 const kind=label==='图片'?'image':'video';
 const candidate:NonNullable<ProductionWorkspace['visualCandidates']>[number]={...workspace.visualCandidates![0],kind,taskId:'task',generation:{prompt:'候选生成提示词',firstFrameMaterialRevisionId:'image',durationSeconds:4}};
 render(<WorkspaceVisualCandidatesPanel workspace={{...workspace,visualCandidates:[candidate]}} command={vi.fn()} onChange={vi.fn()} materials={[]} preparation/>);
 if(kind==='video')fireEvent.click(screen.getByRole('tab',{name:'视频'}));
 fireEvent.click(screen.getByRole('button',{name:`预览${label}候选 01`}));
 fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
 const adopt=screen.getByRole('button',{name:'采用到当前镜头'});
 expect(!!adopt.closest('details')).toBe(kind==='image');
 expect(screen.getByRole('button',{name:'移除候选'})).toBeTruthy();
 expect(screen.queryByText('查看生成设置')).toBeNull();
});

it('retains explicit connection choices through shot switches and refresh without submitting',async()=>{
 const w={...workspace,visualConfiguration:{imageModel:null,videoModel:null,videoProvider:null}};
 const service=(id:string,name:string)=>({id,capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:id,connectionName:name,connectionVersion:1,models:['gpt-image-2'],executable:true,constraints:{sizes:['864x1536'],qualities:['auto','high'],counts:[1,4],referenceImages:{max:16}}});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:{groups:[{capability:'image',services:[service('connection-a','Image A'),service('connection-b','Image B')]}]}}:{workspace:w})));
 const command=vi.fn();const props={workspace:w,command,onChange:vi.fn(),materials:[],preparation:true};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await chooseModel('图片','gpt-image-2','Image A');fireEvent.change(screen.getByLabelText('图片提示词'),{target:{value:'保留构图'}});
 await chooseModel('图片','gpt-image-2','Image B');expect(command).not.toHaveBeenCalled();
 view.unmount();render(<WorkspaceVisualCandidatesPanel {...props}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain('gpt-image-2'));fireEvent.click(screen.getByRole('button',{name:'图片连接与模型'}));expect(screen.getAllByRole('menuitemradio').find(option=>option.textContent?.includes('Image B'))?.getAttribute('aria-checked')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'关闭模型选择'}));expect((screen.getByLabelText('图片提示词') as HTMLTextAreaElement).value).toBe('保留构图');expect(command).not.toHaveBeenCalled();
});
it('video choice and input conflicts survive refresh while actual voice is checked against the chosen model',async()=>{
 const w={...workspace,visualTargets:[{targetItemId:'visual-1',voiceMode:'source' as const,durationSeconds:3.5,providerDurationSeconds:4,minimumSeconds:2,maximumSeconds:15}]};
 const service=(id:string,provider:string,adapter:string,model:string,min:number)=>({id,provider,adapter,models:[model],connectionVersionId:id,connectionName:id,connectionVersion:1,mode:'generation',executable:true,constraints:{durationSeconds:{min,max:15,integer:true},firstFrame:{required:true},resolutions:provider==='bailian'?['720P','1080P']:['720p'],aspectRatios:['adaptive']}});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:{groups:[{capability:'video',services:[service('Video A','bailian','wan_video','wan2.6-i2v-flash',2),service('Video B','volcengine','seedance_video','doubao-seedance-2-0-260128',4)]}]}}:{workspace:w})));
 const command=vi.fn(async()=>w),props={workspace:w,command,onChange:vi.fn(),materials:[{id:'first',material_type:'image',source_path:'frame.png',storage_path:'frame.png'}],preparation:true};const view=render(<WorkspaceMaterialSelectionProvider materials={props.materials}><WorkspaceVisualCandidatesPanel {...props}/></WorkspaceMaterialSelectionProvider>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));await chooseModel('视频','wan2.6-i2v-flash');fireEvent.drop(screen.getByLabelText('视频生成输入框'),{dataTransfer:{getData:(type:string)=>type===workspaceMaterialDragType?'first':''}});fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'保留人物动作'}});fireEvent.click(screen.getByRole('button',{name:'视频规格'}));fireEvent.change(screen.getByLabelText('视频分辨率'),{target:{value:'1080P'}});await closeComposer();await chooseModel('视频','doubao-seedance-2-0-260128');
 expect(screen.getByAltText('已选视频首帧').getAttribute('src')).toContain('frame.png');expect(screen.getByText(/当前模型不支持万相专用设置/)).toBeTruthy();expect(command).not.toHaveBeenCalled();view.unmount();render(<WorkspaceMaterialSelectionProvider materials={props.materials}><WorkspaceVisualCandidatesPanel {...props}/></WorkspaceMaterialSelectionProvider>);await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('doubao-seedance-2-0-260128'));expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('保留人物动作');fireEvent.click(screen.getByRole('button',{name:'清除不兼容的万相参数'}));fireEvent.click(screen.getByRole('button',{name:'生成时长'}));expect(screen.getByText(/服务请求 4 秒/)).toBeTruthy();await closeComposer();fireEvent.click(screen.getByRole('button',{name:'生成视频'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',expect.objectContaining({selection:{capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:'Video B'},durationSeconds:3.5,firstFrameMaterialRevisionId:'first'})));
});
it('editor keeps its explicit video draft across refresh without generating or adopting',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?videoCatalog:{workspace})));const command=vi.fn(),props={workspace,command,onChange:vi.fn(),materials:[]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});await chooseVideo();fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'剪辑内的未提交动作'}});view.unmount();render(<WorkspaceVisualCandidatesPanel {...props}/>);await screen.findAllByRole('option',{name:/doubao-seedance-2-0-260128$/});expect((screen.getByLabelText('视频连接与模型') as HTMLSelectElement).value).toBe('video-a:doubao-seedance-2-0-260128');expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('剪辑内的未提交动作');expect(command).not.toHaveBeenCalled();
});
it('formal video entry offers Pexels query without a generation model or first frame',async()=>{
 const service={id:'pexels-a',provider:'pexels',adapter:'pexels_video',mode:'search',models:[],presets:['b-roll-v1'],connectionVersionId:'pexels-v1',connectionName:'Pexels A',executable:true,constraints:{query:{maxLength:100}}};vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:{groups:[{capability:'video',services:[service]}]}}:{workspace})));const command=vi.fn(async()=>workspace);
 render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await chooseModel('视频','Pexels 素材检索');fireEvent.change(screen.getByLabelText('检索词'),{target:{value:'ocean'}});expect(screen.queryByLabelText('画面首帧图片')).toBeNull();expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('Pexels 素材检索');expect(screen.queryByRole('button',{name:'生成时长'})).toBeNull();expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'检索视频'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('searchWorkspacePexelsVideos',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,targetItemId:'visual-1',selection:{capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:'pexels-v1'},query:'ocean',orientation:'portrait',size:'medium',page:1}));
});
it.each(['image','video'] as const)('keeps a cleared %s override blank across target switches and reopening with a legacy default',async kind=>{
 const image={id:'image-a',connectionVersionId:'image-a',connectionName:'Image A',provider:'openai',adapter:'openai_images',models:['gpt-image-2'],executable:true,constraints:{sizes:['864x1536'],qualities:['auto'],counts:[1],referenceImages:{max:16}}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'image',services:[image]},...videoCatalog.serviceCatalog.groups]}})));
 const command=vi.fn(),props={workspace,command,onChange:vi.fn(),materials:[],preparation:true,selectedShotId:'S1'},kindName=kind==='image'?'图片':'视频',label=kindName+'连接与模型';
 sessionStorage.setItem(`loop-${kind}-default:${workspace.id}`,JSON.stringify(kind==='image'?{imageSelection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:'image-a'}}:{videoSelection:videoChoice}));
 let view=render(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);
 if(kind==='video')fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await chooseModel(kindName,kind==='image'?'gpt-image-2':'doubao-seedance-2-0-260128');expect(screen.queryByRole('button',{name:'设为本期默认'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:label}));fireEvent.click(screen.getByRole('button',{name:'清除模型选择'}));await closeComposer();expect(screen.getByRole('button',{name:label}).textContent).toContain('选择'+kindName+'模型');
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-2"/>);view.rerender(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);expect(screen.getByRole('button',{name:label}).textContent).toContain('选择'+kindName+'模型');view.unmount();view=render(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);expect(screen.getByRole('button',{name:label}).textContent).toContain('选择'+kindName+'模型');expect(command).not.toHaveBeenCalled();
});
it('keeps a cleared native video choice blank instead of restoring target defaults on return or reopen',async()=>{
 const w={...workspace,visualTargets:workspace.clips.map(c=>({targetItemId:c.itemId,defaultSelection:{...videoChoice,capability:'video' as const}}))} as unknown as ProductionWorkspace;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(videoCatalog)));const props={workspace:w,command:vi.fn(),onChange:vi.fn(),materials:[]};let view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});await screen.findAllByRole('option',{name:/doubao-seedance-2-0-260128$/});expect((screen.getByLabelText('视频连接与模型') as HTMLSelectElement).value).toBe('video-a:doubao-seedance-2-0-260128');fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'保留动作'}});fireEvent.change(screen.getByLabelText('视频连接与模型'),{target:{value:''}});expect((screen.getByLabelText('视频连接与模型') as HTMLSelectElement).value).toBe('');
 fireEvent.change(screen.getByLabelText('画面候选目标'),{target:{value:'visual-2'}});fireEvent.change(screen.getByLabelText('画面候选目标'),{target:{value:'visual-1'}});await screen.findAllByRole('option',{name:/doubao-seedance-2-0-260128$/});expect((screen.getByLabelText('视频连接与模型') as HTMLSelectElement).value).toBe('');view.unmount();view=render(<WorkspaceVisualCandidatesPanel {...props}/>);await screen.findAllByRole('option',{name:/doubao-seedance-2-0-260128$/});expect((screen.getByLabelText('视频连接与模型') as HTMLSelectElement).value).toBe('');expect((screen.getByLabelText('画面动作') as HTMLTextAreaElement).value).toBe('保留动作');expect(props.command).not.toHaveBeenCalled();
});
it('keeps a cleared Pexels connection and query across target switches and reopening without searching',async()=>{
 const service={id:'pexels-a',provider:'pexels',adapter:'pexels_video',mode:'search',models:[],connectionVersionId:'pexels-v1',connectionName:'Pexels A',executable:true};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[service]}]}})));
 const props={workspace,command:vi.fn(),onChange:vi.fn(),materials:[],preparation:true},view=render(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await chooseModel('视频','Pexels 素材检索');
 fireEvent.change(screen.getByLabelText('检索词'),{target:{value:'ocean'}});fireEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));fireEvent.click(screen.getByRole('button',{name:'清除模型选择'}));
 expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('选择视频模型');
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-2"/>);view.rerender(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);
 expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('选择视频模型');view.unmount();render(<WorkspaceVisualCandidatesPanel {...props} selectedTargetItemId="visual-1"/>);
 expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('选择视频模型');expect((screen.getByLabelText('检索词') as HTMLTextAreaElement).value).toBe('ocean');expect(props.command).not.toHaveBeenCalled();
});

it.each(['image','video'] as const)('requires explicit %s selection and adoption and preserves old candidates on append',async kind=>{
 const candidates=[1,2].map(i=>({...workspace.visualCandidates![0],id:kind+i,kind,usage:kind==='image'?'still' as const:'video' as const,relativePath:`${kind}-${i}.${kind==='image'?'png':'mp4'}`,durationSeconds:5}));
 const w={...workspace,clips:[workspace.clips[0]],visualCandidates:candidates};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?{...preparation,adoptionId:'explicit',candidateId:kind+'2',impact:{...preparation.impact,appliedSeconds:3,deltaSeconds:0}}:w);const props={workspace:w,command,onChange:vi.fn(),materials:[],preparation:true};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 if(kind==='video')fireEvent.click(screen.getByRole('tab',{name:'视频'}));const label=kind==='image'?'图片':'视频';expect(screen.queryByRole('button',{name:'采用到当前镜头'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:`预览${label}候选 02`}));expect(command).not.toHaveBeenCalled();
 const strip=screen.getByRole('group',{name:`${label}候选缩略图`});
 expect(within(strip).getByText('02')).toBeTruthy();
 expect(screen.getByText('候选 02 / 02')).toBeTruthy();
 if(kind==='video'){
  fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
  fireEvent.click(screen.getByText('裁剪与时长',{selector:'summary'}));
  fireEvent.change(screen.getByLabelText('视频使用起点（秒）'),{target:{value:'0.5'}});
  fireEvent.change(screen.getByLabelText('视频使用终点（秒）'),{target:{value:'4'}});
  expect(command).not.toHaveBeenCalled();
 }
 if(kind==='image')fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
 fireEvent.click(screen.getByRole('button',{name:'采用到当前镜头'}));const review=await screen.findByRole('group',{name:'采用前核对'});expect(review.closest('.workspace-result-footer')).toBeTruthy();expect(screen.getByText(/镜头时长保持 3.00 秒/)).toBeTruthy();expect(screen.queryByRole('dialog',{name:'采用前核对'})).toBeNull();fireEvent.click(within(review).getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:3,candidateId:kind+'2',adoptionId:'explicit'}));expect(command).toHaveBeenCalledWith('prepareWorkspaceVisualCandidate',expect.objectContaining({candidateId:kind+'2',durationPolicy:'keep-target',motionPolicy:'preserve-target',...(kind==='video'?{sourceInSeconds:0.5,sourceOutSeconds:4}:{})}));
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} currentVisualKind={kind} currentVisualPath={candidates[1].relativePath} workspace={{...w,visualCandidates:[...candidates,{...candidates[0],id:'added',relativePath:'added'}]}}/>);
 expect(screen.getAllByRole('button',{name:new RegExp(`预览${label}候选`)})).toHaveLength(3);expect(screen.getByRole('button',{name:`预览${label}候选 02，已采用`}).getAttribute('aria-pressed')).toBe('true');if(kind==='image')fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));expect((screen.getByRole('button',{name:'已采用'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:`预览${label}候选 03`}));expect(command).toHaveBeenCalledTimes(2);
});
it('keeps stale and read-only candidates visible while disallowing adoption',()=>{
 const w={...workspace,visualCandidates:[{...workspace.visualCandidates![0],kind:'image' as const,status:'stale' as const}]};const props={workspace:w,command:vi.fn(),onChange:vi.fn(),materials:[],preparation:true};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01'}));fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));expect((screen.getByRole('button',{name:'采用到当前镜头'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/输入已变化/)).toBeTruthy();
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...w,visualCandidates:[{...w.visualCandidates[0],status:'available'}]}} readOnly/>);expect(screen.queryByRole('button',{name:'采用到当前镜头'})).toBeNull();expect(screen.getByRole('region',{name:'画面制作记录'})).toBeTruthy();expect(props.command).not.toHaveBeenCalled();
});

it.each(['image','video'] as const)('adds an existing episode %s to results without adopting or submitting generation',async kind=>{
 const w={...workspace,clips:[workspace.clips[0]],visualCandidates:[]};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));const command=vi.fn(async()=>w);render(<WorkspaceVisualCandidatesPanel preparation workspace={w} command={command} onChange={vi.fn()} materials={[{id:'existing',material_type:kind,source_path:'existing.'+(kind==='image'?'png':'mp4')}]}/>);
 if(kind==='video')fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByText('从本期素材选取'));expect(command).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText(`选择本期${kind==='image'?'图片':'视频'}`),{target:{value:'existing'}});await waitFor(()=>expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',expect.objectContaining({targetItemId:'visual-1',materialRevisionId:'existing',usage:kind==='image'?'still':'video'})));expect(command).toHaveBeenCalledTimes(1);
});
it('编辑器视频提示词保留超限全文并解释上限，阻止生成',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(videoCatalog)));const command=vi.fn();render(<WorkspaceVisualCandidatesPanel workspace={{...workspace,visualCandidates:[]}} command={command} onChange={()=>{}} materials={[]}/>);
 fireEvent.change(screen.getByLabelText('画面候选来源'),{target:{value:'generate'}});await screen.findByRole('combobox',{name:'视频连接与模型'});
 fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'动'.repeat(1501)}});
 expect(screen.getByRole('alert').textContent).toContain('视频提示词超出 1 个字符');
 expect(screen.getByLabelText('画面动作')).toHaveProperty('value','动'.repeat(1501));
 expect(screen.getByRole('button',{name:'生成画面候选'})).toHaveProperty('disabled',true);expect(command).not.toHaveBeenCalled();
});

it('assigns video roles by shared input order and submits only the selected mode’s compatible materials',async()=>{
 const materials=[
  {id:'first',material_type:'image',source_path:'开场.png',storage_path:'start.png'},
  {id:'last',material_type:'image',source_path:'结尾.png',storage_path:'end.png'},
  {id:'image-ref',material_type:'image',source_path:'造型.png',storage_path:'style.png'},
  {id:'video-ref',material_type:'video',source_path:'运镜.mp4',storage_path:'camera.mp4'},
 ];
 const firstFrame={max:1,min:1},firstFrameMode={id:'first-frame',label:'首帧生成',inputs:{firstFrame}};
 const modes=[
  firstFrameMode,
  {id:'keyframes',label:'首尾帧',inputs:{firstFrame,lastFrame:{max:1,min:1}}},
  {id:'references',label:'参考生成',allowAssetVideoSource:true,inputs:{referenceImages:{max:3},referenceVideos:{max:2}}},
 ];
 const service={...videoCatalog.serviceCatalog.groups[0].services[0],
  models:[videoChoice.model,'another-model'],videoGenerationModes:{[videoChoice.model]:modes,'another-model':[firstFrameMode]}};
 const w:ProductionWorkspace={...workspace,visualCandidates:[],visualTargets:[
  {targetItemId:'visual-1',voiceMode:'source',durationSeconds:4,providerDurationSeconds:4,minimumSeconds:4,maximumSeconds:15},
 ]};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'
  ?{serviceCatalog:{groups:[{capability:'video',services:[service]}]}}:{workspace:w})));
 const command=vi.fn(async(_name:string,_data:unknown)=>w);
 function Shelf(){
  const selection=useWorkspaceMaterialSelection()!;
  return <>{materials.map(m=><button key={m.id} draggable onDragStart={()=>selection.drag(m.id)} onDragEnd={()=>selection.drag('')}>{m.id}</button>)}</>;
 }
 render(<WorkspaceMaterialSelectionProvider materials={materials}><Shelf/><WorkspaceVisualCandidatesPanel preparation
  workspace={w} command={command} onChange={vi.fn()} materials={materials}/></WorkspaceMaterialSelectionProvider>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));
 await chooseVideo();
 const inputs=within(screen.getByRole('region',{name:'画面输入'}));
 const setMode=async(value:string)=>{fireEvent.click(screen.getByRole('button',{name:'画面输入模式'}));fireEvent.change(screen.getByLabelText('生成模式'),{target:{value}});await closeComposer();};
 const drop=(id:string)=>{
  const shelfItem=screen.getByRole('button',{name:id});
  const dataTransfer={types:[workspaceMaterialDragType],getData:(type:string)=>type===workspaceMaterialDragType?id:''};
  fireEvent.dragStart(shelfItem,{dataTransfer});
  fireEvent.drop(screen.getByLabelText('视频生成输入框'),{dataTransfer});
  fireEvent.dragEnd(shelfItem,{dataTransfer});
 };
 drop('first');
 await setMode('keyframes');
 expect(inputs.getByAltText('已选视频首帧')).toBeTruthy();
 drop('last');
 drop('video-ref');
 drop('image-ref');
 expect(inputs.getAllByText('本次不会提交')).toHaveLength(2);
 fireEvent.click(inputs.getByRole('button',{name:'前移 结尾.png'}));
 expect(inputs.getByAltText('已选视频首帧').getAttribute('src')).toContain('end.png');
 await setMode('references');
 expect(inputs.queryByAltText('已选视频首帧')).toBeNull();
 expect(inputs.queryByText('本次不会提交')).toBeNull();
 expect(inputs.getByText('参考图 3')).toBeTruthy();
 expect(inputs.getByLabelText('运镜.mp4')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'镜头缓慢推近'}});
 const generate=screen.getByRole('button',{name:'生成视频'});
 expect(generate).toHaveProperty('disabled',true);
 const source=inputs.getByLabelText('参考视频地址 · 运镜.mp4');
 fireEvent.change(source,{target:{value:'asset://camera-reference'}});
 fireEvent.click(generate);
 await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));
 expect(command.mock.calls[0][1]).toMatchObject({videoMode:'references',visualInputs:[
  {role:'referenceImages',materialRevisionId:'last'},
  {role:'referenceImages',materialRevisionId:'first'},
  {role:'referenceVideos',materialRevisionId:'video-ref',source:'asset://camera-reference'},
  {role:'referenceImages',materialRevisionId:'image-ref'},
 ]});
 expect(command.mock.calls[0][1]).not.toHaveProperty('firstFrameMaterialRevisionId');
 await setMode('keyframes');
 expect(inputs.getByAltText('已选视频尾帧')).toBeTruthy();
 fireEvent.click(generate);
 await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));
 expect(command.mock.calls[1][1]).toMatchObject({videoMode:'keyframes',visualInputs:[
  {role:'firstFrame',materialRevisionId:'last'},{role:'lastFrame',materialRevisionId:'first'},
 ]});
 await chooseModel('视频','another-model');
 expect(inputs.queryByLabelText('生成模式')).toBeNull();
 expect(inputs.getByAltText('已选视频首帧')).toBeTruthy();
 for(const label of ['开场.png','造型.png','运镜.mp4'])expect(inputs.getByText(new RegExp(label))).toBeTruthy();
 fireEvent.change(screen.getByLabelText('画面动作'),{target:{value:'镜头缓慢推近'}});
 fireEvent.click(screen.getByRole('button',{name:'生成视频'}));
 await waitFor(()=>expect(command).toHaveBeenCalledTimes(3));
 const payload=command.mock.calls[2][1] as Record<string,unknown>;
 expect(payload.firstFrameMaterialRevisionId).toBe('last');
 expect(JSON.stringify(payload)).not.toMatch(/"first"|"image-ref"|"video-ref"/);
});

it('returns focus to the image action menu after cancelling inline adoption',async()=>{
 const image={...workspace.visualCandidates![0],kind:'image' as const};
 const w={...workspace,visualCandidates:[image]};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));
 const command=vi.fn(async()=>({...preparation,impact:{...preparation.impact,currentSeconds:3,sourceSeconds:3,appliedSeconds:3,deltaSeconds:0,endSeconds:3}}));
 render(<WorkspaceVisualCandidatesPanel preparation workspace={w} command={command} onChange={vi.fn()} materials={[]}/>);
 const menu=screen.getByText('更多操作',{selector:'summary'});
 fireEvent.click(menu);fireEvent.click(screen.getByRole('button',{name:'采用到当前镜头'}));
 const review=await screen.findByRole('group',{name:'采用前核对'});
 fireEvent.click(within(review).getByRole('button',{name:'取消'}));
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByText('更多操作',{selector:'summary'})));
 expect(command).toHaveBeenCalledTimes(1);
 expect(command).not.toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',expect.anything());
 expect(screen.getByText('更多操作',{selector:'summary'}).closest('details')?.open).toBe(false);
});

it('navigates the vertical candidate rail with up/down and retains left/right, Home/End without adopting',()=>{
 const candidates=Array.from({length:8},(_,i)=>({...workspace.visualCandidates![0],id:'image-'+i,kind:'image' as const,relativePath:'image-'+i+'.png'}));
 const command=vi.fn();render(<WorkspaceVisualCandidatesPanel preparation workspace={{...workspace,visualCandidates:candidates}} command={command} onChange={vi.fn()} materials={[]}/>);
 const rail=screen.getByRole('group',{name:'图片候选缩略图'}),buttons=within(rail).getAllByRole('button');
 fireEvent.click(buttons[0]);buttons[0].focus();fireEvent.keyDown(buttons[0],{key:'ArrowDown'});expect(buttons[1].getAttribute('aria-pressed')).toBe('true');expect(document.activeElement).toBe(buttons[1]);
 fireEvent.keyDown(buttons[1],{key:'End'});expect(buttons[7].getAttribute('aria-pressed')).toBe('true');fireEvent.keyDown(buttons[7],{key:'ArrowDown'});expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
 fireEvent.keyDown(buttons[0],{key:'ArrowUp'});expect(buttons[7].getAttribute('aria-pressed')).toBe('true');fireEvent.keyDown(buttons[7],{key:'Home'});expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
 fireEvent.keyDown(buttons[0],{key:'ArrowRight'});expect(buttons[1].getAttribute('aria-pressed')).toBe('true');fireEvent.keyDown(buttons[1],{key:'ArrowLeft'});expect(buttons[0].getAttribute('aria-pressed')).toBe('true');expect(command).not.toHaveBeenCalled();
});

it('downloads the selected original image through the existing fingerprinted artifact route',()=>{
 const candidates=[1,2].map(i=>({...workspace.visualCandidates![0],id:'download-'+i,kind:'image' as const,usage:'still' as const,relativePath:`image-${i}.png`,sha256:String(i).repeat(64)}));
 const command=vi.fn();render(<WorkspaceVisualCandidatesPanel preparation workspace={{...workspace,clips:[workspace.clips[0]],visualCandidates:candidates}} command={command} onChange={()=>{}} materials={[]}/>);
 for(const i of [1,2]){
  fireEvent.click(screen.getByRole('button',{name:`预览图片候选 0${i}`}));
  const link=screen.getByRole('link',{name:'下载图片'}),href=new URL(link.getAttribute('href')!,'http://localhost');
  expect(href.pathname).toBe('/_local-artifact');expect(href.searchParams.get('episode')).toBe('episode');expect(href.searchParams.get('path')).toBe(`image-${i}.png`);expect(href.searchParams.get('sha256')).toBe(String(i).repeat(64));expect(href.searchParams.get('download')).toBe('1');expect(link.hasAttribute('download')).toBe(true);
 }
 expect(command).not.toHaveBeenCalled();
});

it('switches video generation and Pexels in one picker while preserving independent drafts and search settings',async()=>{
 const search={id:'pexels-a',provider:'pexels',adapter:'pexels_video',mode:'search',models:[],connectionVersionId:'pexels-v1',connectionName:'Pexels A',executable:true};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[...videoCatalog.serviceCatalog.groups[0].services,search]}]}})));
 const command=vi.fn(),props={workspace,command,onChange:vi.fn(),materials:[],preparation:true},view=render(<WorkspaceMaterialSelectionProvider materials={[]}><WorkspaceVisualCandidatesPanel {...props}/></WorkspaceMaterialSelectionProvider>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));await chooseModel('视频','doubao-seedance-2-0-260128');fireEvent.change(screen.getByRole('textbox',{name:'画面动作'}),{target:{value:'缓慢推近，保留人物'}});
 expect(screen.queryByRole('button',{name:'素材检索'})).toBeNull();await chooseModel('视频','Pexels 素材检索');expect(screen.queryByRole('button',{name:'生成时长'})).toBeNull();expect(screen.queryByRole('button',{name:'添加画面参考素材'})).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'检索词'}),{target:{value:'mountain clouds'}});fireEvent.click(screen.getByRole('button',{name:'Pexels 方向'}));fireEvent.change(screen.getByRole('combobox',{name:'Pexels 方向'}),{target:{value:'landscape'}});fireEvent.click(screen.getByRole('button',{name:'关闭Pexels 方向'}));
 await chooseModel('视频','doubao-seedance-2-0-260128');expect((screen.getByRole('textbox',{name:'画面动作'}) as HTMLTextAreaElement).value).toBe('缓慢推近，保留人物');expect(screen.queryByRole('button',{name:'Pexels 方向'})).toBeNull();
 await chooseModel('视频','Pexels 素材检索');expect((screen.getByRole('textbox',{name:'检索词'}) as HTMLTextAreaElement).value).toBe('mountain clouds');expect(screen.getByRole('button',{name:'Pexels 方向'}).textContent).toContain('横屏');
 fireEvent.change(screen.getByRole('textbox',{name:'检索词'}),{target:{value:'山'.repeat(101)}});expect(screen.getByRole('alert').textContent).toContain('检索词超出 1 个字符');expect(screen.getByRole('button',{name:'检索视频'})).toHaveProperty('disabled',true);fireEvent.change(screen.getByRole('textbox',{name:'检索词'}),{target:{value:'mountain clouds'}});
 view.unmount();render(<WorkspaceMaterialSelectionProvider materials={[]}><WorkspaceVisualCandidatesPanel {...props}/></WorkspaceMaterialSelectionProvider>);expect((screen.getByRole('textbox',{name:'检索词'}) as HTMLTextAreaElement).value).toBe('mountain clouds');expect(command).not.toHaveBeenCalled();
});
it('restores legacy Pexels query and connection without converting them to a video generation selection',async()=>{
 const selection={capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:'pexels-v1'};
 sessionStorage.setItem('loop-visual-draft:workspace:visual-1',JSON.stringify({tab:'video',origin:{image:'material',video:'search'},settings:{size:'864x1536',quality:'auto',count:1}}));
 sessionStorage.setItem('loop-pexels-draft:workspace:visual-1',JSON.stringify({query:'旧检索词',orientation:'landscape',size:'large',page:'3',selection}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[{id:'pexels-a',...selection,mode:'search',models:[],connectionName:'Pexels A',executable:true}]}]}})));
 const command=vi.fn();render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('Pexels 素材检索'));expect((screen.getByRole('textbox',{name:'检索词'}) as HTMLTextAreaElement).value).toBe('旧检索词');expect(screen.getByRole('button',{name:'Pexels 页码'}).textContent).toContain('3');expect(command).not.toHaveBeenCalled();
});

it('formats the actual voice duration without rounding the generation request',async()=>{
 const duration=56/30,w={...workspace,selectedImages:[{targetItemId:'visual-1',candidateId:'first-image',materialRevisionId:'first'}],visualTargets:[{targetItemId:'visual-1',voiceMode:'tts' as const,durationSeconds:duration,providerDurationSeconds:4,minimumSeconds:4,maximumSeconds:15,defaultSelection:{...videoChoice,capability:'video' as const}}]};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?videoCatalog:{workspace:w})));
 const command=vi.fn(async()=>w),materials=[{id:'first',material_type:'image',source_path:'frame.png',storage_path:'frame.png'}];
 render(<WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceVisualCandidatesPanel preparation workspace={w} command={command} onChange={()=>{}} materials={materials}/></WorkspaceMaterialSelectionProvider>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain(videoChoice.model));
 expect(screen.getByRole('button',{name:'生成时长'}).textContent).toBe('1.87 秒');fireEvent.click(screen.getByRole('button',{name:'生成时长'}));expect(screen.getByText('按当前口播使用 1.87 秒，服务请求 4 秒。')).toBeTruthy();expect(screen.getByLabelText('生成时长（秒）')).toHaveProperty('readOnly',true);expect(screen.getByLabelText('生成时长（秒）').getAttribute('aria-describedby')).toBeTruthy();expect(screen.getByText('本镜已采用口播，时长随该音频锁定；更换或撤回采用后会重新计算。')).toBeTruthy();await closeComposer();
 fireEvent.change(screen.getByRole('textbox',{name:'画面动作'}),{target:{value:'镜头缓慢推近'}});fireEvent.click(screen.getByRole('button',{name:'生成视频'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceVisualCandidate',expect.objectContaining({durationSeconds:duration})));
});
