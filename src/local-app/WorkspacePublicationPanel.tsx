import {requestConnectionSetup} from './connectionSetup';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Copy,Pencil,ChevronRight} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {normalizeDeliveryTags} from '../publishing/deliveryMetadata';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {PublicationCoverPicker} from './PublicationCoverPicker';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {usePublicationAssistant} from './usePublicationAssistant';
import {useWorkspacePublication} from './useWorkspacePublication';
import './workspace-publication.css';

export function WorkspacePublicationPanel({workspace:w,readOnly=false,children}:{workspace:ProductionWorkspace;readOnly?:boolean;children?:(publication:ReturnType<typeof useWorkspacePublication>,editing:boolean)=>ReactNode}){
 const [editing,setEditing]=useState(false),[toolsOpen,setToolsOpen]=useState(false);
 const p=useWorkspacePublication(w.episodeId,w.id,{autoSave:!editing}),id=useId(),ai=usePublicationAssistant(w.episodeId,p,readOnly);
 const [tags,setTags]=useState(''),[copied,setCopied]=useState(''),[copySequence,setCopySequence]=useState(0);
 const titleInput=useRef<HTMLInputElement>(null),editTrigger=useRef<HTMLButtonElement>(null),wasEditing=useRef(false);
 const hasContent=!!(p.content.title||p.content.description||p.content.tags.length);
 useEffect(()=>{if(p.state&&p.dirty&&!readOnly)setEditing(true);},[p.state?.workspaceId]);
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
  <PublicationCoverPicker workspace={w} publication={p} readOnly={readOnly||editing}/>
  {!readOnly&&p.state&&<details className="workspace-publication-ai-disclosure" hidden={editing&&!ai.busy&&!ai.unresolved&&!ai.error} open={toolsOpen||!hasContent||ai.busy||ai.unresolved||!!ai.error} onToggle={event=>{if(!ai.busy&&!ai.unresolved&&!ai.error)setToolsOpen(event.currentTarget.open);}}><summary><ChevronRight size={13} aria-hidden="true"/>{uiText(hasContent?'重新生成文案':'AI 生成文案')}</summary><div className="workspace-publication-ai">
   <Button size="sm" color="secondary" isDisabled={!p.state||ai.busy||ai.unresolved||editing} onPress={()=>void ai.generate()}>{uiText(ai.busy?'正在生成文案…':hasContent?'重新生成发布文案':'AI 生成发布文案')}</Button>
   <small>{ai.choice?.label??uiText('选择大语言模型')} <button type="button" onClick={()=>ai.setChoosing(!ai.choosing)}>{uiText('更换')}</button></small>
   {ai.choosing&&<label htmlFor={`${id}-model`}>{uiText('大语言模型')}<select id={`${id}-model`} value={ai.choice?.id??''} onChange={e=>ai.choose(e.target.value)}><option value="">{uiText('请选择')}</option>{ai.options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select><button type="button" onClick={()=>void ai.refresh()}>{uiText('重新读取模型')}</button><button type="button" disabled={ai.busy} onClick={()=>requestConnectionSetup({capability:'language_model',onUse:ai.useConfiguredConnection})}>{uiText('配置制作服务')}</button></label>}
   <details><summary>{uiText('补充要求（可选）')}</summary><label htmlFor={`${id}-instruction`}>{uiText('补充要求')}</label><textarea id={`${id}-instruction`} name="instruction" rows={2} value={p.content.instruction} maxLength={4000} disabled={!p.state||editing} onChange={e=>p.edit({...p.content,instruction:e.target.value})}/></details>
   {ai.unresolved&&<div role="status"><p>{uiText(ai.latest?.message??'文案请求未完成，请先核对。')}</p><Button size="sm" color="secondary" onPress={()=>void ai.recover()}>{uiText('核对原请求')}</Button>{ai.latest?.status==='unknown'&&<details><summary>{uiText('已在供应商侧核对？')}</summary><Button size="sm" color="secondary" isDisabled={editing} onPress={()=>void ai.closeUnknown()}>{uiText('结束本次未知请求')}</Button></details>}</div>}
   {ai.error&&<p role="alert">{uiText(ai.error)}</p>}
  </div></details>}
  {!readOnly&&p.state?.previousText&&<Button size="sm" color="tertiary" isDisabled={ai.busy||ai.unresolved||editing} onPress={()=>void ai.undo()}>{uiText('撤回本次替换')}</Button>}
  {p.error&&<div role="alert" className="form-error"><p>{uiText(p.error)}</p>{p.state&&<Button size="sm" color="secondary" onPress={()=>void save(true)}>{uiText('重试保存')}</Button>}<Button size="sm" color="tertiary" onPress={()=>void p.reload()}>{uiText('重新读取发布资料')}</Button></div>}
  {p.storageError&&<p role="alert">{uiText('本机草稿暂无法保存，请保持此页面打开。')}</p>}
  {copied.startsWith('复制失败')?<p role="alert">{uiText(copied)}</p>:<FeedbackNotice message={copied} identity={copySequence} onDismiss={()=>setCopied('')}/>}
 </section></>;
}
