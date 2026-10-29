import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceAudioPanel,WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const workspace={id:'w',episodeId:'e',revision:2,project:{sha256:'h'},clips:[{id:'c',itemId:'visual',shotId:'S1',text:'镜头',source:null}],audio:{mix:{voices:[{shotId:'S1',mode:'none',gainDb:0,ambienceGainDb:null,sourceItemId:null,sourceAssetId:null}],sounds:[]},preparations:[]}} as unknown as ProductionWorkspace;
afterEach(cleanup);
it('editing the main-voice form does not alter the native timeline until explicit apply',async()=>{
 const command=vi.fn(async()=>workspace);render(<WorkspaceAudioPanel workspace={workspace} command={command} onChange={()=>{}}/>);fireEvent.change(screen.getByLabelText('主声音'),{target:{value:'tts'}});expect(command).not.toHaveBeenCalled();expect((screen.getByLabelText('保留低音量原声') as HTMLInputElement).checked).toBe(false);fireEvent.click(screen.getByRole('button',{name:'应用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('mixWorkspaceAudio',expect.objectContaining({edit:expect.objectContaining({mode:'tts',ambienceGainDb:null,visualItemIds:['visual']})})));
});
it('manual preparation is an explicit durable Owner action and keeps query out of the manual request',async()=>{
 const command=vi.fn(async()=>workspace);render(<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[{id:'m',material_type:'audio',source_path:'music.mp3'}]}/>);fireEvent.change(screen.getByLabelText('来源'),{target:{value:'m'}});expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'准备人工音频'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceAudio',expect.objectContaining({kind:'bgm',materialRevisionId:'m',anchor:'absolute'})));
});
it('shows the selected native source window and never presents partial source coverage as a whole-shot voice',()=>{
 const value=structuredClone(workspace);value.audio!.mix.voices[0]={...value.audio!.mix.voices[0],mode:'source',coverage:'partial',startSeconds:0,durationSeconds:1,shotDurationSeconds:2,sourceStartSeconds:1,sourceLabel:'镜头实例 1',alignmentReady:false};render(<WorkspaceAudioPanel workspace={value} command={vi.fn()} onChange={()=>{}}/>);expect(screen.getByText('镜头实例 1 · 0.00–1.00s · 源 1.00s')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('原声仅覆盖部分镜头');expect(screen.getByRole('status').textContent).toContain('整段声学对齐不可用');
});
