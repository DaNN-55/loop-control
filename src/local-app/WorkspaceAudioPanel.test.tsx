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
