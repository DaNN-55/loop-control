import {useEffect,useId,useState} from 'react';
import {Copy} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {normalizeDeliveryTags} from '../publishing/deliveryMetadata';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {ImagePreview} from '../ui/media/ImagePreview';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {useWorkspacePublication} from './useWorkspacePublication';
import './workspace-publication.css';

export function WorkspacePublicationPanel({workspace:w,readOnly=false}:{workspace:ProductionWorkspace;readOnly?:boolean}){
 const p=useWorkspacePublication(w.episodeId,w.id),id=useId();
 const [editing,setEditing]=useState(false),[tags,setTags]=useState(''),[copied,setCopied]=useState(''),[copySequence,setCopySequence]=useState(0);
 const hasContent=!!(p.content.title||p.content.description||p.content.tags.length);
 useEffect(()=>{
  if(JSON.stringify(normalizeDeliveryTags(tags.split(/[,，]/)))!==JSON.stringify(p.content.tags))setTags(p.content.tags.join(', '));
 },[JSON.stringify(p.content.tags)]);
 async function copy(text:string,label:string){
  setCopySequence(value=>value+1);
  try{await navigator.clipboard.writeText(text);setCopied(`已复制${label}`);}
  catch{setCopied('复制失败，请选择文案后手动复制。');}
 }
 const cover=p.state?.cover,coverUrl=cover?'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:cover.file.relativePath,sha256:cover.file.sha256}):'';
 return <section className="workspace-publication" aria-label={uiText('发布资料（可选）')}>
  <header className="workspace-review-heading"><h4>{uiText('发布资料（可选）')}</h4>{p.saving&&<span role="status">{uiText('保存中…')}</span>}</header>
  {p.state&&p.state.basisContentSha256!==w.contentSha256&&<p role="status">{uiText('视频已更新，请核对发布资料。')}</p>}
  {!editing&&!hasContent&&<Button size="sm" color="secondary" isDisabled={!p.state||readOnly} onPress={()=>setEditing(true)}>{uiText('自己填写')}</Button>}
  {(editing||hasContent)&&<form className="workspace-publication-fields" aria-label={uiText('发布文案')} method="post" action={`/api/local/episodes/${w.episodeId}/publication`} onSubmit={event=>{event.preventDefault();void p.flush().catch(()=>{});}}>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-title`}>{uiText('标题')}</label><Button type="button" size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制标题')} onPress={()=>void copy(p.content.title,'标题')}/></div><input id={`${id}-title`} name="title" value={p.content.title} maxLength={200} disabled={readOnly} onChange={event=>p.edit({...p.content,title:event.target.value})}/></div>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-description`}>{uiText('简介')}</label><Button type="button" size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制简介')} onPress={()=>void copy(p.content.description,'简介')}/></div><textarea id={`${id}-description`} name="description" value={p.content.description} rows={3} maxLength={5000} disabled={readOnly} onChange={event=>p.edit({...p.content,description:event.target.value})}/></div>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-tags`}>{uiText('标签')}</label><Button type="button" size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制标签')} onPress={()=>void copy(normalizeDeliveryTags(p.content.tags).map(tag=>`#${tag}`).join(' '),'标签')}/></div><input id={`${id}-tags`} name="tags" value={tags} placeholder={uiText('用逗号分隔')} disabled={readOnly} onChange={event=>{setTags(event.target.value);p.edit({...p.content,tags:event.target.value.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean)});}}/></div>
  </form>}
  {cover&&<div className="workspace-publication-cover"><ImagePreview src={coverUrl} alt={uiText('交付封面')}/></div>}
  {p.error&&<div role="alert" className="form-error"><p>{uiText(p.error)}</p>{p.state&&<Button size="sm" color="secondary" onPress={()=>void p.retry().catch(()=>{})}>{uiText('重试保存')}</Button>}<Button size="sm" color="tertiary" onPress={()=>void p.reload()}>{uiText('重新读取发布资料')}</Button></div>}
  {p.storageError&&<p role="alert">{uiText('本机草稿暂无法保存，请保持此页面打开。')}</p>}
  {copied.startsWith('复制失败')?<p role="alert">{uiText(copied)}</p>:<FeedbackNotice message={copied} identity={copySequence} onDismiss={()=>setCopied('')}/>}
 </section>;
}
