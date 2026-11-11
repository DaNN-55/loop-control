import {uiText} from '../i18n/ui';
import {useId,useRef,useState,type DragEvent} from 'react';
import {MoreHorizontal,Plus,Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Dropdown} from '../ui/dan-ui/components/base/dropdown/dropdown';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceShotWindow,type WorkspaceShotOperation} from '../workspaceShots';
import {workspaceShotSource} from './WorkspaceShotPreview';

interface Props {
 workspace:ProductionWorkspace;project:OpenChatCutProject|null;materials:Array<{storage_path:string;source_path:string}>;
 selectedShotId:string|undefined;disabled:boolean;readOnly?:boolean;
 onSelect:(shotId:string)=>void;onDelete:(clip:WorkspaceClip)=>void;onEdit:(operation:WorkspaceShotOperation)=>Promise<void>;
}

export function WorkspaceShotTable({workspace,project,materials,selectedShotId,disabled,readOnly=false,onSelect,onDelete,onEdit}:Props){
 const locked=disabled||readOnly;
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
 return <>
  <div className="workspace-table-caption"><h3>{uiText("镜头 ")}{!readOnly&&!disabled&&<span id={helpId} >{uiText("拖动行调整顺序，或按 Alt + ↑/↓")}</span>}</h3></div>
  <div className="workspace-shot-table-scroll">
   <table className="workspace-shot-table" aria-label={uiText("镜头")}><thead><tr><th scope="col">{uiText("镜头")}</th><th scope="col">{uiText("脚本与素材")}</th><th scope="col">{uiText("时长")}</th><th scope="col">{uiText("画面")}</th><th scope="col">{uiText("口播")}</th>{!readOnly&&<th scope="col">{uiText("操作")}</th>}</tr></thead>
    <tbody>{clips.map((clip,index)=>{
     const shotLabel=`镜头 ${String(index+1).padStart(2,"0")}`;
     const narration=workspace.narration?.find(n=>n.shotId===clip.shotId);
     const shotWindow=project&&readWorkspaceShotWindow(project,clip.itemId);
     const duration=shotWindow?shotWindow.durationInFrames/shotWindow.timeline.fps:clip.image?.durationSeconds;
     const slots=workspace.clips.filter(binding=>binding.shotId===clip.shotId);
     const matched=slots.filter(binding=>workspaceShotSource(binding,project)).length;
     const currentSource=workspaceShotSource(clip,project),source=materials.find(m=>m.storage_path===currentSource?.relativePath);
     const sourceName=source?.source_path.split('/').pop()??currentSource?.relativePath.split('/').pop();
     return <tr key={clip.shotId} aria-label={shotLabel} aria-selected={selectedShotId===clip.shotId} aria-describedby={readOnly||disabled?undefined:helpId} tabIndex={0} draggable={!locked}
      data-drop={drop?.shotId===clip.shotId?(drop.after?'after':'before'):undefined}
      onClick={()=>onSelect(clip.shotId)}
      onKeyDown={event=>{if(event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();if(event.key==='ArrowUp'&&index>0)void move(clip.shotId,clips[index-1].shotId);else if(event.key==='ArrowDown'&&index<clips.length-1)void move(clip.shotId,clips[index+2]?.shotId??null);}else if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelect(clip.shotId);}}}
      onDragStart={event=>{if(locked){event.preventDefault();return;}dragged.current=clip.shotId;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',clip.shotId);}}
      onDragOver={event=>dragOver(event,clip.shotId)}
      onDrop={event=>{event.preventDefault();const id=dragged.current;dragged.current=null;setDrop(null);if(locked||!id||id===clip.shotId)return;const rect=event.currentTarget.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2,remaining=clips.filter(c=>c.shotId!==id),target=remaining.findIndex(c=>c.shotId===clip.shotId);void move(id,after?remaining[target+1]?.shotId??null:clip.shotId);}}
      onDragEnd={()=>{dragged.current=null;setDrop(null);}}>
      <td><button type="button" draggable={!locked} title={clip.shotId} aria-label={uiText("选择{value0}",{value0:String(shotLabel)})} aria-pressed={selectedShotId===clip.shotId} onClick={()=>onSelect(clip.shotId)}>{shotLabel}</button></td>
      <td><div className="workspace-shot-text"><span>{clip.text}</span><small title={sourceName}>{sourceName?.replace(/^(?:(?:wan-)?added-[0-9a-f-]{36}-|[0-9a-f]{64}-)/i,'')||sourceName||uiText("保留占位")}</small></div></td>
      <td>{Number.isFinite(duration)?`${duration!.toFixed(1)} s`:'—'}</td>
      <td><span className={matched===slots.length?'is-ready':'is-pending'}>{slots.length>1?uiText("{value0} / {value1} 画面",{value0:String(matched),value1:String(slots.length)}):currentSource?uiText("已匹配"):clip.image?.taskId?uiText("待填入"):uiText("待匹配")}</span></td>
      <td><span data-narration-tone={!narration||narration.mode==='none'?'neutral':narration.adoptedAudioTrackId?'success':['ready','running'].includes(narration.status)?'busy':narration.status==='failed'?'error':'pending'} className={narration?.adoptedAudioTrackId?'is-ready':'is-pending'}>{!narration||narration.mode==='none'?uiText("关闭"):narration.adoptedAudioTrackId?uiText("已采用"):['ready','running'].includes(narration.status)?uiText("准备中"):narration.status==='failed'?uiText("失败"):uiText("待准备")}</span></td>
      {!readOnly&&<td className="workspace-shot-table-actions-cell" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onDragStart={event=>{event.preventDefault();event.stopPropagation();}}>
       <Dropdown.Root><Button size="sm" color="tertiary" className="workspace-shot-menu-trigger" aria-label={uiText("{value0}操作",{value0:String(shotLabel)})} isDisabled={disabled} iconLeading={MoreHorizontal}/><Dropdown.Popover className="dan-ui product-ui workspace-shot-menu" placement="bottom end" offset={4}><Dropdown.Menu aria-label={uiText("{value0}操作",{value0:String(shotLabel)})}><Dropdown.Item id="delete" icon={Trash2} className="menu-item-danger" isDisabled={clips.length<=1} onAction={()=>onDelete(clip)}>{uiText("删除镜头")}</Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown.Root>
      </td>}
     </tr>;
    })}</tbody>
    {!readOnly&&<tfoot><tr><td colSpan={6} className="workspace-shot-insert-cell"><Button ref={addButton} size="sm" color="tertiary" className="workspace-shot-add" aria-label={uiText("新增镜头")} title={uiText("新增镜头")} isDisabled={disabled||adding} onPress={()=>{setAdding(true);requestAnimationFrame(()=>input.current?.focus());}}><Plus size={18} aria-hidden="true"/></Button>
     {adding&&<form className="workspace-shot-insert-form" onSubmit={event=>{event.preventDefault();void insert();}}><label htmlFor={inputId}>{uiText("新镜头文案")}</label><textarea id={inputId} ref={input} value={text} required maxLength={100000} rows={2} disabled={disabled} onChange={event=>setText(event.target.value)}/><div><Button size="sm" color="secondary" isDisabled={disabled} onPress={cancelAdd}>{uiText("取消")}</Button><Button size="sm" color="primary" type="submit" isDisabled={disabled||!text.trim()}>{uiText("新增镜头")}</Button></div></form>}
    </td></tr></tfoot>}
   </table>
  </div>
  <span className="sr-only" role="status">{announcement}</span>
 </>;
}
