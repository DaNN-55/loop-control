import {useState} from 'react';
import {act,render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceAudioPanel,WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const workspace={id:'w',episodeId:'e',revision:2,project:{sha256:'h'},clips:[{id:'c',itemId:'visual',shotId:'S1',text:'镜头',source:null}],audio:{mix:{voices:[{shotId:'S1',mode:'none',gainDb:0,ambienceGainDb:null,sourceItemId:null,sourceAssetId:null}],sounds:[]},preparations:[]}} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();sessionStorage.clear();});
function selectAudio(id:string){fireEvent.drop(screen.getByRole('group',{name:'音频输入'}),{dataTransfer:{types:['application/x-loop-workspace-material'],getData:()=>id,files:[]}});}
it('switches effect search and upload without losing the query or adopting audio',()=>{
 const command=vi.fn();
 const props={workspace,command,onChange:()=>{},selectedShotId:'S1',effectsOnly:true};
 const view=render(<WorkspaceAudioPreparation {...props}/>);
 fireEvent.change(screen.getByLabelText('音效意图或检索词'),{target:{value:'door creak'}});
 expect(screen.queryByRole('button',{name:'添加本地音效（MP3）'})).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'upload'}});
 expect(screen.getByRole('button',{name:'拖入音效文件'})).toBeTruthy();
 expect(screen.queryByLabelText('音效意图或检索词')).toBeNull();
 view.unmount();render(<WorkspaceAudioPreparation {...props}/>);
 expect(screen.getByRole('combobox',{name:'音效来源方式'})).toHaveProperty('value','upload');
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'search'}});
 expect(screen.getByLabelText('音效意图或检索词')).toHaveProperty('value','door creak');
 expect(command).not.toHaveBeenCalled();
});
it('imports an effect from the upload slot as a shot candidate without adoption',async()=>{
 const command=vi.fn(async(name:string)=>name==='importMaterial'?{id:'uploaded-effect'}:workspace);
 render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" effectsOnly/>);
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'upload'}});
 fireEvent.drop(screen.getByRole('button',{name:'拖入音效文件'}),{dataTransfer:{types:['Files'],getData:()=>'',files:[new File(['mp3'],'door.mp3',{type:'audio/mpeg'})]}});
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',materialRevisionId:'uploaded-effect',shotId:'S1',anchor:'shot'})));
 expect(command).toHaveBeenCalledWith('importMaterial',expect.objectContaining({materialPurpose:'sound_effect',sourcePath:'door.mp3'}));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['importMaterial','prepareWorkspaceAudio']);
});
it.each([0,.75])('uses filled script effect timing (%s) when explicitly preparing a local sound',async offset=>{
 const value=structuredClone(workspace);value.clips[0].renderPreferences={version:'workspace-render-preferences/v2',sfxStart:offset,sfxDuration:.4};
 const command=vi.fn(async()=>value);render(<WorkspaceAudioPreparation workspace={value} command={command} onChange={()=>{}} selectedShotId="S1" materials={[{id:'effect',material_type:'audio',source_path:'effect.mp3',material_purpose:'sound_effect'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'音效'}));expect(command).not.toHaveBeenCalled();selectAudio('effect');
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({durationSeconds:.4,offsetSeconds:offset,anchor:'shot',shotId:'S1'})));
});
it('editing the main-voice form does not alter the native timeline until explicit apply',async()=>{
 const command=vi.fn(async()=>workspace);render(<WorkspaceAudioPanel workspace={workspace} command={command} onChange={()=>{}}/>);fireEvent.change(screen.getByLabelText('主声音'),{target:{value:'tts'}});expect(command).not.toHaveBeenCalled();expect((screen.getByLabelText('保留低音量原声') as HTMLInputElement).checked).toBe(false);fireEvent.click(screen.getByRole('button',{name:'应用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('mixWorkspaceAudio',expect.objectContaining({edit:expect.objectContaining({mode:'tts',ambienceGainDb:null,visualItemIds:['visual']})})));
});
it('prepares a selected shelf audio explicitly without changing connection or adding search fields',async()=>{
 const command=vi.fn(async(_name:string,_data:unknown)=>workspace);render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[{id:'m',material_type:'audio',source_path:'music.mp3',material_purpose:'background_music'}]}/>);expect(command).not.toHaveBeenCalled();selectAudio('m');await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'bgm',materialRevisionId:'m',anchor:'absolute'})));expect(command.mock.calls[0][1]).not.toHaveProperty('selection');expect(screen.getByLabelText('英文检索词')).toBeTruthy();
});

it('shows the selected native source window and never presents partial source coverage as a whole-shot voice',()=>{
 const value=structuredClone(workspace);value.audio!.mix.voices[0]={...value.audio!.mix.voices[0],mode:'source',coverage:'partial',startSeconds:0,durationSeconds:1,shotDurationSeconds:2,sourceStartSeconds:1,sourceLabel:'镜头实例 1',alignmentReady:false};render(<WorkspaceAudioPanel workspace={value} command={vi.fn()} onChange={()=>{}}/>);expect(screen.getByText('镜头实例 1 · 0.00–1.00s · 源 1.00s')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('原声仅覆盖部分镜头');expect(screen.getByRole('status').textContent).toContain('整段声学对齐不可用');
});

const effect=(id:string,shotId='S1',description=id)=>({id,kind:'sfx',shotId,sourceItemId:null,description,query:null,anchor:'shot',offsetSeconds:.2,durationSeconds:1,taskId:null,status:'ready',error:null,audioTrackId:null,relativePath:`episodes/e/${id}.mp3`,sha256:'a'.repeat(64),fileSize:10,adoptedItemId:null,source:{provider:'manual'}});
const sound=(id:string)=>({itemId:`workspace-sfx-${id}`,kind:'sfx' as const,gainDb:-6,duckDepthDb:0,startSeconds:.2,durationSeconds:1});
it('keeps two adopted effects on the selected shot and removes only the explicit sound instance',async()=>{
 const a={...effect('one','S1','脚步声'),adoptedItemId:'workspace-sfx-one'},b={...effect('two','S1','门铃声'),adoptedItemId:'workspace-sfx-two'},other=effect('other','S2','另一镜头的声音'),music={...effect('music','S2','整期背景乐'),kind:'bgm'};
 const w={...workspace,clips:[...workspace.clips,{id:'c2',itemId:'v2',shotId:'S2',text:'另一镜',source:null}],audio:{mix:{voices:[],sounds:[sound('one'),sound('two')]},preparations:[a,b,other,music]}} as ProductionWorkspace,command=vi.fn(async()=>w);
 render(<WorkspaceAudioPreparation workspace={w} command={command} onChange={()=>{}} selectedShotId="S1"/>);fireEvent.click(screen.getByRole('button',{name:'音效'}));
 const list=screen.getByRole('region',{name:'本镜头音效'});expect(within(list).getByText('脚步声')).toBeTruthy();expect(within(list).getByText('门铃声')).toBeTruthy();expect(within(list).queryByText('另一镜头的声音')).toBeNull();expect(screen.queryByText('整期背景乐')).toBeNull();expect(within(list).getAllByRole('button',{name:/^撤回 /})).toHaveLength(2);expect(command).not.toHaveBeenCalled();
 fireEvent.click(within(list).getAllByRole('button',{name:/^撤回 /})[1]);await waitFor(()=>expect(command).toHaveBeenCalledWith('mixWorkspaceAudio',{episodeId:'e',workspaceId:'w',expectedRevision:2,edit:{kind:'sound',workspaceId:'w',itemId:'workspace-sfx-two',gainDb:-6,duckDepthDb:0,remove:true}}));
});
it('preserves music query and historical custom description across shots without a separate purpose field',async()=>{
 sessionStorage.setItem('loop-audio-draft-v2:w:episode-music',JSON.stringify({kind:'bgm',description:'配乐草稿',query:'',duration:1,anchor:'absolute',offset:0}));
 const command=vi.fn(async()=>workspace),props={workspace,command,onChange:()=>{}},view=render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'piano'}});view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S2"/>);view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','piano');expect(screen.queryByLabelText('用途')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'保存本期配乐配置'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceMusicSettings',expect.objectContaining({settings:{description:'配乐草稿',query:'piano',materialRevisionId:''}})));
});

it('explicitly adopts successive historical effects without replacing the first one',async()=>{
 const a=effect('one','S1','脚步声'),b=effect('two','S1','风声'),initial={...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[a,b]}},firstAdopted={...initial,revision:3,audio:{mix:{voices:[],sounds:[sound('one')]},preparations:[{...a,adoptedItemId:'workspace-sfx-one'},b]}},secondAdopted={...firstAdopted,revision:4,audio:{mix:{voices:[],sounds:[sound('one'),sound('two')]},preparations:[{...a,adoptedItemId:'workspace-sfx-one'},{...b,adoptedItemId:'workspace-sfx-two'}]}};
 const command=vi.fn().mockResolvedValueOnce(firstAdopted).mockResolvedValueOnce(secondAdopted);
 function Harness(){const [value,setValue]=useState(initial as ProductionWorkspace);return <WorkspaceAudioPreparation workspace={value} command={command} onChange={setValue} selectedShotId="S1"/>;}render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'音效'}));
 fireEvent.click(screen.getAllByRole('button',{name:'加入镜头'})[0]);await waitFor(()=>expect(screen.getAllByRole('button',{name:/^撤回 /})).toHaveLength(1));
 fireEvent.click(screen.getByRole('button',{name:'加入镜头'}));await waitFor(()=>expect(screen.getAllByRole('button',{name:/^撤回 /})).toHaveLength(2));
 expect(command.mock.calls).toEqual([['adoptWorkspaceAudio',expect.objectContaining({preparationId:'one',expectedRevision:2})],['adoptWorkspaceAudio',expect.objectContaining({preparationId:'two',expectedRevision:3})]]);
});
it('registers a local MP3 and prepares a candidate without replacing the existing prompt or adopting',async()=>{
 const command=vi.fn(async(name:string)=>name==='importMaterial'?{id:'uploaded-music'}:workspace);render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'piano'}});fireEvent.change(screen.getByLabelText('上传配乐'),{target:{files:[new File(['audio'],'music.mp3',{type:'audio/mpeg'})]}});await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({materialRevisionId:'uploaded-music',kind:'bgm'})));expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','piano');expect(command).toHaveBeenCalledTimes(2);expect(command).toHaveBeenCalledWith('importMaterial',expect.objectContaining({episodeId:'e',materialPurpose:'background_music',sourcePath:'music.mp3'}));expect(command.mock.calls.some(([name])=>name==='adoptWorkspaceAudio')).toBe(false);
});

it('keeps a cleared music connection blank after switching shots and reopening',async()=>{
 sessionStorage.clear();const service={id:'sound-a',provider:'freesound',adapter:'freesound_audio',connectionVersionId:'sound-v1',connectionName:'Sound A',executable:true};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[service]}]}})));
 const command=vi.fn(async(_name:string,_data:unknown)=>workspace);
 const props={workspace,command,onChange:vi.fn()};
 const view=render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);
 const openSettings=async()=>{
  fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
  await screen.findByRole('menuitemradio',{name:/Freesound/});
  return screen.getByRole('menu',{name:'音频来源'});
 };
 await openSettings();fireEvent.click(screen.getByRole('menuitemradio',{name:/Freesound/}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'选择音频来源'})).toBeNull());
 fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'piano'}});
 await openSettings();fireEvent.click(screen.getByRole('button',{name:'清除来源选择'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'选择音频来源'})).toBeNull());
 view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S2"/>);
 view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);
 await openSettings();expect(screen.getByRole('menuitemradio',{name:/Freesound/}).getAttribute('aria-checked')).toBe('false');fireEvent.click(screen.getByRole('button',{name:'关闭音频来源'}));
 view.unmount();
 render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);
 await openSettings();expect(screen.getByRole('menuitemradio',{name:/Freesound/}).getAttribute('aria-checked')).toBe('false');fireEvent.click(screen.getByRole('button',{name:'关闭音频来源'}));
 expect((screen.getByLabelText('英文检索词') as HTMLInputElement).value).toBe('piano');
 expect(command).not.toHaveBeenCalled();
 vi.unstubAllGlobals();sessionStorage.clear();
});

it('presents completed-project mixing as saved facts without write controls',()=>{
 const command=vi.fn();const saved={...workspace,audio:{...workspace.audio!,mix:{voices:[{...workspace.audio!.mix.voices[0],mode:'source' as const,gainDb:-3,ambienceGainDb:-24,coverage:'partial' as const,sourceLabel:'原片音轨',startSeconds:0,durationSeconds:2}],sounds:[{itemId:'sound',kind:'sfx' as const,gainDb:-12,duckDepthDb:4,startSeconds:1,durationSeconds:2}]}}};
 render(<WorkspaceAudioPanel workspace={saved} command={command} onChange={()=>{}} readOnly/>);
 expect(screen.getByRole('table',{name:'已保存主声混音'}).textContent).toContain('-3 dB');expect(screen.getByText('原声仅覆盖部分镜头')).toBeTruthy();expect(screen.getByText('环境声 -24 dB')).toBeTruthy();expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByRole('button',{name:'应用'})).toBeNull();expect(screen.getByRole('table',{name:'已保存配乐与音效'}).textContent).toContain('-12 dB / 4 dB');expect(command).not.toHaveBeenCalled();
});

it('retires sound-effect creation and default entry even when an old effect draft is stored',async()=>{
 sessionStorage.setItem('loop-audio-draft:w:S1',JSON.stringify({kind:'sfx',description:'旧音效草稿',query:'door bell',anchor:'shot'}));
 const command=vi.fn();render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" materials={[{id:'m',material_type:'audio',source_path:'music.mp3',material_purpose:'background_music'}]}/>);
 expect(screen.queryByRole('button',{name:'添加音效'})).toBeNull();expect(screen.queryByRole('option',{name:'音效'})).toBeNull();expect(screen.getByRole('button',{name:'整期配乐'}).getAttribute('aria-pressed')).toBe('true');expect((screen.getByLabelText('英文检索词') as HTMLInputElement).value).toBe('');
 selectAudio('m');
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'bgm',materialRevisionId:'m',anchor:'absolute'})));
});

it('keeps a historical failed audio preparation recoverable with frozen inputs and protects unknown results',async()=>{
 const failed={...effect('failed'),taskId:'original-task',status:'failed',generationTask:{id:'failed',taskId:'original-task',status:'failed',error:'检索中断',provider:'freesound',model:'freesound-preview-v1'}};
 const command=vi.fn(async()=>workspace),view=render(<WorkspaceAudioPreparation workspace={{...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[failed]}} as ProductionWorkspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 fireEvent.click(screen.getByRole('button',{name:'音效'}));fireEvent.click(screen.getByRole('button',{name:'重试原音频准备'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',preparationId:'failed',retry:true})));
 view.rerender(<WorkspaceAudioPreparation workspace={{...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[{...failed,generationTask:{...failed.generationTask,submissionUnknown:true,submissionOutcome:'started'}}]}} as ProductionWorkspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 expect(screen.queryByRole('button',{name:'重试原音频准备'})).toBeNull();expect(screen.getByRole('button',{name:'刷新核对结果'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'查看音频任务详情'}));expect(screen.getByText(/当前结果未知，不能再次提交生成/)).toBeTruthy();expect(command).toHaveBeenCalledTimes(1);
});

it('does not expose duplicate source extraction and preserves legacy source records',()=>{
 const project={activeTimelineId:'t',timelines:[{id:'t',fps:30,items:[{id:'visual',kind:'video',durationInFrames:90,startFrame:0}]}]} as unknown as import('../worker/openchatcutProject').OpenChatCutProject;
 sessionStorage.setItem('loop-audio-draft-v2:w:S1',JSON.stringify({kind:'source',description:'旧原声',sourceItem:'visual'}));
 const command=vi.fn();render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" project={project}/>);
 expect(screen.queryByRole('button',{name:'原片声音'})).toBeNull();expect(screen.queryByRole('button',{name:'提取原片声音'})).toBeNull();expect(screen.getByRole('button',{name:'整期配乐'}).getAttribute('aria-pressed')).toBe('true');expect(command).not.toHaveBeenCalled();
});

it('keeps local sound-effect import and explicit preparation without search, connection or default controls',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 sessionStorage.setItem('loop-audio-draft-v2:w:S1',JSON.stringify({
  kind:'sfx',description:'导入音效',anchor:'shot',shot:'旧目标镜头',offset:.4,duration:1,
 }));
 const command=vi.fn(async(_name:string,_data:unknown)=>workspace);render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1" materials={[{id:'own-effect',material_type:'audio',source_path:'own-bell.mp3',material_purpose:'sound_effect'},{id:'music',material_type:'audio',source_path:'music.mp3',material_purpose:'background_music'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'音效'}));
 expect(screen.getByRole('button',{name:'音效'})).toBeTruthy();expect(screen.queryByRole('option',{name:'music.mp3'})).toBeNull();expect(screen.queryByLabelText('检索服务')).toBeNull();expect(screen.queryByLabelText('英文检索词')).toBeNull();expect(screen.queryByRole('button',{name:'音频检索设置'})).toBeNull();expect(screen.queryByLabelText('镜头',{exact:true})).toBeNull();
 expect(screen.queryByRole('button',{name:'音效位置'})).toBeNull();expect(command).not.toHaveBeenCalled();selectAudio('own-effect');
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',materialRevisionId:'own-effect',anchor:'shot',shotId:'S1',offsetSeconds:.4})));
 expect(command.mock.calls[0][1]).not.toHaveProperty('selection');
});

it('reads existing episode music defaults without offering refresh or default-saving controls',async()=>{
 const service={id:'sound-a',provider:'freesound',adapter:'freesound_audio',connectionVersionId:'sound-v1',connectionName:'Sound A',executable:true};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[service]}]}})));
 sessionStorage.setItem('loop-audio-music-default:w',JSON.stringify({selection:{capability:'music_sound',provider:'wrong',adapter:'wrong',connectionVersionId:'old'}}));
 const selection={capability:'music_sound' as const,provider:'freesound',adapter:'freesound_audio',connectionVersionId:'sound-v1'},saved={...workspace,audio:{...workspace.audio!,defaults:{selection}}};
 const command=vi.fn(async()=>saved),view=render(<WorkspaceAudioPreparation workspace={saved} command={command} onChange={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'音频来源'}));await screen.findByRole('menuitemradio',{name:/Freesound/});
 expect(screen.getByRole('menuitemradio',{name:/Freesound/}).getAttribute('aria-checked')).toBe('true');
 expect(screen.queryByRole('button',{name:'刷新服务'})).toBeNull();expect(screen.queryByRole('button',{name:'设为本期默认'})).toBeNull();expect(command).not.toHaveBeenCalled();
 view.unmount();sessionStorage.clear();render(<WorkspaceAudioPreparation workspace={saved} command={command} onChange={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'音频来源'}));await screen.findByRole('menuitemradio',{name:/Freesound/});expect(screen.getByRole('menuitemradio',{name:/Freesound/}).getAttribute('aria-checked')).toBe('true');
});

it('derives editable sound candidates from intent without adopting or changing music',async()=>{
 const selection={capability:'music_sound' as const,provider:'freesound',adapter:'freesound_preview',connectionVersionId:'sound-v1'};
 const service={id:'sound-a',...selection,connectionName:'Sound A',executable:true};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[service]}]}})));
 const w={...workspace,clips:[{...workspace.clips[0],soundIntent:'开门时一声轻响'}],audio:{...workspace.audio!,defaults:{selection}}},command=vi.fn(async(_name:string,_data:unknown)=>w);
 render(<WorkspaceAudioPreparation workspace={w} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 expect(screen.queryByRole('textbox',{name:'音效意图'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'音效'}));expect(screen.getByLabelText('音效意图或检索词')).toHaveProperty('value','开门时一声轻响');
 await waitFor(()=>expect(screen.getByRole('button',{name:'根据意图找音效'})).toHaveProperty('disabled',false));
 fireEvent.change(screen.getByLabelText('音效意图或检索词'),{target:{value:'door creak'}});fireEvent.click(screen.getByRole('button',{name:'根据意图找音效'}));
 await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',intent:'door creak',query:'door creak',candidateCount:3,selection,shotId:'S1',anchor:'shot'})));
 expect(command.mock.calls.some(([name])=>name.includes('adopt'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'整期配乐'}));expect(screen.queryByRole('textbox',{name:'音效意图'})).toBeNull();
});

it('saves a changed music query across shots while preserving historical description and server reload',async()=>{
 const saved={...workspace,audio:{...workspace.audio!,defaults:{settings:{description:'全片氛围',query:'calm ambient',materialRevisionId:''}}}},command=vi.fn(async()=>saved),props={workspace:saved,command,onChange:vi.fn()},view=render(<WorkspaceAudioPreparation {...props} selectedShotId="S1"/>);
 expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','calm ambient');fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'soft piano'}});view.rerender(<WorkspaceAudioPreparation {...props} selectedShotId="S2"/>);expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','soft piano');fireEvent.click(screen.getByRole('button',{name:'保存本期配乐配置'}));await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('saveWorkspaceMusicSettings',{episodeId:'e',workspaceId:'w',expectedRevision:2,settings:{description:'全片氛围',query:'soft piano',materialRevisionId:''}}));view.unmount();sessionStorage.clear();render(<WorkspaceAudioPreparation {...props} selectedShotId="S2"/>);expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','calm ambient');
});

it('blocks a new sound search while its intent is being saved',async()=>{
 const selection={capability:'music_sound' as const,provider:'freesound',adapter:'freesound_preview',connectionVersionId:'v'};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[{id:'s',...selection,executable:true}]}]}})));
 let finish!:(w:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));
 const w={...workspace,clips:[{...workspace.clips[0],soundIntent:'门铃声'}],audio:{...workspace.audio!,defaults:{selection}}};
 render(<WorkspaceAudioPreparation workspace={w} command={command} onChange={()=>{}} selectedShotId="S1"/>);fireEvent.click(screen.getByRole('button',{name:'音效'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'根据意图找音效'})).toHaveProperty('disabled',false));
 fireEvent.change(screen.getByLabelText('音效意图或检索词'),{target:{value:'开门声'}});fireEvent.click(screen.getByRole('button',{name:'保存音效意图'}));
 expect(screen.getByRole('button',{name:'根据意图找音效'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'根据意图找音效'}));await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));
 finish(w);await waitFor(()=>expect(screen.getByRole('button',{name:'根据意图找音效'})).toHaveProperty('disabled',false));
});

it('keeps compact sound candidates directly playable with attribution and licence available',()=>{
 const p={...effect('licensed','S1','门铃'),source:{provider:'freesound',title:'Door bell',creator:'声音作者',sourceUrl:'https://freesound.org/people/creator/sounds/1/',license:'https://creativecommons.org/licenses/by/4.0/'},connection:{name:'音效连接',version:2},selection:{provider:'freesound'},query:'door bell'};
 const command=vi.fn(),view=render(<WorkspaceAudioPreparation workspace={{...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[p]}} as unknown as ProductionWorkspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);
 fireEvent.click(screen.getByRole('button',{name:'音效'}));
 const candidate=view.container.querySelector('.workspace-audio-candidate')!;
 expect(candidate.querySelector('details')).toBeNull();expect(within(candidate as HTMLElement).getByRole('button',{name:'试听 Door bell'})).toBeTruthy();
 expect(within(candidate as HTMLElement).getByRole('link',{name:'声音作者'}).getAttribute('href')).toBe(p.source.sourceUrl);expect(within(candidate as HTMLElement).getByRole('link',{name:'许可'}).getAttribute('href')).toBe(p.source.license);
 expect(within(candidate as HTMLElement).getByRole('button',{name:'加入镜头'})).toBeTruthy();expect(within(candidate as HTMLElement).getByText('Door bell').getAttribute('title')).toContain('检索：door bell');expect(command).not.toHaveBeenCalled();
});

it('keeps placement and duration out of the composer before a candidate is adopted',()=>{
 const command=vi.fn();render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} selectedShotId="S1"/>);fireEvent.click(screen.getByRole('button',{name:'音效'}));
 expect(screen.queryByLabelText('定位方式')).toBeNull();expect(screen.queryByLabelText('使用时长（秒）')).toBeNull();expect(screen.queryByRole('button',{name:'音效时长'})).toBeNull();expect(screen.queryByRole('button',{name:'音效位置'})).toBeNull();expect(command).not.toHaveBeenCalled();
});

it('toggles episode music and all effects independently while retaining input drafts',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const command=vi.fn(async(_name:string,input:unknown)=>{const data=input as {kind:'bgm'|'sfx';enabled:boolean};return {...workspace,audio:{...workspace.audio!,enabled:{bgm:true,sfx:true,[data.kind]:data.enabled}}};});
 function Harness(){const[w,setW]=useState(workspace);return <WorkspaceAudioPreparation workspace={w} command={command} onChange={setW} selectedShotId="S1"/>;}
 render(<Harness/>);fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'保留配乐草稿'}});fireEvent.click(screen.getByRole('switch',{name:'启用整期配乐'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'音频来源'})).toBeNull());expect(command).toHaveBeenCalledWith('setWorkspaceAudioEnabled',expect.objectContaining({kind:'bgm',enabled:false}));
 fireEvent.click(screen.getByRole('button',{name:'音效'}));expect(screen.getByRole('combobox',{name:'音效来源方式'})).toHaveProperty('value','search');
 fireEvent.click(screen.getByRole('button',{name:'整期配乐'}));fireEvent.click(screen.getByRole('switch',{name:'启用整期配乐'}));await waitFor(()=>expect(screen.getByRole('button',{name:'音频来源'})).toBeTruthy());expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','保留配乐草稿');
});

it('keeps the provider picker focused on services and preserves provider and query after local upload',async()=>{
 const selection={capability:'music_sound' as const,provider:'freesound',adapter:'freesound_preview',connectionVersionId:'v'};vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[{id:'sound',...selection,connectionName:'Freesound',executable:true}]}]}})));
 const command=vi.fn(async(name:string)=>name==='importMaterial'?{id:'local'}:workspace);render(<WorkspaceAudioPreparation workspace={{...workspace,audio:{...workspace.audio!,defaults:{selection}}}} command={command} onChange={()=>{}} materials={[]}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'音频来源'}).textContent).toContain('Freesound'));fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'calm piano'}});fireEvent.change(screen.getByLabelText('上传配乐'),{target:{files:[new File(['mp3'],'local.mp3',{type:'audio/mpeg'})]}});await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({materialRevisionId:'local'})));expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','calm piano');expect(screen.getByRole('button',{name:'音频来源'}).textContent).toContain('Freesound');fireEvent.click(screen.getByRole('button',{name:'音频来源'}));expect(screen.queryByRole('menuitemradio',{name:'上传音频'})).toBeNull();expect(screen.queryByRole('combobox',{name:'本地音频'})).toBeNull();expect(screen.queryByLabelText('用途')).toBeNull();expect(screen.getByRole('menuitemradio',{name:/Freesound/}).getAttribute('aria-checked')).toBe('true');expect(command.mock.calls.some(([name])=>name==='adoptWorkspaceAudio')).toBe(false);
});

it('waits for the user audio write before scheduling a background refresh',async()=>{
 vi.useFakeTimers();let finish!:(value:ProductionWorkspace)=>void;
 const w={...workspace,audio:{...workspace.audio!,preparations:[{...effect('pending'),kind:'bgm',status:'running',taskId:'task',relativePath:null}]}} as unknown as ProductionWorkspace;
 const command=vi.fn((name:string,_data:unknown)=>name==='saveWorkspaceMusicSettings'?new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}):Promise.resolve(w));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w,serviceCatalog:{version:1,groups:[]}})));
 render(<WorkspaceAudioPreparation workspace={w} command={command} onChange={()=>{}}/>);await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'保存本期配乐配置'}));await act(async()=>{});
 await act(async()=>vi.advanceTimersByTimeAsync(3000));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['saveWorkspaceMusicSettings']);
 await act(async()=>finish(w));
});
it('waits for a running audio refresh and writes against its returned revision',async()=>{
 vi.useFakeTimers();let finish!:(value:ProductionWorkspace)=>void;
 let latest={...workspace,audio:{...workspace.audio!,preparations:[{...effect('waiting'),kind:'bgm',status:'running',taskId:'task',relativePath:null}]}} as unknown as ProductionWorkspace;
 const command=vi.fn((name:string,_data:unknown)=>name==='refreshWorkspaceAudio'?new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}):Promise.resolve(latest));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:latest,serviceCatalog:{version:1,groups:[]}})));
 function View(){const [current,setCurrent]=useState(latest);return <WorkspaceAudioPreparation workspace={current} command={command} onChange={setCurrent}/>;}
 render(<View/>);await act(async()=>{});await act(async()=>vi.advanceTimersByTimeAsync(3000));
 fireEvent.click(screen.getByRole('button',{name:'保存本期配乐配置'}));await act(async()=>{});
 expect(command.mock.calls.map(([name])=>name)).toEqual(['refreshWorkspaceAudio']);
 latest={...latest,revision:3};await act(async()=>finish(latest));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['refreshWorkspaceAudio','saveWorkspaceMusicSettings']);
 expect(command.mock.calls[1][1]).toEqual(expect.objectContaining({expectedRevision:3}));
});
it('selects a current audio connection without refresh or default-saving controls',async()=>{
 const service={id:'sound-current',provider:'freesound',adapter:'freesound_preview',connectionVersionId:'version-1',connectionVersion:1,connectionName:'当前声音',executable:true};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'music_sound',services:[service]}]}})));
 const command=vi.fn(async()=>workspace);
 render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
 await screen.findByRole('menuitemradio',{name:/^Freesound/});
 expect(screen.queryByRole('button',{name:'刷新服务'})).toBeNull();
 expect(screen.queryByRole('button',{name:'设为本期默认'})).toBeNull();
 fireEvent.click(screen.getByRole('menuitemradio',{name:/^Freesound/}));
 fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'calm piano'}});
 fireEvent.click(screen.getByRole('button',{name:'检索并获取'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({selection:{capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:'version-1'},query:'calm piano'})));
});

it('preselects named template music and effects without preparing until the user asks',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace,serviceCatalog:{groups:[]}})));
 const sound={id:'effect',name:'轻响.mp3',type:'audio',purpose:'sound_effect',sha256:'effect',relativePath:'effect.mp3',fileSize:100},music={...sound,id:'music',name:'背景.mp3',purpose:'background_music'};
 const current={...workspace,templateInputs:{version:'workspace-template-inputs/v1' as const,narration:{},bgm:{reference:'背景',status:'bound' as const,material:music,candidates:[music]},shots:[{shotId:'S1',imagePrompt:'',videoPrompt:'',narration:{},sfx:{reference:'轻响',status:'bound' as const,material:sound,candidates:[sound]}}]}};
 const prepared={...current,audio:{mix:{voices:[],sounds:[]},preparations:[{...effect('prepared','S1','轻响'),source:{...effect('prepared','S1','轻响').source,materialRevisionId:'effect'}}]}};
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceAudio'?prepared:current),materials=[sound,music].map(m=>({id:m.id,material_type:m.type,source_path:m.name,material_purpose:m.purpose}));
 render(<WorkspaceAudioPreparation workspace={current} command={command} onChange={()=>{}} selectedShotId="S1" materials={materials}/>);
 expect(screen.getByRole('button',{name:'准备配乐：背景.mp3'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'音效'}));fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'upload'}});fireEvent.click(screen.getByRole('button',{name:'加入镜头'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',materialRevisionId:'effect',shotId:'S1',anchor:'shot'})));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceAudio',expect.objectContaining({preparationId:'prepared'})));
});

it('limits storyboard sound preparation to effects even with an older episode music draft',async()=>{
 sessionStorage.setItem('loop-audio-draft-v2:w:S1',JSON.stringify({kind:'bgm',description:'旧配乐',query:'piano'}));
 const value={...workspace,audio:{mix:{voices:[],sounds:[]},preparations:[{...effect('music','S1','旧整期配乐'),kind:'bgm'},effect('effect','S1','脚步声')]}} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>value);
 render(<WorkspaceAudioPreparation workspace={value} command={command} onChange={()=>{}} selectedShotId="S1" effectsOnly materials={[{id:'m',material_type:'audio',source_path:'step.mp3',material_purpose:'sound_effect'}]}/>);
 expect(screen.queryByRole('button',{name:'整期配乐'})).toBeNull();expect(screen.queryByText('旧整期配乐')).toBeNull();expect(screen.getByLabelText('音效意图或检索词')).toBeTruthy();fireEvent.change(screen.getByLabelText('音效意图或检索词'),{target:{value:'脚步声'}});expect(screen.getByLabelText('音效意图或检索词')).toHaveProperty('value','脚步声');selectAudio('m');
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'sfx',shotId:'S1'})));
});

it('disables and re-enables effects from the source menu while preserving draft and candidate state',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[]}})));
 const initial={...workspace,audio:{...workspace.audio!,preparations:[effect('kept')]}} as ProductionWorkspace;
 const command=vi.fn(async(_name:string,data:unknown)=>({...initial,revision:3,audio:{...initial.audio!,enabled:{bgm:true,sfx:(data as {enabled:boolean}).enabled}}}));
 function View(){const [value,setValue]=useState(initial);return <WorkspaceAudioPreparation effectsOnly selectedShotId="S1" workspace={value} command={command} onChange={setValue}/>;}
 render(<View/>);
 fireEvent.change(screen.getByLabelText('音效意图或检索词'),{target:{value:'door creak'}});
 expect(screen.queryByRole('switch',{name:'启用音效'})).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'none'}});
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'音效来源方式'})).toHaveProperty('value','none'));
 expect(screen.queryByRole('textbox',{name:'音效意图或检索词'})).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'upload'}});
 await screen.findByRole('button',{name:'拖入音效文件'});
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'search'}});
 expect(screen.getByLabelText('音效意图或检索词')).toHaveProperty('value','door creak');
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
 expect(screen.queryByRole('button',{name:'清除来源选择'})).toBeNull();
 expect(command.mock.calls.map(([name])=>name)).toEqual(['setWorkspaceAudioEnabled','setWorkspaceAudioEnabled']);
 expect(command.mock.calls.map(([,data])=>data)).toEqual([expect.objectContaining({kind:'sfx',enabled:false}),expect.objectContaining({kind:'sfx',enabled:true})]);
});
it('retains a disabled effect and its source draft when enabling fails',async()=>{
 const disabled={...workspace,audio:{...workspace.audio!,enabled:{sfx:false,bgm:true}}};
 const command=vi.fn(async()=>{throw Error('保存失败');});
 render(<WorkspaceAudioPreparation effectsOnly selectedShotId="S1" workspace={disabled} command={command} onChange={()=>{}}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'音效来源方式'}),{target:{value:'upload'}});
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','保存失败');
 expect(screen.getByRole('combobox',{name:'音效来源方式'})).toHaveProperty('value','none');
 expect(screen.queryByRole('button',{name:'拖入音效文件'})).toBeNull();
});

it('explains disabled effects without claiming a retained association is empty',()=>{
 const effectRow={...effect('one','S1','门铃声'),adoptedItemId:'workspace-sfx-one'};
 const w={...workspace,audio:{enabled:{sfx:false},mix:{voices:[],sounds:[sound('one')]},preparations:[effectRow]}} as unknown as ProductionWorkspace;
 const view=render(<WorkspaceAudioPreparation workspace={w} effectsOnly selectedShotId="S1" command={vi.fn()} onChange={vi.fn()}/>);
 expect(screen.getByRole('status').textContent).toContain('关联音效已保留');
 view.rerender(<WorkspaceAudioPreparation workspace={{...w,audio:{...w.audio!,mix:{voices:[],sounds:[]}}}} effectsOnly selectedShotId="S1" command={vi.fn()} onChange={vi.fn()}/>);
 expect(screen.getByRole('status').textContent).toContain('本镜头没有关联音效');
});
it('opens adopted effect settings on demand and leaves the project untouched until apply',async()=>{
 const row={...effect('one','S1','门铃声'),adoptedItemId:'workspace-sfx-one'};
 const w={...workspace,audio:{mix:{voices:[],sounds:[sound('one')]},preparations:[row]}} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>w);render(<WorkspaceAudioPreparation workspace={w} effectsOnly selectedShotId="S1" command={command} onChange={vi.fn()}/>);
 expect(screen.getByText(/跟随镜头/)).toBeTruthy();expect(screen.queryByRole('spinbutton',{name:'音量 dB'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'设置 门铃声'}));const dialog=await screen.findByRole('dialog',{name:'门铃声设置'});
 fireEvent.change(within(dialog).getByRole('spinbutton',{name:'音量 dB'}),{target:{value:'-10'}});expect(command).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'应用设置'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('mixWorkspaceAudio',expect.objectContaining({edit:expect.objectContaining({itemId:'workspace-sfx-one',gainDb:-10})})));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'门铃声设置'})).toBeNull());
});
