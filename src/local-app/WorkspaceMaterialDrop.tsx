import {canUseWorkspaceAudioMaterial,type WorkspaceAudioMaterialPurpose} from './workspaceAudioMaterial';
import {createContext,useContext,useState,type PropsWithChildren} from 'react';
import {MoveDown} from 'lucide-react';

export type WorkspaceShelfMaterial={id:string;material_type:string;source_path:string;material_purpose?:string|null};
export const workspaceMaterialDragType='application/x-loop-workspace-material';
type MaterialSelection={
 materials:readonly WorkspaceShelfMaterial[];
 selectedId:string;
 select:(id:string)=>void;
 draggingId:string;
 drag:(id:string)=>void;
};
const WorkspaceMaterialSelection=createContext<MaterialSelection|null>(null);
export const useWorkspaceMaterialSelection=()=>useContext(WorkspaceMaterialSelection);

export function WorkspaceMaterialSelectionProvider({materials,children}:PropsWithChildren<{materials:readonly WorkspaceShelfMaterial[]}>){
 const [selectedId,select]=useState(''),[draggingId,drag]=useState('');
 return <WorkspaceMaterialSelection.Provider value={{materials,selectedId,select,draggingId,drag}}>{children}</WorkspaceMaterialSelection.Provider>;
}

export function WorkspaceMaterialDrop({label,kind,purpose,disabled,selectedName,surface,persistent=false,onSelect,onBrowse,onFiles}:{
 label:string;kind:'image'|'video'|'audio'|'visual';purpose?:WorkspaceAudioMaterialPurpose;disabled?:boolean;selectedName?:string;surface?:'preview';persistent?:boolean;onSelect:(id:string)=>void;onBrowse?:()=>void;onFiles?:(files:File[])=>void;
}){
 const shelf=useWorkspaceMaterialSelection();
 const [over,setOver]=useState(false);
 if(!shelf&&!onBrowse)return null;
 function accepts(material:WorkspaceShelfMaterial|undefined){
  return !!material&&(kind==='visual'?['image','video'].includes(material.material_type):material.material_type===kind)&&(!purpose||canUseWorkspaceAudioMaterial(material.material_purpose,purpose));
 }
 const selected=shelf?.materials.find(m=>m.id===shelf.selectedId);
 const dragging=shelf?.materials.find(m=>m.id===shelf.draggingId);
 const canPick=!disabled&&accepts(selected);
 const canDrop=!disabled&&accepts(dragging);
 if(surface&&!persistent&&!(shelf?.draggingId?canDrop:canPick))return null;
 const choose=(id:string)=>{
  if(surface)shelf?.select('');
  onSelect(id);
 };
 return <button type="button" className="workspace-material-drop" data-surface={surface} data-drag-over={over||undefined}
  disabled={disabled} aria-disabled={!canPick&&!onBrowse||undefined}
  aria-label={selectedName?`${label}，已选 ${selectedName}`:label}
  title={selectedName?'拖入其他素材可替换当前选择':'也可先点击左侧素材，再点击这里'}
  onClick={()=>{if(canPick&&selected)choose(selected.id);else onBrowse?.();}}
  onDragOver={event=>{
   const fromShelf=event.dataTransfer.types.includes(workspaceMaterialDragType);
   if(!fromShelf&&!event.dataTransfer.types.includes('Files'))return;
   event.preventDefault();
   const accepted=fromShelf?canDrop:!disabled&&!!onFiles;
   event.dataTransfer.dropEffect=accepted?'copy':'none';
   setOver(accepted);
  }}
  onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setOver(false);}}
  onDrop={event=>{
   const id=event.dataTransfer.getData(workspaceMaterialDragType);
   if(!id&&!event.dataTransfer.types?.includes('Files'))return;
   event.preventDefault();
   setOver(false);
   if(disabled)return;
   if(accepts(shelf?.materials.find(m=>m.id===id)))choose(id);
   else if(onFiles&&event.dataTransfer.files?.length)onFiles([...event.dataTransfer.files]);
  }}>
  <MoveDown size={surface?20:14} aria-hidden="true"/><span>{selectedName||label}</span>
  {surface&&<small>{canDrop?'松开即可选取':canPick?'使用已选素材':onBrowse?'点击上传，或从本期素材拖入':'从左侧本期素材拖入'}</small>}
 </button>;
}
