import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import type {ProductionWorkspace,WorkspaceNarration} from '../productionWorkspace';
const narration:WorkspaceNarration={clipId:'clip',shotId:'S01',mode:'tts',text:'当前口播',voice:'fixture',languageCode:'zh-CN',speakingRate:1,override:false,inputFingerprint:'input',confirmed:true,taskId:'task',status:'completed',error:null,audioTrackId:'audio',artifactId:'artifact',relativePath:'episodes/e/voice.mp3',sha256:'a'.repeat(64),fileSize:10,durationSeconds:2.4,itemId:'voice',adoptedAudioTrackId:null};
afterEach(cleanup);
function show(nativeEditRevision:number,n:WorkspaceNarration=narration){const workspace={id:'w',episodeId:'e',revision:1,nativeEditRevision,stale:false,narration:[n]} as ProductionWorkspace;render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} pending={false} command={vi.fn()} onChanged={vi.fn()}/>);fireEvent.click(screen.getByText('S01'));}
it.each(['edited','locked','replacement'] as const)('guides %s speech to the existing candidate workflow instead of an unusable direct adoption',kind=>{show(kind==='edited'?1:0,{...narration,...(kind==='locked'?{requiresCandidateAdoption:true}:{}),...(kind==='replacement'?{adoptedAudioTrackId:'older-audio'}:{})});expect(screen.queryByRole('button',{name:'采用口播'})).toBeNull();expect(screen.getByRole('status').textContent).toContain('剪辑工作台的口播版本');});
it('keeps direct first assembly available on an untouched draft',()=>{show(0);expect((screen.getByRole('button',{name:'采用口播'}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByRole('status')).toBeNull();});

it('shows the required voice defaults before a new episode can submit TTS',()=>{show(0,{...narration,voice:null,speakingRate:null,languageCode:null,audioTrackId:null,relativePath:null});expect(screen.getByText('请先保存本期默认声音，或填写本镜头声音。')).toBeTruthy();expect((screen.getByRole('button',{name:'确认匹配并准备口播'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('button',{name:'保存默认'})).toBeTruthy();});
it('inherits the saved Episode voice even before a new shot has a saved draft',()=>{
 const workspace={id:'w',episodeId:'e',revision:1,stale:false,narration:[{...narration,voice:null,speakingRate:null,mode:'tts',audioTrackId:null,relativePath:null}]} as ProductionWorkspace;
 render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} defaultSettings={{voice:'saved-episode-voice',speakingRate:1.1,languageCode:'zh-CN'}} pending={false} command={vi.fn()} onChanged={vi.fn()}/>);fireEvent.click(screen.getByText('S01'));expect((screen.getByRole('button',{name:'确认匹配并准备口播'}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByText('请先保存本期默认声音，或填写本镜头声音。')).toBeNull();
});

const configuration={execution_path:'external',executor:{provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0'}};
function configuredPanel(extra:Partial<Parameters<typeof WorkspaceNarrationPanel>[0]>={}){
 const workspace={id:'w',episodeId:'e',revision:3,stale:false,narration:[{...narration,voice:null,audioTrackId:null,relativePath:null}]} as ProductionWorkspace;
 const command=vi.fn(async(name:string)=>name==='refreshWorkspaceNarration'?workspace:undefined),onChanged=vi.fn();
 render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} selectedShotId="S01" pending={false} command={command} onChanged={onChanged} narrationConfiguration={configuration} {...extra}/>);
 return{workspace,command,onChanged};
}
it('shows the installed frozen model and filters real voice choices by language without inventing providers',()=>{
 configuredPanel();const model=screen.getByRole('combobox',{name:'口播模型'}) as HTMLSelectElement;
 expect(model.value).toBe('seed-tts-2.0');expect(model.disabled).toBe(true);expect([...model.options].map(o=>o.value)).toEqual(['seed-tts-2.0']);expect(screen.getByText('火山语音 V3')).toBeTruthy();
 const voice=screen.getByRole('combobox',{name:'默认声音'}) as HTMLInputElement,list=document.getElementById(voice.getAttribute('list')!)!;
 expect(list.querySelectorAll('option')).toHaveLength(10);fireEvent.change(screen.getByRole('combobox',{name:'默认语言'}),{target:{value:'en-US'}});
 expect([...list.querySelectorAll('option')].map(o=>o.value)).toEqual(['zh_female_vv_uranus_bigtts']);
});
it('saves selected voice, language and rate through the existing persistent defaults command without generating speech',async()=>{
 const {workspace,command,onChanged}=configuredPanel();fireEvent.change(screen.getByRole('combobox',{name:'默认声音'}),{target:{value:'  registered-custom-voice  '}});fireEvent.change(screen.getByRole('combobox',{name:'默认语言'}),{target:{value:'en-US'}});fireEvent.change(screen.getByRole('spinbutton',{name:'默认语速'}),{target:{value:'1.2'}});fireEvent.click(screen.getByRole('button',{name:'保存默认'}));
 await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(workspace));expect(command.mock.calls).toEqual([['saveTtsSettings',{episodeId:'e',voice:'registered-custom-voice',languageCode:'en-US',speakingRate:1.2}],['refreshWorkspaceNarration',{episodeId:'e',workspaceId:'w',expectedRevision:3}]]);expect(screen.getByText('已保存')).toBeTruthy();
});
it('retains the edited defaults if persistence fails and does not claim they were saved',async()=>{
 const command=vi.fn(async()=>{throw Error('连接配置版本已变化');});configuredPanel({command});const voice=screen.getByRole('combobox',{name:'默认声音'}) as HTMLInputElement;fireEvent.change(voice,{target:{value:'my-existing-voice'}});fireEvent.click(screen.getByRole('button',{name:'保存默认'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','连接配置版本已变化');expect(voice.value).toBe('my-existing-voice');expect(screen.queryByText('已保存')).toBeNull();expect(command).toHaveBeenCalledTimes(1);
});
it('preserves an existing custom voice and locale instead of silently replacing them with catalog defaults',()=>{
 configuredPanel({defaultSettings:{voice:'saved-custom-id',languageCode:'xx-current',speakingRate:1.3}});fireEvent.click(screen.getByText('本期默认'));
 expect((screen.getByRole('combobox',{name:'默认声音'}) as HTMLInputElement).value).toBe('saved-custom-id');expect((screen.getByRole('combobox',{name:'默认语言'}) as HTMLSelectElement).value).toBe('xx-current');expect((screen.getByRole('spinbutton',{name:'默认语速'}) as HTMLInputElement).value).toBe('1.3');
});
it.each([undefined,{execution_path:'external',executor:{provider:'google_tts',adapter:'google_tts',model:'retired'}},{execution_path:'external',executor:{provider:'volcengine_tts',adapter:'volcengine_tts',model:'not-installed'}}])('does not advertise an unregistered or missing model as available (%j)',value=>{
 configuredPanel({narrationConfiguration:value});const model=screen.getByRole('combobox',{name:'口播模型'}) as HTMLSelectElement;expect(model.value).toBe('');expect(model.options).toHaveLength(1);expect(screen.queryByText('火山语音 V3')).toBeNull();expect(screen.queryByText('seed-tts-2.0 · 本期使用')).toBeNull();
});
