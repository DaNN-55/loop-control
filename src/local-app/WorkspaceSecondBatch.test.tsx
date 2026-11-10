import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import {defaultWanModelSettings} from '../wanVideoModels';
import {registeredAdapters} from '../worker/registeredAdapters';
import {taskTypeLabel} from '../observability/TaskProgressPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const workspace={id:'second-batch',episodeId:'e',revision:1,project:{sha256:'h'},clips:[{id:'clip',itemId:'visual',shotId:'shot-1',text:'镜头'}],visualCandidates:[],audio:{mix:{voices:[],sounds:[]},preparations:[]}} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.unstubAllGlobals();});
it('accepts plain prose and previews its exact paragraph subtitles before registering a valid script',async()=>{
 const command=vi.fn(async(_name:string,_data:unknown)=>({id:'script'}));render(<WorkspaceScriptPanel episodeId="plain" scriptRevisionId={null} script="" stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'雨停了。\n\n街角亮着灯。'}});
 fireEvent.click(screen.getByText(/镜头与字幕预览/));expect(screen.getByRole('region',{name:'镜头与字幕预览'}).textContent).toContain('雨停了。');expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('start',{episodeId:'plain'}));
 const input=command.mock.calls.find(([name])=>name==='importMaterial')![1] as any;
 expect(new TextDecoder().decode(Uint8Array.from(atob(input.contentBase64),(c)=>c.charCodeAt(0)))).toBe('# 主脚本\n\n## 正文\n\n雨停了。\n\n街角亮着灯。\n');
});
it('structured script preview separates narration and visual instructions before submitting',()=>{
 const script='# 夜景\n## 制作设置\n- 模板版本：2\n## 正文\n### 段落 01\n- 口播：街角亮着灯。\n- 首帧素材：无\n- 视频生成提示词：镜头缓慢推进。';
 render(<WorkspaceScriptPanel episodeId="v2" scriptRevisionId={null} script={script} stage="waiting_input" readOnly={false} pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);
 fireEvent.click(screen.getByText(/镜头与字幕预览/));const preview=within(screen.getByRole('region',{name:'镜头与字幕预览'}));expect(preview.getByText('街角亮着灯。')).toBeTruthy();expect(preview.getByText('镜头缓慢推进。')).toBeTruthy();
});
it('first model selection uses the chosen model defaults including its required audio',async()=>{
 const choice=registeredAdapters.productionChoices().find(c=>c.capability==='video'&&c.provider==='bailian')!;
 const service={...choice,id:'wan',connectionVersionId:'wan',connectionName:'百炼',executable:true,models:['wan2.6-i2v']};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[service]}]}})));
 render(<WorkspaceVisualPreparation workspace={workspace} materials={[]} command={vi.fn()} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));
 await userEvent.click(await screen.findByRole('menuitemradio',{name:/^wan2.6-i2v/}));await screen.findByRole('dialog',{name:'视频规格'});
 await waitFor(()=>expect(JSON.parse(sessionStorage.getItem('loop-visual-draft:second-batch:visual')!).videoSettings).toEqual(defaultWanModelSettings('wan2.6-i2v')));
 expect(screen.queryByRole('button',{name:'按此模型恢复默认参数'})).toBeNull();expect(screen.queryByText(/固定有声|不支持生成音频/)).toBeNull();
});
it('places image adoption outside more actions and keeps first-frame selection secondary',()=>{
 const c={id:'image',kind:'image',usage:'still',targetItemId:'visual',shotId:'shot-1',materialRevisionId:'m',relativePath:'image.png',sha256:'a'.repeat(64),status:'available',durationSeconds:5,currentDurationSeconds:5};
 render(<WorkspaceVisualPreparation workspace={{...workspace,visualCandidates:[c]} as unknown as ProductionWorkspace} materials={[]} command={vi.fn()} onChange={()=>{}}/>);
 const adopt=screen.getByRole('button',{name:/采用(?:图片|视频)到当前镜头/});expect(adopt.closest('details')).toBeNull();expect(screen.getByRole('button',{name:'用作视频首帧'}).closest('details')).toBeNull();
});
it('offers local MP3 immediately without configuring search and prepares only a candidate after upload',async()=>{
 const command=vi.fn(async(name:string)=>name==='importMaterial'?{id:'music'}:workspace);
 render(<WorkspaceAudioPreparation workspace={workspace} materials={[]} command={command} onChange={()=>{}}/>);
 expect(screen.getByRole('button',{name:'添加本地配乐（MP3）'})).toBeTruthy();expect(screen.getByLabelText('上传配乐').getAttribute('accept')).toBe('.mp3,audio/mpeg');
 fireEvent.change(screen.getByLabelText('上传配乐'),{target:{files:[new File(['controlled mp3'],'music.mp3',{type:'audio/mpeg'})]}});
 await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'bgm',materialRevisionId:'music'})));
 expect(command.mock.calls.some(([name])=>name==='adoptWorkspaceAudio')).toBe(false);
});
it('shows both legacy video task kinds as video generation',()=>{
 expect(taskTypeLabel('generate_a_roll')).toBe('生成视频');expect(taskTypeLabel('generate_b_roll')).toBe('生成视频');
});
it('keeps custom settings when changing an existing video choice until explicit reset',async()=>{
 const choice=registeredAdapters.productionChoices().find(c=>c.capability==='video'&&c.provider==='bailian')!;
 const service={...choice,id:'wan',connectionVersionId:'wan',connectionName:'百炼',executable:true,models:['wan2.6-i2v-flash','wan2.6-i2v']};
 const custom={...defaultWanModelSettings('wan2.6-i2v-flash'),resolution:'1080P',negativePrompt:'保留我的负面提示词',seed:91};
 sessionStorage.setItem('loop-visual-draft:second-batch:visual',JSON.stringify({tab:'video',origin:{image:'generate',video:'generate'},settings:{size:'1024x1024',quality:'auto',count:1},videoSelection:{capability:'video',provider:'bailian',adapter:choice.adapter,connectionVersionId:'wan',model:'wan2.6-i2v-flash'},videoSettings:custom}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[service]}]}})));
 render(<WorkspaceVisualPreparation workspace={workspace} materials={[]} command={vi.fn()} onChange={()=>{}}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('wan2.6-i2v-flash'));
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));await userEvent.click(await screen.findByRole('menuitemradio',{name:'wan2.6-i2v'}));
 await waitFor(()=>expect(JSON.parse(sessionStorage.getItem('loop-visual-draft:second-batch:visual')!).videoSettings).toEqual(custom));
 await userEvent.click(screen.getByRole('button',{name:'关闭视频规格'}));await userEvent.click(screen.getByRole('button',{name:'按此模型恢复默认参数'}));
 await waitFor(()=>expect(JSON.parse(sessionStorage.getItem('loop-visual-draft:second-batch:visual')!).videoSettings).toEqual(defaultWanModelSettings('wan2.6-i2v')));
});
it('blocks malformed structured input before material registration and leaves the original text intact',()=>{
 const script='# 夜景\n## 制作设置\n- 模板版本：2\n## 正文\n### 段落 01\n- 画面提示：这段不是字幕。',command=vi.fn();
 render(<WorkspaceScriptPanel episodeId="bad-v2" scriptRevisionId={null} script={script} stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));expect(screen.getByRole('alert').textContent).toContain('缺少口播');expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe(script);expect(command).not.toHaveBeenCalled();
});
it('keeps a prepared local candidate available for audition without offering duplicate preparation',()=>{
 sessionStorage.setItem('loop-audio-draft-v2:second-batch:episode-music',JSON.stringify({kind:'bgm',inputMode:'upload',manual:'music',duration:1,description:'本地音乐',query:'',offset:0,anchor:'absolute',shot:''}));
 const value={...workspace,audio:{...workspace.audio,preparations:[{id:'p',kind:'bgm',status:'ready',description:'本地音乐',durationSeconds:1,offsetSeconds:0,anchor:'absolute',source:{provider:'manual',materialRevisionId:'music'}}]}} as unknown as ProductionWorkspace;
 const command=vi.fn();render(<WorkspaceAudioPreparation workspace={value} materials={[{id:'music',material_type:'audio',source_path:'music.mp3',material_purpose:'background_music'}]} command={command} onChange={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'已加入候选'})).toBeNull();expect(screen.getByRole('button',{name:'采用'})).toBeTruthy();fireEvent.drop(screen.getByRole('group',{name:'音频输入'}),{dataTransfer:{types:['application/x-loop-workspace-material'],getData:()=> 'music',files:[]}});expect(command).not.toHaveBeenCalled();
});
