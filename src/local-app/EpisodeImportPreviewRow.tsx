import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ChevronRight} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';

export type EpisodeImportEditSession={active:string|null;onChange:(id:string|null)=>void};

type Props<Draft>={
 id:string;
 name:string;
 editLabel?:string;
 leading?:string;
 trailing?:string;
 tag?:ReactNode;
 summary?:ReactNode;
 preview:ReactNode;
 initial:Draft;
 fields:(draft:Draft,setDraft:(value:Draft)=>void)=>ReactNode;
 onSave:(draft:Draft)=>void;
 editSession:EpisodeImportEditSession;
 busy:boolean;
 allowEdit?:boolean;
 initiallyExpanded?:boolean;
 reveal?:boolean;
 editingChild?:boolean;
 sheet?:'orders'|'shots';
 row?:number;
 children?:()=>ReactNode;
};

export function EpisodeImportPreviewRow<Draft>({
 id,name,editLabel=name,leading,trailing,tag,summary,preview,initial,fields,onSave,editSession,busy,allowEdit=true,
 initiallyExpanded=false,reveal,editingChild,sheet,row,children,
}:Props<Draft>){
 const contentId=useId();
 const [expanded,setExpanded]=useState(initiallyExpanded),[draft,setDraft]=useState(initial);
 const editing=editSession.active===id;
 const editor=useRef<HTMLDivElement>(null),editButton=useRef<HTMLButtonElement>(null),wasEditing=useRef(false);

 useEffect(()=>{if(reveal)setExpanded(true);},[reveal]);
 useEffect(()=>{
  if(editing)editor.current?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus();
  else if(wasEditing.current)editButton.current?.focus();
  wasEditing.current=editing;
 },[editing]);

 return <article className="episode-import-row" data-sheet={sheet} data-row={row}>
  <button type="button" className="episode-import-disclosure" aria-expanded={expanded} aria-controls={contentId}
   disabled={editing||editingChild} onClick={()=>setExpanded(!expanded)}>
   <ChevronRight size={15} aria-hidden="true"/>
   <span className="episode-import-heading">
    {leading&&<span className="episode-import-meta">{leading}</span>}
    <span className="episode-import-title"><strong>{name}</strong>{tag}</span>
    {trailing&&<span className="episode-import-meta episode-import-duration">{trailing}</span>}
   </span>
  </button>
  {!editing&&allowEdit&&<Button ref={editButton} type="button" size="sm" color="tertiary" className="episode-import-edit"
   aria-label={uiText('编辑 {value0}',{value0:editLabel})} isDisabled={busy||editSession.active!==null}
   onPress={()=>{setDraft(initial);setExpanded(true);editSession.onChange(id);}}>{uiText('编辑')}</Button>}
  {summary&&<div className="episode-import-summary episode-import-meta">{summary}</div>}
  <div id={contentId} hidden={!expanded} className="episode-import-row-body">
   {expanded&&<>
    {editing?<div ref={editor} className="episode-import-editor">
     {fields(draft,setDraft)}
     <div className="episode-import-editor-actions">
      <Button type="button" size="sm" color="tertiary" onPress={()=>editSession.onChange(null)}>{uiText('取消')}</Button>
      <Button type="button" size="sm" color="secondary" onPress={()=>{onSave(draft);editSession.onChange(null);}}>{uiText('保存')}</Button>
     </div>
    </div>:preview}
    {children?.()}
   </>}
  </div>
 </article>;
}
