import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceAudioUpload} from './WorkspaceAudioUpload';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
afterEach(cleanup);
it('Owner registers an MP3 for its explicit sound purpose after saving the current editor',async()=>{
 const workspace={id:'w',episodeId:'episode',stale:false} as ProductionWorkspace,events:string[]=[],bridge={connected:true,save:vi.fn(async()=>{events.push('save');})} as unknown as EmbeddedStudioBridge,command=vi.fn(async()=>{events.push('register');return{id:'sound'};}),onRegistered=vi.fn();
 render(<WorkspaceAudioUpload workspace={workspace} bridge={bridge} command={command} onRegistered={onRegistered}/>);
 fireEvent.change(screen.getByLabelText('声音素材用途'),{target:{value:'sound_effect'}});fireEvent.change(screen.getByLabelText('上传声音素材'),{target:{files:[new File(['mp3 content'],'effect.mp3',{type:'audio/mpeg'})]}});
 await waitFor(()=>expect(onRegistered).toHaveBeenCalledWith({id:'sound',material_type:'audio',source_path:'effect.mp3'}));
 expect(events).toEqual(['save','register']);expect(command).toHaveBeenCalledWith('importMaterial',expect.objectContaining({episodeId:'episode',materialType:'audio',sourceKind:'file',sourcePath:'effect.mp3',mimeType:'audio/mpeg',materialPurpose:'sound_effect',isMainScript:false}));expect(command).toHaveBeenCalledTimes(1);
});
