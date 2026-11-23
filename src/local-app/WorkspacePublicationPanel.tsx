import {requestConnectionSetup} from './connectionSetup';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Copy,Pencil,ChevronRight,RefreshCw} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {normalizeDeliveryTags} from '../publishing/deliveryMetadata';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {WorkspaceModelPicker} from './WorkspaceModelPicker';
import {PublicationCoverPicker} from './PublicationCoverPicker';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {usePublicationAssistant} from './usePublicationAssistant';
import {useWorkspacePublication} from './useWorkspacePublication';
import './workspace-publication.css';

export function WorkspacePublicationPanel({workspace:w,readOnly:publicationReadOnly=false,completedView=false,children}:{workspace:ProductionWorkspace;readOnly?:boolean;completedView?:boolean;children?:(publication:ReturnType<typeof useWorkspacePublication>,editing:boolean)=>ReactNode}){
 const readOnly=publicationReadOnly||completedView;
 const [editOpen,setEditing]=useState(false),[toolsOpen,setToolsOpen]=useState(false);
 const editing=editOpen&&!readOnly;
 const p=useWorkspacePublication(w.episodeId,w.id,{autoSave:!editing&&!completedView,restoreDraft:!completedView}),id=useId(),ai=usePublicationAssistant(w.episodeId,p,readOnly);
 const [tags,setTags]=useState(''),[copied,setCopied]=useState(''),[copySequence,setCopySequence]=useState(0);
 const titleInput=useRef<HTMLInputElement>(null),editTrigger=useRef<HTMLButtonElement>(null),wasEditing=useRef(false);
 const hasContent=!!(p.content.title||p.content.description||p.content.tags.length);
 useEffect(()=>{if(p.state&&p.dirty&&!readOnly)setEditing(true);},[p.state?.workspaceId,readOnly]);
 useEffect(()=>{
  if(editing)titleInput.current?.focus();else if(wasEditing.current)editTrigger.current?.focus();
  wasEditing.current=editing;
 },[editing]);
 useEffect(()=>{
  if(JSON.stringify(normalizeDeliveryTags(tags.split(/[,，]/)))!==JSON.stringify(p.content.tags))setTags(p.content.tags.join(', '));
 },[JSON.stringify(p.content.tags)]);
 async function copy(text:string,label:string){
  setCopySequence(value=>value+1);
  try{await navigator.clipboard.writeText(text);setCopied(`已复制${label}`);}
  catch{setCopied('复制失败，请选择文案后手动复制。');}
 }
 async function save(retry=false){
  try{await(retry?p.retry():p.flush());setEditing(false);setToolsOpen(false);}catch{/* Existing revision/error and local draft recovery remain visible. */}
 }
 function cancel(){if(p.discard()){setTags(p.state!.content.tags.join(', '));setEditing(false);}}
 const normalizedTags=normalizeDeliveryTags(p.content.tags),tagText=normalizedTags.map(tag=>`#${tag}`).join(' ');
 const copyAll=()=>void copy([p.content.title,p.content.description,tagText].filter(Boolean).join('\n\n'),'全部发布资料');
 const requestFeedback=<>
   {ai.unresolved&&<div role="status"><p>{uiText(ai.latest?.message??'文案请求未完成，请先核对。')}</p><Button size="sm" color="secondary" onPress={()=>void ai.recover()}>{uiText('核对原请求')}</Button>{ai.latest?.status==='unknown'&&<details><summary>{uiText('已在供应商侧核对？')}</summary><Button size="sm" color="secondary" isDisabled={editing} onPress={()=>void ai.closeUnknown()}>{uiText('结束本次未知请求')}</Button></details>}</div>}
   {ai.error&&<p role="alert">{uiText(ai.error)}</p>}
 </>;
 return <>{children?.(p,editing)}<section className="workspace-publication" aria-label={uiText('发布资料（可选）')}>
  <header className="workspace-review-heading workspace-publication-heading"><h4>{uiText('发布资料')}</h4><div className="workspace-publication-actions">
   {p.saving&&<span role="status">{uiText('保存中…')}</span>}
   {!editing&&hasContent&&<Button size="xs" color="tertiary" iconLeading={Copy} onPress={copyAll}>{uiText('复制全部')}</Button>}
   {!editing&&hasContent&&!readOnly&&<Button ref={editTrigger} size="xs" color="secondary" iconLeading={Pencil} isDisabled={!p.state||p.saving} onPress={()=>setEditing(true)}>{uiText('编辑文案')}</Button>}
  </div></header>
  {p.state&&(hasContent||p.state.cover||p.content.instruction)&&p.state.basisContentSha256!==w.contentSha256&&<p role="status">{uiText('视频已更新，请核对发布资料。')}</p>}
  {!editing&&hasContent&&<div className="workspace-publication-reading" role="group" aria-label={uiText('发布文案')}>
   {([{key:'title',label:'标题',value:p.content.title},{key:'description',label:'简介',value:p.content.description},{key:'tags',label:'标签',value:tagText}] as const).map(field=><section className="workspace-publication-read-field" key={field.key}>
    <header><span id={`${id}-${field.key}-label`}>{uiText(field.label)}</span><Button size="xs" color="tertiary" iconLeading={Copy} aria-label={uiText(`复制${field.label}`)} onPress={()=>void copy(field.value,field.label)}/></header>
    {field.key==='tags'?<div className="workspace-publication-tags" aria-labelledby={`${id}-${field.key}-label`}>{normalizedTags.length?normalizedTags.map(tag=><span key={tag}>#{tag}</span>):<span className="workspace-publication-empty">{uiText('未填写')}</span>}</div>:<p className={field.key==='title'?'workspace-publication-title':'workspace-publication-description'} aria-labelledby={`${id}-${field.key}-label`}>{field.value||uiText('未填写')}</p>}
   </section>)}
  </div>}
  {!editing&&!hasContent&&<p className="workspace-publication-empty">{uiText('可选填发布文案，不影响下载成片。')}</p>}
  {!editing&&!hasContent&&!readOnly&&<Button ref={editTrigger} size="sm" color="secondary" isDisabled={!p.state} onPress={()=>setEditing(true)}>{uiText('自己填写')}</Button>}
  {editing&&<form className="workspace-publication-fields" aria-label={uiText('发布文案')} method="post" action={`/api/local/episodes/${w.episodeId}/publication`} onSubmit={event=>{event.preventDefault();void save();}}>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-title`}>{uiText('标题')}</label><Button type="button" size="xs" color="tertiary" iconLeading={Copy} aria-label={uiText('复制标题')} onPress={()=>void copy(p.content.title,'标题')}/></div><input ref={titleInput} id={`${id}-title`} name="title" value={p.content.title} maxLength={200} disabled={readOnly||p.saving} onChange={event=>p.edit({...p.content,title:event.target.value})}/></div>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-description`}>{uiText('简介')}</label><Button type="button" size="xs" color="tertiary" iconLeading={Copy} aria-label={uiText('复制简介')} onPress={()=>void copy(p.content.description,'简介')}/></div><textarea id={`${id}-description`} name="description" value={p.content.description} rows={3} maxLength={5000} disabled={readOnly||p.saving} onChange={event=>p.edit({...p.content,description:event.target.value})}/></div>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-tags`}>{uiText('标签')}</label><Button type="button" size="xs" color="tertiary" iconLeading={Copy} aria-label={uiText('复制标签')} onPress={()=>void copy(tagText,'标签')}/></div><input id={`${id}-tags`} name="tags" value={tags} placeholder={uiText('用逗号分隔')} disabled={readOnly||p.saving} onChange={event=>{setTags(event.target.value);p.edit({...p.content,tags:event.target.value.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean)});}}/></div>
   <footer><Button size="sm" color="secondary" isDisabled={p.saving} onPress={cancel}>{uiText('取消')}</Button><Button type="submit" size="sm" color="primary" isDisabled={!p.state||readOnly||p.saving}>{uiText(p.saving?'保存中…':'保存文案')}</Button></footer>
  </form>}
  {!completedView&&<PublicationCoverPicker workspace={w} publication={p} readOnly={readOnly||editing}/>}
  {!readOnly&&p.state&&<details className="workspace-publication-ai-disclosure" hidden={editing&&!ai.busy&&!ai.unresolved&&!ai.error} open={toolsOpen||!hasContent||ai.busy||ai.unresolved||!!ai.error} onToggle={event=>{if(!ai.busy&&!ai.unresolved&&!ai.error)setToolsOpen(event.currentTarget.open);}}><summary><ChevronRight size={13} aria-hidden="true"/>{uiText(hasContent?'重新生成文案':'AI 生成文案')}</summary><div className="workspace-publication-ai">
   <div className="workspace-publication-model-field"><span>{uiText('文案模型')}</span><WorkspaceModelPicker label="选择文案模型" title="选择大语言模型" compact={false} isOpen={ai.choosing} onOpenChange={ai.setChoosing} options={ai.options.map(option=>({id:option.id,label:option.selection.model,provider:option.selection.provider,connection:option.connection}))} value={ai.choice?.id??''} disabled={ai.busy||editing} refreshing={ai.modelsLoading} onChange={ai.choose} onRefresh={()=>void ai.refresh()} onConfigure={()=>requestConnectionSetup({capability:'language_model',onUse:ai.useConfiguredConnection})} empty="暂无可用模型，请配置并验证大语言模型服务。"/></div>
   <label className="workspace-publication-instruction" htmlFor={`${id}-instruction`}>{uiText('补充要求（可选）')}<textarea id={`${id}-instruction`} name="instruction" rows={2} value={p.content.instruction} maxLength={4000} placeholder={uiText('例如：语气自然，标题控制在 20 字以内')} disabled={!p.state||editing||ai.busy} onChange={e=>p.edit({...p.content,instruction:e.target.value})}/></label>
   <div className="workspace-publication-generation-footer"><Button size="sm" color="primary" iconLeading={RefreshCw} aria-label={uiText(hasContent?'重新生成发布文案':'AI 生成发布文案')} isDisabled={!p.state||ai.busy||ai.unresolved||editing} onPress={()=>void ai.generate()}>{uiText(ai.busy?'正在生成文案…':'生成文案')}</Button></div>
   {requestFeedback}
  </div></details>}
  {!readOnly&&p.state?.previousText&&<Button size="sm" color="tertiary" isDisabled={ai.busy||ai.unresolved||editing} onPress={()=>void ai.undo()}>{uiText('撤回本次替换')}</Button>}
  {p.error&&<div role="alert" className="form-error"><p>{uiText(p.error)}</p>{!readOnly&&p.state&&<Button size="sm" color="secondary" onPress={()=>void save(true)}>{uiText('重试保存')}</Button>}<Button size="sm" color="tertiary" onPress={()=>void p.reload()}>{uiText('重新读取发布资料')}</Button></div>}
  {p.storageError&&<p role="alert">{uiText('本机草稿暂无法保存，请保持此页面打开。')}</p>}
  {copied.startsWith('复制失败')?<p role="alert">{uiText(copied)}</p>:<FeedbackNotice message={copied} identity={copySequence} onDismiss={()=>setCopied('')}/>}
 </section></>;
}
