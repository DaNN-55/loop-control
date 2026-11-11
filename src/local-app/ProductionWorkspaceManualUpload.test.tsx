import {useState,type ComponentProps} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {WorkspaceDraftOwner} from './WorkspaceDraft';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('hands narration its imported material even when the parent acknowledges and consumes the shelf receipt',async()=>{
 let w={id:'manual-parent-w',episodeId:'manual-parent-e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,clips:[{id:'clip',itemId:'item',shotId:'S1',text:'镜头',source:null}],project:{relativePath:'project.json',sha256:'sha',fileSize:1,projectId:'project'},readiness:{deliverable:false,placeholders:['item'],missingSources:[]},stale:false,narration:[{clipId:'clip',shotId:'S1',mode:'manual',enabled:true,text:'镜头',status:'pending',inputFingerprint:'initial'}],candidates:[]} as unknown as ProductionWorkspace;
 const imported={id:'voice-material',storage_path:'voice/recording.mp3',source_path:'recording.mp3',material_type:'audio',material_purpose:'general_reference',is_main_script:false};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w})));
 let command!:ReturnType<typeof vi.fn>;
 function Parent(){
  const [materials,setMaterials]=useState<ComponentProps<typeof ProductionWorkspacePanel>['materials']>([]);
  const [execute]=useState(()=>vi.fn(async(name:string,_data:unknown)=>{
   if(name==='importMaterial'){setMaterials([imported]);await new Promise(resolve=>setTimeout(resolve,0));return imported;}
   w={...w,revision:w.revision+1};return w;
  }));
  command=execute;
  return <WorkspaceDraftOwner ownerId="manual-parent-owner"><ProductionWorkspacePanel episodeId={w.episodeId} title="人工口播导入" scriptRevisionId="s" preparationEntry={{shotId:'S1'}} materials={materials} command={(name,data)=>command(name,data)} onLegacy={()=>{}}/></WorkspaceDraftOwner>;
 }
 render(<Parent/>);fireEvent.click(await screen.findByRole('tab',{name:'字幕与口播'}));
 fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files:[new File(['voice'],'recording.mp3',{type:'audio/mpeg'})]}});
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceNarration',expect.objectContaining({materialRevisionId:'voice-material'})));
});
