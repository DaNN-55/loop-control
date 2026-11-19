import {useEffect,useState} from 'react';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkspaceMainVoicePanel} from './WorkspaceMainVoicePanel';
import {registeredAdapters} from '../worker/registeredAdapters';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {defaultShotCaptionContract} from '../shotCaptions';

beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});});
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
const selection={capability:'speech' as const,provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:'a'};
function fixture(){
 const defaults={selection,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1};
 const workspace={id:'w',episodeId:'e',revision:1,stale:false,project:{sha256:'sha'},clips:[{id:'c1',itemId:'video',shotId:'S01',text:'第一句'},{id:'c2',itemId:'other',shotId:'S02',text:'第二句'}],narration:['S01','S02'].map((shotId,i)=>({clipId:'c'+(i+1),shotId,mode:'tts',enabled:true,text:'口播正文',status:'pending',inputFingerprint:'f',defaults,...defaults})),audio:{mix:{voices:[],sounds:[]},preparations:[]},captions:[{clipId:'c1',shotId:'S01',itemId:'video',contract:defaultShotCaptionContract('原字幕','independent'),timing:'stale',inputFingerprint:'caption'}]} as unknown as ProductionWorkspace;
 const choice=registeredAdapters.productionChoices().find(c=>c.capability==='speech')!;
 const services=[{...choice,id:'a',connectionVersionId:'a',connectionName:'语音',connectionVersion:1,executable:true}];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,json:async()=>path.endsWith('/workspace')?{workspace}:{serviceCatalog:{groups:[{capability:'speech',services}]}}})));
 const command=vi.fn(async(name:string,data?:unknown)=>name==='setWorkspaceNarrationEnabled'?{...workspace,narration:workspace.narration!.map(n=>n.clipId===(data as {clipId:string}).clipId?{...n,enabled:(data as {enabled:boolean}).enabled,requestedMode:(data as {voiceMode:'none'|'source'|'tts'|'manual'}).voiceMode}:n)}:workspace),onChanged=vi.fn(),onImportAudio=vi.fn(async()=>[]);
 return{workspace,command,onChanged,defaults,onImportAudio};
}
function Harness(props:Parameters<typeof WorkspaceMainVoicePanel>[0]){const [workspace,setWorkspace]=useState(props.workspace);useEffect(()=>setWorkspace(props.workspace),[props.workspace]);return <WorkspaceMainVoicePanel {...props} workspace={workspace} onChanged={next=>{props.onChanged(next);setWorkspace(next);}}/>;}
it('offers one four-way main voice selector and keeps selecting an upload free of production writes',async()=>{
 const f=fixture();render(<Harness {...f} episodeId="e" selectedShotId="S01" pending={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'语音模型'}));
 expect(screen.queryByRole('searchbox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'关闭模型选择'}));
 const selector=screen.getByRole('combobox',{name:'主声音来源'});
 expect(selector.closest('.workspace-narration-subheader')).toBeTruthy();
 expect(screen.queryByText('这个镜头听什么')).toBeNull();
 expect(screen.queryByRole('switch',{name:'启用口播'})).toBeNull();
 fireEvent.keyDown(selector,{key:'ArrowDown'});
 const options=screen.getAllByRole('option');expect(options.map(o=>o.textContent)).toEqual(['无主声音','使用视频原声','生成口播','上传口播']);
 expect(options.every(o=>o.querySelector('svg[aria-hidden="true"]'))).toBe(true);
 fireEvent.click(screen.getByRole('option',{name:'上传口播'}));
 await screen.findByRole('button',{name:'拖入口播文件'});expect(f.command).toHaveBeenCalledExactlyOnceWith('setWorkspaceNarrationEnabled',expect.objectContaining({voiceMode:'manual',enabled:true}));
 fireEvent.click(screen.getByRole('tab',{name:'字幕'}));expect(screen.getByRole('textbox',{name:'字幕内容'})).toBeTruthy();
});
it('keeps local voice settings scoped to the shot and does not promote them when generating',async()=>{
 const f=fixture();const view=render(<Harness {...f} episodeId="e" selectedShotId="S01" pending={false}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成口播'})).toHaveProperty('disabled',false));
 fireEvent.change(screen.getByRole('spinbutton',{name:'语速'}),{target:{value:'1.25'}});
 view.rerender(<Harness {...f} episodeId="e" selectedShotId="S02" pending={false}/>);
 expect(screen.getByRole('spinbutton',{name:'语速'})).toHaveProperty('value','1');
 view.rerender(<Harness {...f} episodeId="e" selectedShotId="S01" pending={false}/>);
 expect(screen.getByRole('spinbutton',{name:'语速'})).toHaveProperty('value','1.25');
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成口播'})).toHaveProperty('disabled',false));
 fireEvent.click(screen.getByRole('button',{name:'生成口播'}));
 await waitFor(()=>expect(f.command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({clipId:'c1',speakingRate:1.25})));
 expect(f.command.mock.calls.some(([name])=>name==='saveWorkspaceNarrationDefaults')).toBe(false);
});
it('promotes settings to episode defaults only through the explicit default action',async()=>{
 const f=fixture();render(<Harness {...f} episodeId="e" selectedShotId="S01" pending={false}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成口播'})).toHaveProperty('disabled',false));
 fireEvent.change(screen.getByRole('spinbutton',{name:'语速'}),{target:{value:'1.2'}});
 fireEvent.click(screen.getByRole('button',{name:'设为本期默认'}));
 await waitFor(()=>expect(f.command).toHaveBeenCalledExactlyOnceWith('saveWorkspaceNarrationDefaults',expect.objectContaining({speakingRate:1.2})));
});
it('connects a ready extracted source after one explicit request without requesting paid narration',async()=>{
 const f=fixture(),prep={id:'p',kind:'source',shotId:'S01',sourceItemId:'video',description:'原片',status:'completed',taskId:'t',audioTrackId:'track',relativePath:'voice.mp3',sha256:'a'.repeat(64),generationTask:{taskId:'t',status:'completed'}};
 f.workspace.narration![0].requestedMode='source';
 f.workspace.audio!.preparations=[prep] as unknown as NonNullable<ProductionWorkspace['audio']>['preparations'];
 const project={timelines:[{id:'timeline',fps:30,items:[{id:'video',kind:'video',name:'原片',src:'v.mp4',sourceAssetId:'v',startFrame:0,durationInFrames:60}],tracks:{},trackOrder:[]}],assets:[]} as unknown as OpenChatCutProject;
 render(<Harness {...f} project={project} episodeId="e" selectedShotId="S01" pending={false}/>);
 expect(f.command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'使用视频原声'}));
 await waitFor(()=>expect(f.command).toHaveBeenCalledExactlyOnceWith('adoptWorkspaceAudio',expect.objectContaining({preparationId:'p'})));
});
it('prepares source once and automatically connects its completed result without a second adoption button',async()=>{
 const f=fixture(),project={timelines:[{id:'timeline',fps:30,items:[{id:'video',kind:'video',name:'原片',src:'v.mp4',sourceAssetId:'v',startFrame:0,durationInFrames:60}],tracks:{},trackOrder:[]}],assets:[]} as unknown as OpenChatCutProject;
 f.workspace.narration![0].requestedMode='source';
 const queued={...f.workspace,revision:2,audio:{...f.workspace.audio!,preparations:[{id:'p',kind:'source',shotId:'S01',sourceItemId:'video',description:'原片',status:'ready',taskId:'t',generationTask:{taskId:'t',status:'ready'}}]}} as unknown as ProductionWorkspace;
 f.command.mockResolvedValue(queued);
 const view=render(<Harness {...f} project={project} episodeId="e" selectedShotId="S01" pending={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'使用视频原声'}));
 await waitFor(()=>expect(f.command).toHaveBeenCalledExactlyOnceWith('prepareWorkspaceAudio',expect.objectContaining({sourceItemId:'video'})));
 const ready={...queued,audio:{...queued.audio!,preparations:[{...queued.audio!.preparations[0],status:'completed',audioTrackId:'track',relativePath:'voice.mp3',sha256:'a'.repeat(64),generationTask:{taskId:'t',status:'completed'}}]}} as unknown as ProductionWorkspace;
 f.command.mockResolvedValue(ready);view.rerender(<Harness {...f} workspace={ready} project={project} episodeId="e" selectedShotId="S01" pending={false}/>);
 await waitFor(()=>expect(f.command).toHaveBeenCalledWith('adoptWorkspaceAudio',expect.objectContaining({expectedRevision:2,preparationId:'p'})));
 expect(f.command).toHaveBeenCalledTimes(2);expect(screen.queryByRole('button',{name:'采用为主声'})).toBeNull();
});
it('keeps subtitles independently editable after turning off main voice',async()=>{
 const f=fixture();render(<Harness {...f} episodeId="e" selectedShotId="S01" pending={false}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'主声音来源'}),{target:{value:'none'}});
 await waitFor(()=>expect(f.command).toHaveBeenCalledWith('setWorkspaceNarrationEnabled',expect.objectContaining({clipId:'c1',enabled:false})));
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'主声音来源'})).toHaveProperty('value','none'));
 fireEvent.click(screen.getByRole('tab',{name:'字幕'}));expect(screen.getByRole('textbox',{name:'字幕内容'})).toHaveProperty('disabled',false);
});
it('keeps a failed source connection explicit instead of showing endless progress or automatically retrying',async()=>{
 const f=fixture();f.workspace.narration![0].requestedMode='source';f.command.mockRejectedValue(new Error('原视频没有可用声音'));
 const project={timelines:[{id:'timeline',fps:30,items:[{id:'video',kind:'video',src:'v.mp4',sourceAssetId:'v',startFrame:0,durationInFrames:60}],tracks:{},trackOrder:[]}],assets:[]} as unknown as OpenChatCutProject;
 render(<Harness {...f} project={project} episodeId="e" selectedShotId="S01" pending={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'使用视频原声'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','原视频没有可用声音');
 expect(screen.getByRole('button',{name:'使用视频原声'})).toHaveProperty('disabled',false);
 expect(screen.queryByRole('button',{name:'正在接入视频原声…'})).toBeNull();expect(f.command).toHaveBeenCalledTimes(1);
});
