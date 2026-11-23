import {uiText} from '../i18n/ui';
import {useId,useRef,useState,type DragEvent} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceShotWindow,type WorkspaceShotOperation} from '../workspaceShots';
import {workspaceShotSource} from './WorkspaceShotPreview';
import {workspaceShotPreparation,type WorkspacePreparationTarget} from './workspaceShotPreparation';
import {WorkspaceShotPreparationStatus} from './WorkspaceShotPreparationStatus';
import {CompletedShotThumbnail} from './CompletedShotThumbnail';
import type {StoryboardBatchKind} from '../storyboardBatch';
import {workspaceStoryboardProgress} from './workspaceStoryboardProgress';

interface Props {
 workspace:ProductionWorkspace;project:OpenChatCutProject|null;materials:Array<{storage_path:string;source_path:string}>;
 batch?:{selected:ReadonlySet<string>;eligible:ReadonlySet<string>;disabled:boolean;onToggle:(shotId:string)=>void};
 onGenerationNavigate?:(shotId:string,kind:StoryboardBatchKind,targetItemId?:string)=>void;
 selectedShotId:string|undefined;disabled:boolean;readOnly?:boolean;completedView?:boolean;
 onPreparationNavigate?:(shotId:string,target:WorkspacePreparationTarget)=>void;
 onSelect:(shotId:string)=>void;onDelete:(clip:WorkspaceClip)=>void;onEdit:(operation:WorkspaceShotOperation)=>Promise<void>;
}

export function WorkspaceShotTable({workspace,project,materials,selectedShotId,disabled,readOnly=false,completedView=false,batch,onSelect,onDelete,onEdit,onPreparationNavigate,onGenerationNavigate}:Props){
 const locked=disabled||readOnly;
 const selectionDisabled=disabled&&!readOnly;
 const clips=workspace.clips.filter((clip,index,all)=>all.findIndex(c=>c.shotId===clip.shotId)===index);
 const [adding,setAdding]=useState(false),[text,setText]=useState(''),[drop,setDrop]=useState<{shotId:string;after:boolean}|null>(null),[announcement,setAnnouncement]=useState('');
 const helpId=useId(),inputId=useId(),dragged=useRef<string|null>(null),editing=useRef(false),input=useRef<HTMLTextAreaElement>(null),addButton=useRef<HTMLButtonElement>(null);
 function cancelAdd(){setAdding(false);setText('');requestAnimationFrame(()=>addButton.current?.focus());}
 async function insert(){
  if(locked||editing.current)return;
  if(!text.trim()){input.current?.focus();return;}
  editing.current=true;
  try{await onEdit({kind:'insert',afterShotId:clips.at(-1)?.shotId??null,text:text.trim()});setAdding(false);setText('');setAnnouncement('已在末尾新增镜头。');requestAnimationFrame(()=>addButton.current?.focus());}catch{/* The workspace presents errors; retain the draft. */}finally{editing.current=false;}
 }
 async function move(shotId:string,beforeShotId:string|null){
  const index=clips.findIndex(c=>c.shotId===shotId);
  if(locked||editing.current||index<0||beforeShotId===shotId||beforeShotId===(clips[index+1]?.shotId??null))return;
  editing.current=true;
  try{await onEdit({kind:'move',shotId,beforeShotId});setAnnouncement(`${shotId} 顺序已更新。`);}catch{/* The workspace presents errors; keep the saved order. */}finally{editing.current=false;}
 }
 function dragOver(event:DragEvent<HTMLTableRowElement>,shotId:string){
  if(locked||!dragged.current||dragged.current===shotId)return;
  event.preventDefault();event.dataTransfer.dropEffect='move';const rect=event.currentTarget.getBoundingClientRect();
  setDrop({shotId,after:event.clientY>rect.top+rect.height/2});
 }
 if(completedView)return <table className="completed-shot-index" aria-label={uiText('镜头')}>
  <tbody>{clips.map((clip,index)=>{
   const number=String(index+1).padStart(2,'0'),selected=clip.shotId===selectedShotId;
   const window=project&&readWorkspaceShotWindow(project,clip.itemId);
   const duration=window?window.durationInFrames/window.timeline.fps:clip.image?.durationSeconds;
   const label=uiText('镜头 {number}',{number});
   return <tr key={clip.shotId} aria-label={label} aria-selected={selected}><td>
    <button type="button" aria-label={uiText('选择{value0}',{value0:label})} aria-pressed={selected} onClick={()=>onSelect(clip.shotId)}>
     <CompletedShotThumbnail workspace={workspace} project={project} itemId={clip.itemId}/>
     <span className="completed-shot-index-text">
      <span><strong>{label}</strong><small>{Number.isFinite(duration)?`${duration!.toFixed(1)} s`:'—'}</small></span>
      <span>{clip.text}</span>
     </span>
    </button>
   </td></tr>;
  })}</tbody>
 </table>;
 return <>
  <div className="workspace-table-caption"><h3>{uiText("镜头 ")}{!readOnly&&!disabled&&<span id={helpId} >{uiText("拖动行调整顺序，或按 Alt + ↑/↓")}</span>}</h3></div>
  <div className="workspace-shot-table-scroll" role="region" aria-label={uiText("镜头清单")} tabIndex={0}>
   <table className={"workspace-shot-table"+(readOnly?" is-readonly":"")} aria-label={uiText("镜头")}><colgroup>{[72,'auto',72,84,...(readOnly?[]:[44])].map((width,index)=><col key={index} style={{width}}/>)}</colgroup><thead><tr><th scope="col">{uiText("镜头")}</th><th scope="col">{uiText("脚本与素材")}</th><th scope="col">{uiText("时长")}</th><th scope="col">{uiText("准备情况")}</th>{!readOnly&&<th scope="col">{uiText("操作")}</th>}</tr></thead>
    <tbody>{clips.map((clip,index)=>{
     const shotLabel=`镜头 ${String(index+1).padStart(2,"0")}`;
     const preparation=workspaceShotPreparation(workspace,clip.shotId,project);
     const generation=workspaceStoryboardProgress(workspace,clip.shotId);
     const shotWindow=project&&readWorkspaceShotWindow(project,clip.itemId);
     const duration=shotWindow?shotWindow.durationInFrames/shotWindow.timeline.fps:clip.image?.durationSeconds;
     const currentSource=workspaceShotSource(clip,project),source=materials.find(m=>m.storage_path===currentSource?.relativePath);
     const sourceName=source?.source_path.split('/').pop()??currentSource?.relativePath.split('/').pop();
     return <tr key={clip.shotId} aria-label={shotLabel} aria-selected={selectedShotId===clip.shotId} aria-describedby={readOnly||disabled?undefined:helpId} tabIndex={0} draggable={!locked}
      data-drop={drop?.shotId===clip.shotId?(drop.after?'after':'before'):undefined}
      onClick={()=>{if(!selectionDisabled)onSelect(clip.shotId);}}
      onKeyDown={event=>{if(event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();if(event.key==='ArrowUp'&&index>0)void move(clip.shotId,clips[index-1].shotId);else if(event.key==='ArrowDown'&&index<clips.length-1)void move(clip.shotId,clips[index+2]?.shotId??null);}else if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();if(!selectionDisabled)onSelect(clip.shotId);}}}
      onDragStart={event=>{if(locked){event.preventDefault();return;}dragged.current=clip.shotId;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',clip.shotId);}}
      onDragOver={event=>dragOver(event,clip.shotId)}
      onDrop={event=>{event.preventDefault();const id=dragged.current;dragged.current=null;setDrop(null);if(locked||!id||id===clip.shotId)return;const rect=event.currentTarget.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2,remaining=clips.filter(c=>c.shotId!==id),target=remaining.findIndex(c=>c.shotId===clip.shotId);void move(id,after?remaining[target+1]?.shotId??null:clip.shotId);}}
      onDragEnd={()=>{dragged.current=null;setDrop(null);}}>
      <td><div className={batch?'storyboard-batch-shot-cell':undefined}>{batch&&<label onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onDragStart={event=>{event.preventDefault();event.stopPropagation();}}><input type="checkbox" aria-label={uiText("勾选{value0}",{value0:shotLabel})} checked={batch.selected.has(clip.shotId)} disabled={locked||batch.disabled||!batch.eligible.has(clip.shotId)} onChange={()=>batch.onToggle(clip.shotId)}/></label>}<button type="button" disabled={selectionDisabled} draggable={!locked} title={clip.shotId} aria-label={uiText("选择{value0}",{value0:String(shotLabel)})} aria-pressed={selectedShotId===clip.shotId} onClick={()=>{if(!selectionDisabled)onSelect(clip.shotId);}}>{String(index+1).padStart(2,"0")}</button></div></td>
      <td><div className="workspace-shot-text"><span>{clip.text}</span><small title={sourceName}>{sourceName?.replace(/^(?:(?:wan-)?added-[0-9a-f-]{36}-|[0-9a-f]{64}-)/i,'')||sourceName}</small></div>
       {(['speech','video'] as const).map(kind=>{
        const state=generation[kind];
        if(!state)return null;
        const labels={kind:uiText(kind==='speech'?'口播':'视频'),status:uiText(state.status)};
        const text=uiText('{kind}：{status}',labels);
        return <div className="storyboard-shot-generation" key={kind}>
         <button type="button" disabled={selectionDisabled} aria-label={uiText('{shot}{kind}：{status}',{...labels,shot:uiText('镜头 {number}',{number:String(index+1).padStart(2,'0')})})} onClick={event=>{event.stopPropagation();if(onGenerationNavigate)onGenerationNavigate(clip.shotId,kind,state.targetItemId);else onSelect(clip.shotId);}}>{text}</button>
         {'error' in state&&state.error&&<small>{uiText(state.error)}</small>}
        </div>;
       })}
      </td>
      <td>{Number.isFinite(duration)?`${duration!.toFixed(1)} s`:'—'}</td>
      <td><WorkspaceShotPreparationStatus preparation={preparation} shotLabel={shotLabel} onNavigate={onPreparationNavigate?target=>{if(!selectionDisabled)onPreparationNavigate(clip.shotId,target);}:undefined}/></td>
      {!readOnly&&<td className="workspace-shot-table-actions-cell" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onDragStart={event=>{event.preventDefault();event.stopPropagation();}}>
       <Button type="button" size="sm" color="tertiary" className="workspace-shot-menu-trigger" aria-label={uiText("删除{value0}",{value0:String(shotLabel)})} title={clips.length<=1?uiText("至少保留一个镜头"):uiText("删除镜头")} isDisabled={disabled||clips.length<=1} iconLeading={Trash2} onPress={()=>onDelete(clip)}/>
      </td>}
     </tr>;
    })}</tbody>
    {!readOnly&&<tfoot><tr><td colSpan={5} className="workspace-shot-insert-cell"><Button ref={addButton} size="sm" color="tertiary" className="workspace-shot-add" aria-label={uiText("新增镜头")} title={uiText("新增镜头")} isDisabled={disabled||adding} onPress={()=>{setAdding(true);requestAnimationFrame(()=>input.current?.focus());}}><Plus size={18} aria-hidden="true"/></Button>
     {adding&&<form className="workspace-shot-insert-form" onSubmit={event=>{event.preventDefault();void insert();}}><label htmlFor={inputId}>{uiText("新镜头文案")}</label><textarea id={inputId} ref={input} value={text} required maxLength={100000} rows={2} disabled={disabled} onChange={event=>setText(event.target.value)}/><div><Button size="sm" color="secondary" isDisabled={disabled} onPress={cancelAdd}>{uiText("取消")}</Button><Button size="sm" color="primary" type="submit" isDisabled={disabled||!text.trim()}>{uiText("新增镜头")}</Button></div></form>}
    </td></tr></tfoot>}
   </table>
  </div>
  <span className="sr-only" role="status">{announcement}</span>
 </>;
}
