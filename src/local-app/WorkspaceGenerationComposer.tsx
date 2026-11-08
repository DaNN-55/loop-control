import {useState,type ReactNode} from 'react';
import {Dialog,DialogTrigger,Popover} from 'react-aria-components';
import {ChevronDown,Image as ImageIcon,Video,Search,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useWorkspaceMaterialSelection,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
import './workspace-generation-composer.css';

export function WorkspaceComposerSetting({label,summary,open,onOpenChange,disabled,compact=false,hint,children}:{compact?:boolean;hint?:string;label:string;summary:string;open:boolean;onOpenChange:(open:boolean)=>void;disabled?:boolean;children:ReactNode}){
 return <DialogTrigger isOpen={open} onOpenChange={onOpenChange}>
  <Button size="xs" color="tertiary" className="workspace-composer-chip" aria-label={label} title={hint} isDisabled={disabled} iconTrailing={ChevronDown}>{summary}</Button>
  <Popover className="dan-ui product-ui workspace-composer-popover" data-compact={compact||undefined} placement="top start" offset={8} containerPadding={12} shouldFlip>
   <Dialog aria-label={label} className="workspace-composer-settings">{({close})=><><header><h3>{label}</h3><Button size="xs" color="tertiary" aria-label={`关闭${label}`} iconLeading={X} onPress={close}/></header>{children}</>}</Dialog>
  </Popover>
 </DialogTrigger>;
}

export function WorkspaceGenerationComposer({kind,operation='generate',disabled,reference,prompt,model,settings,submit,onMaterial,onFiles,children}:{kind:'image'|'video';operation?:'generate'|'search';disabled?:boolean;reference:ReactNode;prompt:ReactNode;model:ReactNode;settings:ReactNode;submit:ReactNode;onMaterial:(id:string)=>void;onFiles:(files:File[])=>void;children?:ReactNode}){
 const shelf=useWorkspaceMaterialSelection(),[over,setOver]=useState(false);
 return <div className="workspace-generation-composer" data-kind={kind} data-operation={operation} data-drag-over={over||undefined} aria-label={operation==='search'?'视频检索输入框':kind==='image'?'图片生成输入框':'视频生成输入框'}
  onDragOver={event=>{
   if(operation==='search'||disabled||!Array.from(event.dataTransfer.types??[]).some(type=>type===workspaceMaterialDragType||type==='Files'))return;
   const material=shelf?.materials.find(m=>m.id===shelf.draggingId),accept=event.dataTransfer.types.includes('Files')||material&&(kind==='video'?['image','video'].includes(material.material_type):material.material_type==='image');
   event.preventDefault();event.dataTransfer.dropEffect=accept?'copy':'none';setOver(!!accept);
  }} onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setOver(false);}}
  onDrop={event=>{
   setOver(false);if(operation==='search'||disabled||event.defaultPrevented)return;
   const id=event.dataTransfer.getData(workspaceMaterialDragType),material=shelf?.materials.find(m=>m.id===id);
   if(material&&(kind==='video'?['image','video'].includes(material.material_type):material.material_type==='image')){event.preventDefault();onMaterial(id);shelf?.select('');}
   else if(event.dataTransfer.files?.length){event.preventDefault();onFiles([...event.dataTransfer.files]);}
  }}>
  <div className="workspace-composer-input"><div className="workspace-composer-reference">{reference}</div>
  <div className="workspace-composer-prompt">{prompt}</div></div>
  <div className="workspace-composer-toolbar"><span className="workspace-composer-kind">{operation==='search'?<Search size={14}/>:kind==='image'?<ImageIcon size={14}/>:<Video size={14}/>} {operation==='search'?'视频检索':kind==='image'?'图片生成':'视频生成'}</span>{model}{settings}<div className="workspace-composer-submit">{submit}</div></div>
  {children}
 </div>;
}
