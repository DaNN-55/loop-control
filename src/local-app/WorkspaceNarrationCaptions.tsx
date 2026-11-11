import {uiText} from '../i18n/ui';
import {useEffect,useId,useState} from 'react';
import {Link} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Badge} from '../ui/dan-ui/components/base/badges/badges';
import type {ShotCaptionContract} from '../shotCaptions';
export function WorkspaceNarrationCaptions({storageKey,contract,followText,disabled,onSave}:{storageKey:string;contract?:ShotCaptionContract;followText:string;disabled:boolean;onSave:(mode:'follow_tts'|'independent',text?:string)=>Promise<void>}){
 const heading=useId(),hint=useId(),[draft,setDraft]=useState<string|null>(()=>{try{return sessionStorage.getItem(storageKey);}catch{return null;}}),[notice,setNotice]=useState('');
 const following=contract?.contentMode!=='independent',saved=following?followText:contract?.text??followText,text=draft??saved,dirty=draft!==null&&draft!==saved;
 useEffect(()=>{try{if(draft===null)sessionStorage.removeItem(storageKey);else sessionStorage.setItem(storageKey,draft);}catch{/* Browser drafts are optional. */}},[storageKey,draft]);
 async function save(mode:'follow_tts'|'independent'){setNotice('');try{await onSave(mode,mode==='independent'?text:undefined);setDraft(null);setNotice(mode==='follow_tts'?'字幕已跟随口播。':'字幕已保存。');}catch{/* Parent keeps the error and this draft visible. */}}
 return <section className="workspace-narration-caption-editor" aria-labelledby={heading}>
  <div className="workspace-generation-composer workspace-caption-composer">
   <div className="workspace-narration-editor workspace-narration-input">
   <header className="workspace-caption-editor-heading"><h3 id={heading}>{uiText("字幕内容")}</h3><Badge type="color" color="gray" size="sm">{dirty?uiText("未保存"):following?uiText("跟随口播"):uiText("已单独编辑")}</Badge></header>
   <textarea aria-label={uiText("字幕内容")} aria-describedby={hint} rows={5} maxLength={100000} disabled={disabled} value={text} onChange={event=>{setDraft(event.target.value);setNotice('');}}/>
   </div>
   <div className="workspace-narration-controls workspace-narration-actions">
    <span id={hint} className="workspace-caption-feedback">{uiText("直接修改正文，保存后单独使用")}</span>
    {(!following||dirty)&&<Button size="xs" color="tertiary" iconLeading={Link} isDisabled={disabled} onPress={()=>void save('follow_tts')}>{uiText("跟随口播")}</Button>}
    <Button size="sm" color="primary" isDisabled={disabled||!dirty||!text.trim()} onPress={()=>void save('independent')}>{uiText("保存字幕")}</Button>
   </div>
  </div>
  {!following&&<p className="workspace-caption-reference" title={followText}>{uiText("口播原文 ")}<span>{followText}</span></p>}
  {notice&&<p className="workspace-caption-feedback" role="status">{notice}</p>}
 </section>;
}
