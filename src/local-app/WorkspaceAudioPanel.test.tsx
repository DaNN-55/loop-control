import {useState} from 'react';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceAudioPanel,WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const workspace={id:'w',episodeId:'e',revision:2,project:{sha256:'h'},clips:[{id:'c',itemId:'visual',shotId:'S1',text:'镜头',source:null}],audio:{mix:{voices:[{shotId:'S1',mode:'none',gainDb:0,ambienceGainDb:null,sourceItemId:null,sourceAssetId:null}],sounds:[]},preparations:[]}} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('editing the main-voice form does not alter the native timeline until explicit apply',async()=>{
 const command=vi.fn(async()=>workspace);render(<WorkspaceAudioPanel workspace={workspace} command={command} onChange={()=>{}}/>);fireEvent.change(screen.getByLabelText('主声音'),{target:{value:'tts'}});expect(command).not.toHaveBeenCalled();expect((screen.getByLabelText('保留低音量原声') as HTMLInputElement).checked).toBe(false);fireEvent.click(screen.getByRole('button',{name:'应用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('mixWorkspaceAudio',expect.objectContaining({edit:expect.objectContaining({mode:'tts',ambienceGainDb:null,visualItemIds:['visual']})})));
});
it('manual preparation is an explicit durable Owner action and keeps query out of the manual request',async()=>{
 const command=vi.fn(async()=>workspace);render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[{id:'m',material_type:'audio',source_path:'music.mp3'}]}/>);fireEvent.change(screen.getByLabelText('来源'),{target:{value:'m'}});expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'准备人工音频'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'bgm',materialRevisionId:'m',anchor:'absolute'})));
});
it('shows the selected native source window and never presents partial source coverage as a whole-shot voice',()=>{
 const value=structuredClone(workspace);value.audio!.mix.voices[0]={...value.audio!.mix.voices[0],mode:'source',coverage:'partial',startSeconds:0,durationSeconds:1,shotDurationSeconds:2,sourceStartSeconds:1,sourceLabel:'镜头实例 1',alignmentReady:false};render(<WorkspaceAudioPanel workspace={value} command={vi.fn()} onChange={()=>{}}/>);expect(screen.getByText('镜头实例 1 · 0.00–1.00s · 源 1.00s')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('原声仅覆盖部分镜头');expect(screen.getByRole('status').textContent).toContain('整段声学对齐不可用');
});

const effect=(id:string,shotId='S1',description=id)=>({id,kind:'sfx',shotId,sourceItemId:null,description,query:null,anchor:'shot',offsetSeconds:.2,durationSeconds:1,taskId:null,status:'ready',error:null,audioTrackId:null,relativePath:`episodes/e/${id}.mp3`,sha256:'a'.repeat(64),fileSize:10,adoptedItemId:null,source:{provider:'manual'}});
const sound=(id:string)=>({itemId:`workspace-sfx-${id}`,kind:'sfx' as const,gainDb:-6,duckDepthDb:0,startSeconds:.2,durationSeconds:1});
it('keeps two adopted effects on the selected shot and removes only the explicit sound instance',async()=>{
 const a={...effect('one','S1','脚步声'),adoptedItemId:'workspace-sfx-one'},b={...effect('two','S1','门铃声'),adoptedItemId:'workspace-sfx-two'},other=effect('other','S2','另一镜头的声音'),music={...effect('music','S2','整期背景乐'),kind:'bgm'};
 const w={...workspace,clips:[...workspace.clips,{id:'c2',itemId:'v2',shotId:'S2',text:'另一镜',source:null}],audio:{mix:{voices:[],sounds:[sound('one'),sound('two')]},preparations:[a,b,other,music]}} as ProductionWorkspace,command=vi.fn(async()=>w);
 render(<WorkspaceAudioPreparation workspace={w} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 const list=screen.getByRole('region',{name:'本镜头音效'});expect(within(list).getByText('脚步声')).toBeTruthy();expect(within(list).getByText('门铃声')).toBeTruthy();expect(within(list).queryByText('另一镜头的声音')).toBeNull();expect(screen.getByText('整期背景乐')).toBeTruthy();expect(within(list).getAllByRole('button',{name:'移除'})).toHaveLength(2);expect(command).not.toHaveBeenCalled();
 fireEvent.click(within(list).getAllByRole('button',{name:'移除'})[1]);await waitFor(()=>expect(command).toHaveBeenCalledWith('mixWorkspaceAudio',{episodeId:'e',workspaceId:'w',expectedRevision:2,edit:{kind:'sound',workspaceId:'w',itemId:'workspace-sfx-two',gainDb:-6,duckDepthDb:0,remove:true}}));
});
it('preserves music drafts while switching shots without exposing effect creation',()=>{
 const props={workspace,command:vi.fn(),onChange:()=>{}};const view=render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);fireEvent.change(screen.getByLabelText('用途'),{target:{value:'配乐草稿'}});fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'piano'}});
 view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S2"/>);expect((screen.getByLabelText('用途') as HTMLInputElement).value).toBe('整期配乐');
 view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);expect((screen.getByLabelText('用途') as HTMLInputElement).value).toBe('配乐草稿');expect((screen.getByLabelText('英文检索词') as HTMLInputElement).value).toBe('piano');expect(screen.queryByLabelText('锚点')).toBeNull();
});
it('explicitly adopts successive historical effects without replacing the first one',async()=>{
 const a=effect('one','S1','脚步声'),b=effect('two','S1','风声'),initial={...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[a,b]}},firstAdopted={...initial,revision:3,audio:{mix:{voices:[],sounds:[sound('one')]},preparations:[{...a,adoptedItemId:'workspace-sfx-one'},b]}},secondAdopted={...firstAdopted,revision:4,audio:{mix:{voices:[],sounds:[sound('one'),sound('two')]},preparations:[{...a,adoptedItemId:'workspace-sfx-one'},{...b,adoptedItemId:'workspace-sfx-two'}]}};
 const command=vi.fn().mockResolvedValueOnce(firstAdopted).mockResolvedValueOnce(secondAdopted);
 function Harness(){const [value,setValue]=useState(initial as ProductionWorkspace);return <WorkspaceAudioPreparation workspace={value} command={command} onChange={setValue} selectedShotId="S1"/>;}render(<Harness/>);
 fireEvent.click(screen.getAllByRole('button',{name:'加入镜头'})[0]);await waitFor(()=>expect(screen.getAllByRole('button',{name:'移除'})).toHaveLength(1));
 fireEvent.click(screen.getByRole('button',{name:'加入镜头'}));await waitFor(()=>expect(screen.getAllByRole('button',{name:'移除'})).toHaveLength(2));
 expect(command.mock.calls).toEqual([['adoptWorkspaceAudio',expect.objectContaining({preparationId:'one',expectedRevision:2})],['adoptWorkspaceAudio',expect.objectContaining({preparationId:'two',expectedRevision:3})]]);
});
it('registers a local MP3 as music and never prepares or adopts it automatically',async()=>{
 const command=vi.fn(async()=>({id:'uploaded-music'}));render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);fireEvent.change(screen.getByLabelText('上传配乐'),{target:{files:[new File(['audio'],'music.mp3',{type:'audio/mpeg'})]}});await waitFor(()=>expect((screen.getByLabelText('来源') as HTMLSelectElement).value).toBe('uploaded-music'));expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenCalledWith('importMaterial',expect.objectContaining({episodeId:'e',materialPurpose:'background_music',sourcePath:'music.mp3'}));
});
it('uses the native bridge for existing sound edits and blocks adding a candidate behind an open editor',async()=>{
 const p={...effect('one','S1','已加入声音'),adoptedItemId:'workspace-sfx-one'},pending=effect('two','S1','待加入声音'),doc={activeTimelineId:'t',assets:[],timelines:[{id:'t',fps:30,items:[{id:'visual',kind:'video',startFrame:0,durationInFrames:90},{id:'workspace-sfx-one',kind:'audio',startFrame:6,durationInFrames:30,volume:.5,track:'audio',loopControlAudio:{kind:'sfx',preparationId:'one'}}],tracks:{audio:{kind:'audio',audioRouting:{duckDepthDb:0}}}}]} as unknown as import('../worker/openchatcutProject').OpenChatCutProject;
 const bridge={connected:true,inspect:vi.fn(async()=>({document:doc})),applyNativeEdit:vi.fn(async()=>doc)} as unknown as import('./EmbeddedStudioHost').EmbeddedStudioBridge,command=vi.fn(),w={...workspace,audio:{mix:{voices:[],sounds:[sound('one')]},preparations:[p,pending]}} as ProductionWorkspace;
 render(<WorkspaceAudioPreparation workspace={w} command={command} onChange={()=>{}} selectedShotId="S1" bridge={bridge}/>);await waitFor(()=>expect(bridge.inspect).toHaveBeenCalled());expect((screen.getByRole('button',{name:'加入镜头'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'应用'}));await waitFor(()=>expect(bridge.applyNativeEdit).toHaveBeenCalledWith('apply-audio-mix',{edit:expect.objectContaining({kind:'sound',itemId:'workspace-sfx-one',workspaceId:'w'})}));expect(command).not.toHaveBeenCalled();
});
it('keeps a cleared music connection blank after saving a default, switching shots and reopening',async()=>{
 sessionStorage.clear();const service={id:'sound-a',provider:'freesound',adapter:'freesound_audio',connectionVersionId:'sound-v1',connectionName:'Sound A',executable:true};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[service]}]}})));
 const command=vi.fn(),props={workspace,command,onChange:vi.fn()},view=render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);await screen.findByRole('option',{name:/Sound A/});fireEvent.change(screen.getByLabelText('检索服务'),{target:{value:'sound-a'}});fireEvent.click(screen.getByRole('button',{name:'设为配乐默认'}));fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'piano'}});fireEvent.change(screen.getByLabelText('检索服务'),{target:{value:''}});expect((screen.getByLabelText('检索服务') as HTMLSelectElement).value).toBe('');view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S2"/>);view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);expect((screen.getByLabelText('检索服务') as HTMLSelectElement).value).toBe('');view.unmount();render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);await screen.findByRole('option',{name:/Sound A/});expect((screen.getByLabelText('检索服务') as HTMLSelectElement).value).toBe('');expect((screen.getByLabelText('英文检索词') as HTMLInputElement).value).toBe('piano');expect(command).not.toHaveBeenCalled();vi.unstubAllGlobals();sessionStorage.clear();
});

it('presents completed-project mixing as saved facts without write controls',()=>{
 const command=vi.fn();const saved={...workspace,audio:{...workspace.audio!,mix:{voices:[{...workspace.audio!.mix.voices[0],mode:'source' as const,gainDb:-3,ambienceGainDb:-24,coverage:'partial' as const,sourceLabel:'原片音轨',startSeconds:0,durationSeconds:2}],sounds:[{itemId:'sound',kind:'sfx' as const,gainDb:-12,duckDepthDb:4,startSeconds:1,durationSeconds:2}]}}};
 render(<WorkspaceAudioPanel workspace={saved} command={command} onChange={()=>{}} readOnly/>);
 expect(screen.getByRole('table',{name:'已保存主声混音'}).textContent).toContain('-3 dB');expect(screen.getByText('原声仅覆盖部分镜头')).toBeTruthy();expect(screen.getByText('环境声 -24 dB')).toBeTruthy();expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByRole('button',{name:'应用'})).toBeNull();expect(screen.getByRole('table',{name:'已保存配乐与音效'}).textContent).toContain('-12 dB / 4 dB');expect(command).not.toHaveBeenCalled();
});

it('retires sound-effect creation and default entry even when an old effect draft is stored',async()=>{
 sessionStorage.setItem('loop-audio-draft:w:S1',JSON.stringify({kind:'sfx',description:'旧音效草稿',query:'door bell',anchor:'shot'}));
 const command=vi.fn();render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" materials={[{id:'m',material_type:'audio',source_path:'music.mp3'}]}/>);
 expect(screen.queryByRole('button',{name:'添加音效'})).toBeNull();expect(screen.queryByRole('option',{name:'音效'})).toBeNull();expect(screen.queryByRole('button',{name:'设为本期默认'})).toBeNull();
 expect((screen.getByLabelText('类型') as HTMLSelectElement).value).toBe('bgm');expect((screen.getByLabelText('英文检索词') as HTMLInputElement).value).toBe('');
 fireEvent.change(screen.getByLabelText('来源'),{target:{value:'m'}});fireEvent.click(screen.getByRole('button',{name:'准备人工音频'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'bgm',materialRevisionId:'m',anchor:'absolute'})));
});

it('keeps a historical failed audio preparation recoverable with frozen inputs and protects unknown results',async()=>{
 const failed={...effect('failed'),taskId:'original-task',status:'failed',generationTask:{id:'failed',taskId:'original-task',status:'failed',error:'检索中断',provider:'freesound',model:'freesound-preview-v1'}};
 const command=vi.fn(async()=>workspace),view=render(<WorkspaceAudioPreparation workspace={{...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[failed]}} as ProductionWorkspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 fireEvent.click(screen.getByRole('button',{name:'重试原音频准备'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',preparationId:'failed',retry:true})));
 view.rerender(<WorkspaceAudioPreparation workspace={{...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[{...failed,generationTask:{...failed.generationTask,submissionUnknown:true,submissionOutcome:'started'}}]}} as ProductionWorkspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 expect(screen.queryByRole('button',{name:'重试原音频准备'})).toBeNull();expect(screen.getByRole('button',{name:'刷新核对结果'})).toBeTruthy();expect(screen.getByText(/当前结果未知，不能再次提交生成/)).toBeTruthy();expect(command).toHaveBeenCalledTimes(1);
});

it('keeps original-audio extraction available without an external connection',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const command=vi.fn(async()=>workspace),project={activeTimelineId:'t',assets:[],timelines:[{id:'t',fps:30,items:[{id:'visual',kind:'video',name:'原片画面',startFrame:0,durationInFrames:90,srcInFrame:30}]}]} as unknown as import('../worker/openchatcutProject').OpenChatCutProject;
 render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" project={project}/>);
 fireEvent.change(screen.getByLabelText('类型'),{target:{value:'source'}});fireEvent.change(screen.getByLabelText('原片画面'),{target:{value:'visual'}});expect(screen.queryByLabelText('检索服务')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'提取原片声音'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'source',sourceItemId:'visual'})));
});

it('keeps local sound-effect import and explicit preparation without search, connection or default controls',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const command=vi.fn(async(_name:string,_data:unknown)=>workspace);render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" materials={[{id:'own-effect',material_type:'audio',source_path:'own-bell.mp3'}]}/>);
 fireEvent.change(screen.getByLabelText('类型'),{target:{value:'sfx'}});
 expect(screen.getByRole('option',{name:'导入音效'})).toBeTruthy();expect(screen.queryByLabelText('检索服务')).toBeNull();expect(screen.queryByLabelText('英文检索词')).toBeNull();expect(screen.queryByRole('button',{name:'设为配乐默认'})).toBeNull();
 expect((screen.getByRole('button',{name:'准备导入音效'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.change(screen.getByLabelText('来源'),{target:{value:'own-effect'}});fireEvent.change(screen.getByLabelText('偏移（秒）'),{target:{value:'.4'}});fireEvent.click(screen.getByRole('button',{name:'准备导入音效'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',materialRevisionId:'own-effect',anchor:'shot',shotId:'S1',offsetSeconds:.4})));
 expect(command.mock.calls[0][1]).not.toHaveProperty('selection');
});
