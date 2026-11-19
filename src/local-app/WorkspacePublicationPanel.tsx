import {useEffect,useId,useState,type ReactNode} from 'react';
import {Copy} from 'lucide-react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {normalizeDeliveryTags} from '../publishing/deliveryMetadata';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {PublicationCoverPicker} from './PublicationCoverPicker';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {usePublicationAssistant} from './usePublicationAssistant';
import {useWorkspacePublication} from './useWorkspacePublication';
import './workspace-publication.css';

export function WorkspacePublicationPanel({workspace:w,readOnly=false,children}:{workspace:ProductionWorkspace;readOnly?:boolean;children?:(publication:ReturnType<typeof useWorkspacePublication>)=>ReactNode}){
 const p=useWorkspacePublication(w.episodeId,w.id),id=useId(),ai=usePublicationAssistant(w.episodeId,p,readOnly);
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
 return <>{children?.(p)}<section className="workspace-publication" aria-label={uiText('发布资料（可选）')}>
  <header className="workspace-review-heading"><h4>{uiText('发布资料（可选）')}</h4>{p.saving&&<span role="status">{uiText('保存中…')}</span>}</header>
  {p.state&&p.state.basisContentSha256!==w.contentSha256&&<p role="status">{uiText('视频已更新，请核对发布资料。')}</p>}
  {!readOnly&&<div className="workspace-publication-ai">
   <Button size="sm" color="secondary" isDisabled={!p.state||ai.busy||ai.unresolved} onPress={()=>void ai.generate()}>{uiText(ai.busy?'正在生成文案…':hasContent?'重新生成发布文案':'AI 生成发布文案')}</Button>
   <small>{ai.choice?.label??uiText('选择大语言模型')} <button type="button" onClick={()=>ai.setChoosing(!ai.choosing)}>{uiText('更换')}</button></small>
   {ai.choosing&&<label htmlFor={`${id}-model`}>{uiText('大语言模型')}<select id={`${id}-model`} value={ai.choice?.id??''} onChange={e=>ai.choose(e.target.value)}><option value="">{uiText('请选择')}</option>{ai.options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select><button type="button" onClick={()=>void ai.refresh()}>{uiText('重新读取模型')}</button></label>}
   <details><summary>{uiText('补充要求（可选）')}</summary><label htmlFor={`${id}-instruction`}>{uiText('补充要求')}</label><textarea id={`${id}-instruction`} name="instruction" rows={2} value={p.content.instruction} maxLength={4000} disabled={!p.state} onChange={e=>p.edit({...p.content,instruction:e.target.value})}/></details>
   {p.state?.previousText&&<Button size="sm" color="tertiary" isDisabled={ai.busy||ai.unresolved} onPress={()=>void ai.undo()}>{uiText('撤回本次替换')}</Button>}
   {ai.unresolved&&<div role="status"><p>{uiText(ai.latest?.message??'文案请求未完成，请先核对。')}</p><Button size="sm" color="secondary" onPress={()=>void ai.recover()}>{uiText('核对原请求')}</Button>{ai.latest?.status==='unknown'&&<details><summary>{uiText('已在供应商侧核对？')}</summary><Button size="sm" color="secondary" onPress={()=>void ai.closeUnknown()}>{uiText('结束本次未知请求')}</Button></details>}</div>}
   {ai.error&&<p role="alert">{uiText(ai.error)}</p>}
  </div>}
  {!editing&&!hasContent&&<Button size="sm" color="secondary" isDisabled={!p.state||readOnly} onPress={()=>setEditing(true)}>{uiText('自己填写')}</Button>}
  {(editing||hasContent)&&<form className="workspace-publication-fields" aria-label={uiText('发布文案')} method="post" action={`/api/local/episodes/${w.episodeId}/publication`} onSubmit={event=>{event.preventDefault();void p.flush().catch(()=>{});}}>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-title`}>{uiText('标题')}</label><Button type="button" size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制标题')} onPress={()=>void copy(p.content.title,'标题')}/></div><input id={`${id}-title`} name="title" value={p.content.title} maxLength={200} disabled={readOnly} onChange={event=>p.edit({...p.content,title:event.target.value})}/></div>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-description`}>{uiText('简介')}</label><Button type="button" size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制简介')} onPress={()=>void copy(p.content.description,'简介')}/></div><textarea id={`${id}-description`} name="description" value={p.content.description} rows={3} maxLength={5000} disabled={readOnly} onChange={event=>p.edit({...p.content,description:event.target.value})}/></div>
   <div className="workspace-publication-field"><div className="workspace-delivery-field-heading"><label htmlFor={`${id}-tags`}>{uiText('标签')}</label><Button type="button" size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制标签')} onPress={()=>void copy(normalizeDeliveryTags(p.content.tags).map(tag=>`#${tag}`).join(' '),'标签')}/></div><input id={`${id}-tags`} name="tags" value={tags} placeholder={uiText('用逗号分隔')} disabled={readOnly} onChange={event=>{setTags(event.target.value);p.edit({...p.content,tags:event.target.value.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean)});}}/></div>
  </form>}
  <PublicationCoverPicker workspace={w} publication={p} readOnly={readOnly}/>
  {p.error&&<div role="alert" className="form-error"><p>{uiText(p.error)}</p>{p.state&&<Button size="sm" color="secondary" onPress={()=>void p.retry().catch(()=>{})}>{uiText('重试保存')}</Button>}<Button size="sm" color="tertiary" onPress={()=>void p.reload()}>{uiText('重新读取发布资料')}</Button></div>}
  {p.storageError&&<p role="alert">{uiText('本机草稿暂无法保存，请保持此页面打开。')}</p>}
  {copied.startsWith('复制失败')?<p role="alert">{uiText(copied)}</p>:<FeedbackNotice message={copied} identity={copySequence} onDismiss={()=>setCopied('')}/>}
 </section></>;
}
