import {useState} from 'react';
import userEvent from '@testing-library/user-event';
import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {workspaceSettingsFingerprint} from './workspaceSettingsDraft';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import {WorkspaceMaterialSelectionProvider,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
import {registeredAdapters} from '../worker/registeredAdapters';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
const plan={adoptionId:'adoption',candidateId:'candidate',projectSha256:'saved-sha',edit:{source:{kind:'audio'}},impact:{currentSeconds:2.4,sourceSeconds:4,appliedSeconds:4,deltaSeconds:1.6,affectedFragments:[{itemId:'later',label:'下一镜头',kind:'video',startSeconds:2.4,endSeconds:6,changedStartSeconds:2.4,changedEndSeconds:4}]}};
const selection={capability:'speech' as const,provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:'a'};
function setup(candidates:unknown[]=[]){const choice=registeredAdapters.productionChoices().find(c=>c.capability==='speech')!;const services=['a','b'].map(id=>({...choice,id,connectionVersionId:id,connectionName:id.toUpperCase(),connectionVersion:1,executable:true}));vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,json:async()=>path.endsWith('/workspace')?{workspace}:{serviceCatalog:{groups:[{capability:'speech',services}]}}})));
 const workspace={id:'w',episodeId:'e',revision:1,stale:false,project:{sha256:'saved-sha'},candidates,narration:[{clipId:'c',shotId:'S01',mode:'tts',text:'完整口播',voice:'zh_female_vv_uranus_bigtts',speakingRate:1,languageCode:'zh-CN',selection,inputFingerprint:'f',status:'pending',defaults:{selection,voice:'zh_female_vv_uranus_bigtts',speakingRate:1,languageCode:'zh-CN'}}]} as unknown as ProductionWorkspace;const command=vi.fn(async(_name:string,_data?:unknown)=>workspace);render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);return{workspace,command};}
async function sourceReady(){await waitFor(()=>expect(screen.getByRole('button',{name:'口播来源'}).textContent).toContain('seed-tts-2.0'));}
it('uses the saved episode voice even when the shot has an older voice and rate',async()=>{
 const {workspace,command}=setup();cleanup();
 const shot=workspace.narration![0],defaults={...shot.defaults!,speakingRate:.85};
 render(<WorkspaceNarrationPanel episodeId="e" workspace={{...workspace,narration:[{...shot,voice:'旧音色',speakingRate:1.5,defaults}]}} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);
 const generate=screen.getByRole<HTMLButtonElement>('button',{name:'生成口播'});
 await waitFor(()=>expect(generate.disabled).toBe(false));
 expect(screen.queryByLabelText('镜头声音')).toBeNull();
 fireEvent.click(generate);
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({text:'完整口播',mode:'tts',...defaults})));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('generateWorkspaceNarration',expect.objectContaining({clipId:'c'})));
});
it('refreshes the connection choices on window focus and offers a retry only after an error',async()=>{
 const {command}=setup();
 const fetchMock=vi.mocked(fetch);
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'生成口播'}).disabled).toBe(false));
 fetchMock.mockRejectedValueOnce(new Error('offline'));
 fireEvent.focus(window);
 await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'重试'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect(fetchMock).toHaveBeenCalledTimes(3);
 expect(command).not.toHaveBeenCalled();
});
it('persists only an explicit default choice without generating or adopting',async()=>{const{command}=setup();await sourceReady();fireEvent.click(screen.getByRole('button',{name:'口播来源'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'seed-tts-2.0 B · v1'}));fireEvent.click(screen.getByRole('button',{name:'保存口播设置'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarrationDefaults',{episodeId:'e',workspaceId:'w',expectedRevision:1,selection:{...selection,connectionVersionId:'b'},voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}));expect(command).toHaveBeenCalledTimes(1);});
it('retains an incompatible saved voice and explains the conflict instead of replacing it',async()=>{const{command,workspace}=setup();cleanup();const saved={...workspace,narration:[{...workspace.narration![0],defaults:{...workspace.narration![0].defaults!,voice:'foreign_voice_mars_bigtts'}}]};render(<WorkspaceNarrationPanel episodeId="e" workspace={saved} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);await sourceReady();expect(screen.getByRole('alert').textContent).toContain('不兼容');expect(screen.getByRole('combobox',{name:'声音'})).toHaveProperty('value','foreign_voice_mars_bigtts');expect(command).not.toHaveBeenCalled();});

it('adopts a completed candidate through the public candidate command fields without submitting speech',async()=>{const{command,workspace}=setup([{id:'candidate',kind:'audio',shotId:'S01',text:'完整口播',relativePath:'voice.mp3',durationSeconds:2.4,targetDurationSeconds:2.4,status:'available'}]);command.mockImplementation(async(name:string)=>name==='prepareWorkspaceCandidate'?plan as unknown as ProductionWorkspace:workspace);fireEvent.click(screen.getByRole('button',{name:'采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceCandidate',{episodeId:'e',workspaceId:'w',expectedRevision:1,candidateId:'candidate',durationPolicy:'use-candidate'}));expect(command.mock.calls.some(call=>call[0]==='adoptWorkspaceCandidate')).toBe(false);expect(screen.getByRole('dialog',{name:'采用前核对'}).textContent).toContain('下一镜头');fireEvent.click(screen.getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceCandidate',{episodeId:'e',workspaceId:'w',expectedRevision:1,candidateId:'candidate',adoptionId:'adoption'}));});

it('confirms an unchanged duration in its own candidate card and cancels with Escape',async()=>{
 const candidate={id:'candidate',kind:'audio',shotId:'S01',text:'完整口播',relativePath:'voice.mp3',durationSeconds:2.4,status:'available'};
 const {command,workspace}=setup([candidate,{...candidate,id:'other',text:'另一段口播'}]);
 command.mockImplementation(async(name:string)=>name==='prepareWorkspaceCandidate'
  ?{...plan,impact:{...plan.impact,appliedSeconds:2.4,deltaSeconds:0,affectedFragments:[]}} as unknown as ProductionWorkspace
  :workspace);
 fireEvent.click(screen.getAllByRole('button',{name:'采用'})[0]);
 const controls=await screen.findByRole('group',{name:'采用前核对'});
 expect(controls.closest('article')?.textContent).toContain('完整口播');
 expect(screen.getAllByRole('button',{name:'采用'})).toHaveLength(1);
 expect(screen.queryByRole('dialog',{name:'采用前核对'})).toBeNull();
 fireEvent.keyDown(controls,{key:'Escape'});
 expect(screen.queryByRole('group',{name:'采用前核对'})).toBeNull();
 expect(command).toHaveBeenCalledTimes(1);
});

it('hides narration completely when switched off and restores the draft when reenabled',async()=>{
 const {workspace}=setup();cleanup();
 const command=vi.fn(async(_name:string,data:any)=>({...workspace,narration:[{...workspace.narration![0],enabled:data.enabled}]}));
 function Harness(){const [w,setW]=useState(workspace);return <WorkspaceNarrationPanel episodeId="e" workspace={w} selectedShotId="S01" pending={false} command={command} onChanged={setW}/>;}
 render(<Harness/>);fireEvent.change(screen.getByRole('textbox',{name:'口播文案'}),{target:{value:'关闭后保留的文案'}});fireEvent.click(screen.getByRole('switch',{name:'启用口播'}));
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'口播文案'})).toBeNull());expect(screen.queryByRole('button',{name:'口播来源'})).toBeNull();expect(screen.getByRole('switch',{name:'启用口播'})).toHaveProperty('checked',false);
 fireEvent.click(screen.getByRole('switch',{name:'启用口播'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'口播文案'})).toHaveProperty('value','关闭后保留的文案'));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['setWorkspaceNarrationEnabled','setWorkspaceNarrationEnabled']);
});

it('separates generated candidates and uploaded audio across modes, including a previously selected generated track',()=>{
 const {workspace,command}=setup();cleanup();
 sessionStorage.setItem('loop-speech-draft:w:S01:manual','generated');
 const upload={id:'upload',source_path:'人工录音.mp3',storage_path:'materials/voice.mp3',material_type:'audio',material_purpose:'narration'};
 const candidate={kind:'audio',shotId:'S01',durationSeconds:2,status:'available'};
 const withCandidates={...workspace,candidates:[
  {...candidate,id:'generated',audioTrackId:'generated',text:'生成的口播',relativePath:'generated/voice.mp3'},
  {...candidate,id:'uploaded',audioTrackId:'uploaded',text:'上传的口播',relativePath:upload.storage_path}
 ]} as ProductionWorkspace;
 render(<WorkspaceNarrationPanel episodeId="e" workspace={withCandidates} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}
  materials={[upload]} tracks={[{id:'generated',track_kind:'narration',cue_id:'S01',source_material_revision_id:null}]}/>);
 expect(screen.getByText('生成的口播',{selector:'.workspace-speech-result-heading p'})).toBeTruthy();
 expect(screen.queryByText('上传的口播')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'口播来源'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'人工口播'}));
 expect(screen.getByText('人工录音.mp3',{selector:'.workspace-speech-result-heading p'})).toBeTruthy();
 expect(screen.queryByText('生成的口播')).toBeNull();
 expect(screen.queryByRole('combobox',{name:'口播素材或上传音轨'})).toBeNull();
 expect(screen.queryByRole('button',{name:'加入候选'})).toBeNull();

});

it('drops uploaded narration material and explicitly adopts its registered candidate without generating speech',async()=>{
 const {workspace}=setup();cleanup();
 const ready={...workspace,narration:[{...workspace.narration![0],mode:'manual' as const,audioTrackId:'track',inputFingerprint:'manual-hash'}],candidates:[{id:'track',kind:'audio',shotId:'S01',status:'available',relativePath:'voice.mp3',audioTrackId:'track',text:'人工口播'}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceCandidate'?{...plan,candidateId:'track',adoptionId:'manual-adoption'}:ready);
 const materials=[{id:'material',source_path:'voice.mp3',storage_path:'voice.mp3',material_type:'audio',material_purpose:'narration'},{id:'music',source_path:'music.mp3',material_type:'audio',material_purpose:'background_music'}];
 function View({value}:{value:ProductionWorkspace}){return <WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceNarrationPanel episodeId="e" workspace={value} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()} materials={materials}/></WorkspaceMaterialSelectionProvider>;}
 const view=render(<View value={workspace}/>);
 fireEvent.click(screen.getByRole('button',{name:'口播来源'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'人工口播'}));
 const drop=(id:string)=>fireEvent.drop(screen.getByRole('button',{name:'拖入口播文件'}),{dataTransfer:{types:[workspaceMaterialDragType],getData:()=>id,files:[]}});
 drop('music');expect(command).not.toHaveBeenCalled();drop('material');
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({mode:'manual',materialRevisionId:'material'})));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmWorkspaceNarration',expect.anything()));expect(command.mock.calls.some(call=>call[0]==='prepareWorkspaceCandidate')).toBe(false);
 view.rerender(<View value={ready}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'采用'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'采用'}));
 await screen.findByRole('dialog',{name:'采用前核对'});expect(command.mock.calls.some(call=>call[0]==='adoptWorkspaceCandidate')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceCandidate',expect.objectContaining({candidateId:'track',adoptionId:'manual-adoption'})));
});

it('reopens from the latest persisted default without repeating frozen execution details',async()=>{
 const {workspace,command}=setup();await sourceReady();
 fireEvent.change(screen.getByRole('spinbutton',{name:'语速'}),{target:{value:'1.5'}});cleanup();
 const latest={...workspace,narration:[{...workspace.narration![0],speakingRate:1.25,defaults:{...workspace.narration![0].defaults!,speakingRate:.85},execution:{taskId:'original-task',selection,voice:'原任务声音',languageCode:'zh-CN',speakingRate:1,text:'冻结口播正文'}}]};
 render(<WorkspaceNarrationPanel episodeId="e" workspace={latest} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);await waitFor(()=>expect((screen.getByRole('spinbutton',{name:'语速'}) as HTMLInputElement).value).toBe('0.85'));
 expect(screen.queryByLabelText('镜头语速')).toBeNull();
 expect(screen.queryByText('上次生成参数')).toBeNull();
 expect(screen.queryByText('冻结口播正文')).toBeNull();
 expect(screen.getByRole('button',{name:'生成口播'})).toBeTruthy();
 expect(command).not.toHaveBeenCalled();
});

it('keeps an actively edited default when another window saves and offers an explicit reload',async()=>{
 const {workspace,command}=setup();cleanup();const props={episodeId:'e',pending:false,command,onChanged:vi.fn(),selectedShotId:'S01'},view=render(<WorkspaceNarrationPanel {...props} workspace={workspace}/>);
 await sourceReady();fireEvent.change(screen.getByRole('spinbutton',{name:'语速'}),{target:{value:'1.4'}});
 const updated={...workspace,narration:[{...workspace.narration![0],defaults:{...workspace.narration![0].defaults!,speakingRate:.85}}]};view.rerender(<WorkspaceNarrationPanel {...props} workspace={updated}/>);
 expect((screen.getByRole('spinbutton',{name:'语速'}) as HTMLInputElement).value).toBe('1.4');expect(screen.getByRole('status').textContent).toContain('其他窗口更新');fireEvent.click(screen.getByRole('button',{name:'载入已保存设置'}));expect((screen.getByRole('spinbutton',{name:'语速'}) as HTMLInputElement).value).toBe('0.85');expect(command).not.toHaveBeenCalled();
});

it.each([null,{}, {selection:42,voice:'v',languageCode:'zh-CN',speakingRate:1},{selection:null,voice:42,languageCode:'zh-CN',speakingRate:1}])('ignores malformed persisted speech settings and preserves the saved form (%j)',async(value)=>{
 const {workspace,command}=setup();cleanup();sessionStorage.clear();const initial=workspace.narration![0].defaults!;
 sessionStorage.setItem('loop-speech-default-draft:w',JSON.stringify({baseline:workspaceSettingsFingerprint(initial),value}));
 render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);

 await sourceReady();expect((screen.getByLabelText('声音') as HTMLInputElement).value).toContain('Vivi 2.0');expect(command).not.toHaveBeenCalled();
});

it('reviews historical text and restores the existing candidate without generating again',async()=>{
 const {command,workspace}=setup([{id:'candidate',kind:'audio',shotId:'S01',text:'旧口播',relativePath:'voice.mp3',durationSeconds:2.4,status:'stale',canRestoreNarration:true}]);
 const changed={...workspace,narration:[{...workspace.narration![0],text:'旧口播'}]};
 command.mockImplementation(async name=>name==='prepareWorkspaceCandidate'
  ?{...plan,restoration:{currentText:'完整口播',restoredText:'旧口播'}} as unknown as ProductionWorkspace:changed);
 fireEvent.click(screen.getByRole('button',{name:'采用'}));
 const dialog=await screen.findByRole('dialog',{name:'恢复口播前核对'});
 expect(dialog.textContent).toContain('当前正文完整口播');
 expect(dialog.textContent).toContain('恢复为旧口播');
 fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'口播文案'}).value).toBe('旧口播'));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['prepareWorkspaceCandidate','adoptWorkspaceCandidate']);
 expect(command).toHaveBeenLastCalledWith('adoptWorkspaceCandidate',expect.objectContaining({restoreNarration:true,adoptionId:'adoption'}));
});

it('keeps independent captions separate from the single narration input and records text on generation',async()=>{
 const {workspace,command}=setup();cleanup();
 const captions=[{clipId:'c',shotId:'S01',contract:{enabled:true,contentMode:'independent',text:'已有独立字幕'}}] as ProductionWorkspace['captions'];
 render(<WorkspaceNarrationPanel episodeId="e" workspace={{...workspace,captions}} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);
 expect(screen.getByRole('textbox',{name:'口播文案'})).toHaveProperty('value','完整口播');
 expect(screen.queryByRole('combobox',{name:'字幕模式'})).toBeNull();expect(screen.queryByRole('button',{name:'保存镜头字幕'})).toBeNull();
 expect(screen.getByRole('tab',{name:'字幕'})).toBeTruthy();
 fireEvent.change(screen.getByRole('textbox',{name:'口播文案'}),{target:{value:'新的生成文案'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成口播'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'生成口播'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('generateWorkspaceNarration',expect.anything()));
 expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({text:'新的生成文案'}));
 expect(command.mock.calls.some(([name])=>name==='saveWorkspaceNarrationCaptions')).toBe(false);expect(captions![0].contract.text).toBe('已有独立字幕');
});

it('edits subtitles separately and can explicitly return to the adopted narration text',async()=>{
 const {workspace,command}=setup();cleanup();
 render(<WorkspaceNarrationPanel episodeId="e" workspace={{...workspace,captions:[{clipId:'c',shotId:'S01',contract:{enabled:true,contentMode:'independent',text:'原字幕'}}] as ProductionWorkspace['captions']}} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'口播文案'}),{target:{value:'尚未生成的文案'}});fireEvent.click(screen.getByRole('tab',{name:'字幕'}));
 expect(screen.getByRole('textbox',{name:'字幕内容'})).toHaveProperty('value','原字幕');fireEvent.change(screen.getByRole('textbox',{name:'字幕内容'}),{target:{value:'独立修改的字幕'}});fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarrationCaptions',expect.objectContaining({contentMode:'independent',text:'独立修改的字幕'})));
 await waitFor(()=>expect(screen.getByRole('button',{name:'跟随口播'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'跟随口播'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarrationCaptions',expect.objectContaining({contentMode:'follow_tts'})));
 fireEvent.click(screen.getByRole('tab',{name:'口播'}));expect(screen.getByRole('textbox',{name:'口播文案'})).toHaveProperty('value','尚未生成的文案');expect(command.mock.calls.some(([name])=>name==='generateWorkspaceNarration')).toBe(false);
});

it('uses saved episode settings across shots while leaving frozen executions unchanged',async()=>{
 const {workspace,command}=setup();cleanup();
 const frozen={taskId:'old-task',selection,voice:'旧音色',speakingRate:1.5,languageCode:'zh-CN',text:'原任务文案'};
 const props={episodeId:'e',pending:false,command,onChanged:vi.fn()};
 const two={...workspace,narration:[{...workspace.narration![0],execution:frozen},{...workspace.narration![0],clipId:'c2',shotId:'S02'}]};
 const view=render(<WorkspaceNarrationPanel {...props} workspace={two} selectedShotId="S01"/>);
 await sourceReady();
 fireEvent.change(screen.getByRole('spinbutton',{name:'语速'}),{target:{value:'.85'}});fireEvent.click(screen.getByRole('button',{name:'保存口播设置'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarrationDefaults',expect.objectContaining({speakingRate:.85})));
 const saved={...two,narration:two.narration.map(n=>({...n,defaults:{...n.defaults!,speakingRate:.85}}))};
 view.rerender(<WorkspaceNarrationPanel {...props} workspace={saved} selectedShotId="S01"/>);fireEvent.click(screen.getByRole('button',{name:'生成口播'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({clipId:'c',speakingRate:.85})));
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成口播'})).toHaveProperty('disabled',false));
 view.rerender(<WorkspaceNarrationPanel {...props} workspace={saved} selectedShotId="S02"/>);fireEvent.click(screen.getByRole('button',{name:'生成口播'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({clipId:'c2',speakingRate:.85})));
 expect(two.narration[0].execution).toEqual(frozen);
});

it('saves the searched Chinese voice as an episode setting without generating',async()=>{
 const user=userEvent.setup(),{command}=setup();await waitFor(()=>expect(screen.getByRole('combobox',{name:'声音'})).toHaveProperty('disabled',false));
 const input=screen.getByRole('combobox',{name:'声音'});await user.clear(input);await user.type(input,'小何');await user.click(await screen.findByRole('option',{name:/^小何 2.0/}));expect(input).toHaveProperty('value','小何 2.0');expect(command).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'试听音色'})).toHaveProperty('disabled',false);fireEvent.click(screen.getByRole('button',{name:'保存口播设置'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarrationDefaults',expect.objectContaining({voice:'zh_female_xiaohe_uranus_bigtts',languageCode:'zh-CN'})));expect(command).toHaveBeenCalledTimes(1);
});

it('ignores old shot settings for new requests without removing the stored snapshot',async()=>{
 const {workspace,command}=setup();cleanup();const key='loop-speech-draft:w:S01:settings';
 const old=JSON.stringify({...workspace.narration![0].defaults,speakingRate:1.5});sessionStorage.setItem(key,old);
 render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:'本镜'})).toBeNull();expect(screen.queryByRole('button',{name:'本期默认'})).toBeNull();expect(screen.getByRole('spinbutton',{name:'语速'})).toHaveProperty('value','1');
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成口播'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'生成口播'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({speakingRate:1})));
 expect(sessionStorage.getItem(key)).toBe(old);
});

it('shows the chosen text-then-player layout without caption controls or disclosure',()=>{
 const candidate={id:'compact-audio',kind:'audio',shotId:'S01',relativePath:'speech.mp3',text:'很长的完整口播正文',status:'available',durationSeconds:2,targetDurationSeconds:2,speech:{connectionName:'语音连接',selection,voice:'zh_female_vv_uranus_bigtts'}};
 const {command}=setup([candidate]);expect(screen.queryByRole('combobox',{name:'字幕模式'})).toBeNull();expect(document.querySelector('.workspace-template-caption')).toBeNull();
 const article=document.querySelector('.workspace-speech-result')!;expect(article.querySelector('details')).toBeNull();expect(article.querySelector('.workspace-speech-result-note')).toBeNull();expect(within(article as HTMLElement).getByRole('button',{name:'试听 很长的完整口播正文'})).toBeTruthy();expect(within(article as HTMLElement).getByRole('slider',{name:'很长的完整口播正文 播放进度'})).toBeTruthy();expect(article.querySelector('audio')?.getAttribute('src')).toBe('/_local-artifact?episode=e&path=speech.mp3');expect(article.textContent).not.toContain('语音连接');expect(screen.queryByRole('heading',{name:'本镜口播'})).toBeNull();expect(document.querySelector('.workspace-narration-fields>.workspace-template-heading')).toBeNull();expect(command).not.toHaveBeenCalled();
});

it('marks the adopted text inline and withdraws its original audio without generation',async()=>{
 const {workspace,command}=setup([{id:'adopted',kind:'audio',shotId:'S01',relativePath:'voice.mp3',text:'已选中的口播',durationSeconds:2,status:'adopted'}]);cleanup();
 render(<WorkspaceNarrationPanel episodeId="e" workspace={{...workspace,narration:[{...workspace.narration![0],adoptedAudioTrackId:'original-track'}]}} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);
 const row=document.querySelector('.workspace-speech-result')!;expect(within(row.querySelector('.workspace-speech-result-copy')! as HTMLElement).getByText('已采用')).toBeTruthy();expect(within(row as HTMLElement).queryByRole('button',{name:'采用'})).toBeNull();
 const withdraw=within(row as HTMLElement).getByRole('button',{name:'撤销'});expect(withdraw.textContent).toBe('撤销');fireEvent.click(withdraw);
 await waitFor(()=>expect(command).toHaveBeenCalledWith('withdrawWorkspaceNarration',expect.objectContaining({audioTrackId:'original-track',clipId:'c'})));expect(command).toHaveBeenCalledTimes(1);
});

it('keeps the two switches independent and preserves an unsaved caption through hiding',async()=>{
 const {workspace}=setup();cleanup();
 const baseCaption={clipId:'c',shotId:'S01',contract:{enabled:true,contentMode:'follow_tts',text:'完整口播'}};
 const initial={...workspace,captions:[baseCaption] as ProductionWorkspace['captions']};let latest=initial;
 const command=vi.fn(async(name:string,data:any)=>{latest=name==='setWorkspaceCaptionsEnabled'?{...latest,captions:[{...baseCaption,contract:{...baseCaption.contract,enabled:data.enabled}}] as ProductionWorkspace['captions']}:{...latest,narration:[{...latest.narration![0],enabled:data.enabled}]};return latest;});
 function Harness(){const [w,setW]=useState<ProductionWorkspace>(initial);return <WorkspaceNarrationPanel episodeId="e" workspace={w} selectedShotId="S01" pending={false} command={command} onChanged={setW}/>;}
 render(<Harness/>);fireEvent.click(screen.getByRole('tab',{name:'字幕'}));fireEvent.change(screen.getByRole('textbox',{name:'字幕内容'}),{target:{value:'未保存的精简字幕'}});fireEvent.click(screen.getByRole('switch',{name:'启用字幕'}));
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'字幕内容'})).toBeNull());expect(screen.queryByRole('button',{name:'保存字幕'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'口播'}));expect(screen.getByRole('switch',{name:'启用口播'})).toHaveProperty('checked',true);expect(screen.getByRole('textbox',{name:'口播文案'})).toHaveProperty('value','完整口播');
 fireEvent.click(screen.getByRole('tab',{name:'字幕'}));fireEvent.click(screen.getByRole('switch',{name:'启用字幕'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'字幕内容'})).toHaveProperty('value','未保存的精简字幕'));
 expect(command.mock.calls.every(([name])=>name==='setWorkspaceCaptionsEnabled')).toBe(true);
});

it('switches the upper input with the bottom source picker and preserves the narration draft',async()=>{
 const {command}=setup();await sourceReady();fireEvent.change(screen.getByRole('textbox',{name:'口播文案'}),{target:{value:'保留这份口播草稿'}});
 fireEvent.click(screen.getByRole('button',{name:'口播来源'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'人工口播'}));expect(screen.queryByRole('textbox',{name:'口播文案'})).toBeNull();expect(screen.queryByRole('combobox',{name:'声音'})).toBeNull();expect(screen.queryByRole('spinbutton',{name:'语速'})).toBeNull();expect(screen.queryByRole('button',{name:'加入候选'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'口播来源'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'seed-tts-2.0 A · v1'}));expect(screen.getByRole('textbox',{name:'口播文案'})).toHaveProperty('value','保留这份口播草稿');expect(command).not.toHaveBeenCalled();
 expect(screen.getByRole('spinbutton',{name:'语速'}).closest('.workspace-narration-rate-control')?.querySelector('svg')).toBeTruthy();
});

it('adds a newly imported MP3 as an audition candidate without adopting it',async()=>{
 const {workspace}=setup();cleanup();
 const imported={id:'new-file',source_path:'new-voice.mp3',storage_path:'voice/new.mp3',material_type:'audio',material_purpose:'general_reference'};
 const ready={...workspace,narration:[{...workspace.narration![0],mode:'manual' as const,audioTrackId:'new-track',inputFingerprint:'manual'}],candidates:[{id:'new-track',audioTrackId:'new-track',kind:'audio',shotId:'S01',relativePath:imported.storage_path,text:'完整口播',durationSeconds:2,status:'available'}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>ready),onImport=vi.fn(async(_files:File[])=>['new-file']);
 function Harness(){const [w,setW]=useState(workspace),[materials,setMaterials]=useState<typeof imported[]>([]);return <WorkspaceNarrationPanel episodeId="e" workspace={w} selectedShotId="S01" pending={false} command={command} onChanged={setW} materials={materials} onImportAudio={async files=>{const ids=await onImport(files);setMaterials([imported]);return ids;}}/>;}
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'口播来源'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'人工口播'}));const file=new File(['synthetic'],'new-voice.mp3',{type:'audio/mpeg'});fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files:[file]}});
 await screen.findByRole('button',{name:'试听 new-voice.mp3'});expect(onImport).toHaveBeenCalledWith([file]);expect(screen.getByRole('button',{name:'拖入口播文件'})).toBeTruthy();expect(command).toHaveBeenCalledTimes(2);
});

it('retains a failed subtitle edit for retry without changing narration',async()=>{
 const {workspace}=setup();cleanup();const command=vi.fn(async()=>{throw Error('保存失败，请重试');});
 render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} selectedShotId="S01" pending={false} command={command} onChanged={vi.fn()}/>);fireEvent.click(screen.getByRole('tab',{name:'字幕'}));fireEvent.change(screen.getByRole('textbox',{name:'字幕内容'}),{target:{value:'失败后保留的字幕'}});fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));
 await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'字幕内容'})).toHaveProperty('value','失败后保留的字幕');expect(screen.getByRole('button',{name:'保存字幕'})).toHaveProperty('disabled',false);expect(workspace.narration![0].text).toBe('完整口播');expect(command).toHaveBeenCalledTimes(1);
});
