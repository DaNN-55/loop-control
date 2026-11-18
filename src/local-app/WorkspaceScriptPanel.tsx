import {FeedbackNotice} from '../ui/FeedbackNotice';
import {useScriptStudioSessions} from './useScriptStudioSessions';
import type {ScriptStudioAttachmentMaterial} from '../scriptStudioAttachments';
import {uiText} from '../i18n/ui';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {BookOpen,Clock,CloudCheck,History,Info,LoaderCircle,PanelLeftOpen,Upload} from 'lucide-react';
import {ScriptStudioIcon,ScriptStudioPopup} from './ScriptStudioTools';
import {MarkdownPreview} from '../ui/MarkdownPreview';
import {estimateScriptDuration,validateStudioDuration} from '../scriptStudio';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {useWorkspaceDraft,useWorkspaceOwnerId} from './WorkspaceDraft';
import {workspaceScriptExample} from './workspaceScriptInput';
import {localRequest} from './client';
import type {EpisodeProductionSnapshot} from '../episodes/episodeSnapshot';
import {useScriptStudioSource,type ScriptStudioSource} from './useScriptStudioSource';
import {useScriptStudioAssistant} from './useScriptStudioAssistant';
import {ScriptStudioChat} from './ScriptStudioChat';
import {ScriptStudioProposal} from './ScriptStudioProposal';
import {ScriptStudioSavedPlan} from './ScriptStudioSavedPlan';
import './workspace-compact-panels.css';
import './script-studio.css';
import './script-studio-chat.css';

interface Props {
 episodeId:string;scriptRevisionId:string|null;script:string;stage:string;readOnly:boolean;pending:boolean;
 command:(name:string,data:unknown)=>Promise<unknown>;onConfirmed:(scriptRevisionId?:string,revisionReason?:string)=>void;history?:ReactNode;errorPresented?:boolean;materials?:readonly ScriptStudioAttachmentMaterial[];onMaterialImported?:(material:ScriptStudioAttachmentMaterial)=>void;
}
type Basis={id:string|null;text:string;duration:string};
type ScriptIntent={baseline:Basis;source:Basis;text:string;duration:string;reason:string;finish:(id:string)=>void};
type ScriptConfirmationState=
 |{phase:'idle'}
 |{phase:'saving'|'save_failed';intent:ScriptIntent}
 |{phase:'starting'|'checking'|'started';intent:ScriptIntent;savedId:string}
 |{phase:'start_failed';intent:ScriptIntent;savedId:string;readError:boolean};
const confirmationStatus:Record<ScriptConfirmationState['phase'],string>={idle:'',saving:'正在保存脚本…',save_failed:'保存结果未确认，尚未启动制作。',starting:'脚本已保存，正在启动制作…',checking:'脚本已保存，正在核对启动状态…',start_failed:'脚本已保存，制作尚未确认启动。',started:'制作已启动'};
export function WorkspaceScriptPanel(props:Props){const owner=useWorkspaceOwnerId();return <WorkspaceScriptSource key={owner+':'+props.episodeId} {...props}/>;}
function WorkspaceScriptSource(props:Props){
 const source=useScriptStudioSource(props.episodeId,props.scriptRevisionId,props.script);
 const loaded=useRef<{revisionId:string|null;value:ScriptStudioSource}|null>(null);
 if(!source.loading)loaded.current={revisionId:props.scriptRevisionId,value:source.value};
 // Keep an initialized draft's baseline stable while refreshing the same immutable revision.
 const retained=loaded.current?.revisionId===props.scriptRevisionId?loaded.current.value:null;
 return <WorkspaceScriptEditor {...props} retained={retained??source.value} sourceReady={!!retained} sourceLoading={source.loading} sourceError={source.error} retrySource={source.retry}/>;
}
function WorkspaceScriptEditor({episodeId,scriptRevisionId,script,stage,readOnly,pending,command,onConfirmed,history,errorPresented=false,materials=[],onMaterialImported,retained,sourceReady,sourceLoading,sourceError,retrySource}:Props&{retained:ScriptStudioSource;sourceReady:boolean;sourceLoading:boolean;sourceError:string;retrySource:()=>void}){
 const [flow,setFlow]=useState<ScriptConfirmationState>({phase:'idle'});
 const baseline:Basis='intent' in flow?flow.intent.baseline:{id:scriptRevisionId,text:retained.sourceText,duration:retained.targetDuration===null?'':String(retained.targetDuration)};
 const draft=useWorkspaceDraft({episodeId,kind:'script',version:baseline.id??'new',initial:{text:baseline.text,duration:baseline.duration,reason:'',filename:'script.md'},legacyInitial:baseline.id===scriptRevisionId?{text:script,reason:'',filename:'script.md'}:undefined,enabled:!readOnly&&(sourceReady||flow.phase!=='idle')});
 const {text,duration,reason,filename}=draft.value;
 const [error,setError]=useState(''),[invalid,setInvalid]=useState<'script'|'duration'|null>(null),[discardOpen,setDiscardOpen]=useState(false),[examplesOpen,setExamplesOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false),[middleCollapsed,setMiddleCollapsed]=useState(false),[modelOpen,setModelOpen]=useState(false),[editingShot,setEditingShot]=useState(false),[chatCollapsed,setChatCollapsed]=useState(false);
 const formId=useId(),errorId=useId(),textId=useId(),durationId=useId(),textInput=useRef<HTMLTextAreaElement>(null),durationInput=useRef<HTMLInputElement>(null),input=useRef<HTMLInputElement>(null);
 const lock=useRef(false),active=useRef(true),writable=useRef(!readOnly),editSequence=useRef(0);writable.current=!readOnly;
 const busy=['saving','starting','checking'].includes(flow.phase),disabled=readOnly||pending||busy||sourceLoading&&flow.phase==='idle';
 const savedSource:Basis='savedId' in flow?{id:flow.savedId,text:flow.intent.text,duration:flow.intent.duration}:'intent' in flow?flow.intent.source:baseline;
 const basisId=savedSource.id;
 const changed=text!==savedSource.text||duration!==savedSource.duration;
 const canResume=flow.phase==='start_failed'&&!changed;
 const targetDuration=duration.trim()?Number(duration):null;
 const sessions=useScriptStudioSessions({episodeId,scriptRevisionId:basisId,source:text,targetDuration,disabled});
 const sessionWaiting=sessions.loading||sessions.creating;
 const assistant=useScriptStudioAssistant({episodeId,scriptRevisionId:basisId,source:text,targetDuration,conversationId:sessions.activeId??undefined,disabled:disabled||sessions.loading||sessions.creating||!!sessions.error});
 const proposal=assistant.result?.plan?assistant.result:null,showError=!errorPresented||flow.phase==='start_failed'&&flow.readError;
 useEffect(()=>{if(assistant.needsChoice){setChatCollapsed(false);setModelOpen(true);}},[assistant.needsChoice]);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{if(flow.phase==='started'&&scriptRevisionId===flow.savedId&&retained.sourceText===flow.intent.text)setFlow({phase:'idle'});},[flow,scriptRevisionId,retained.sourceText]);
 function setField(name:'text'|'duration'|'reason'|'filename',value:string){editSequence.current++;draft.setValue(previous=>({...previous,[name]:value}));if(name==='text'||name==='duration'){setInvalid(null);setError('');}}
 function validate(){
  setError('');setInvalid(null);
  if(!text.trim()){setInvalid('script');setError('请填写主脚本。');textInput.current?.focus();return false;}
  try{if(duration.trim()&&!/^\d+(?:\.\d{1,2})?$/.test(duration.trim()))throw Error('总时长须为 0.1–3600 秒，最多两位小数。');validateStudioDuration(targetDuration);}catch(cause){setInvalid('duration');setError(cause instanceof Error?cause.message:'总时长无效。');durationInput.current?.focus();return false;}
  return true;
 }
 async function startSaved(intent:ScriptIntent,id:string,check=false){
  let commandStarted=false;
  try{
   if(check){
    setFlow({phase:'checking',intent,savedId:id});
    const value=await localRequest('episodes/'+encodeURIComponent(episodeId)) as {sections:Partial<EpisodeProductionSnapshot>&{historicalReadOnly?:boolean}};
    if(!active.current)return;
    if(!writable.current)throw Error('当前生产单已只读，本次草稿已保留。');
    const episode=value.sections?.episode;
    if(!episode||typeof episode.stage!=='string'||episode.id!==episodeId||episode.main_script_revision_id!==id||episode.archived_at||episode.stage==='production_completed'||value.sections.historicalReadOnly)throw Error('当前脚本版本或生产单状态已变化，请重新打开核对；本次草稿已保留。');
    if(episode.stage!=='waiting_input'){setFlow({phase:'started',intent,savedId:id});intent.finish(id);return;}
   }
   if(!writable.current)throw Error('当前生产单已只读，本次草稿已保留。');
   setFlow({phase:'starting',intent,savedId:id});commandStarted=true;
   const result=await command('start',{episodeId}) as Partial<EpisodeProductionSnapshot['episode']>;
   if(result.main_script_revision_id!==undefined&&result.main_script_revision_id!==id||result.stage==='waiting_input')throw Error('启动回执对应的脚本或阶段已变化，请核对后继续启动。');
   if(!active.current||!writable.current)return;
   setFlow({phase:'started',intent,savedId:id});intent.finish(id);
  }catch(cause){if(active.current){setFlow({phase:'start_failed',intent,savedId:id,readError:!commandStarted});setError(cause instanceof Error?cause.message:'制作启动未完成。');}}
 }
 async function confirm(adopt=false){
  if(disabled||sessionWaiting||lock.current||assistant.busy||editingShot||!validate())return;
  setHistoryOpen(false);
  if(adopt&&(assistant.unresolved||assistant.conversationLoading||!proposal?.plan?.canProceed||!proposal.requestId))return;
  if(basisId&&!changed&&!adopt&&flow.phase==='idle'&&stage!=='waiting_input'){onConfirmed(basisId);return;}
  lock.current=true;const submitted={...draft.value};
  const intent:ScriptIntent={baseline,source:savedSource,text:submitted.text,duration:submitted.duration,reason:submitted.reason.trim(),finish:id=>{draft.acknowledge(submitted,{...submitted,reason:''});onConfirmed(id,submitted.reason.trim()||undefined);}};
  setFlow({phase:'saving',intent});
  try{
   let id=basisId;
   if(!id||changed||adopt){
    const saved=await command('confirmScriptStudio',{episodeId,expectedScriptRevisionId:id,text:submitted.text,targetDuration,reason:submitted.reason.trim(),...(adopt?{requestId:proposal!.requestId}:{})}) as {id:string;alreadyStarted?:boolean};id=saved.id;
    if(!active.current||!writable.current)return;
    if(saved.alreadyStarted){setFlow({phase:'started',intent,savedId:id});intent.finish(id);return;}
   }
   if(!active.current)return;
   await startSaved(intent,id!);
  }catch(cause){if(active.current){setFlow({phase:'save_failed',intent});setError(cause instanceof Error?cause.message:'脚本保存未完成。');}}
  finally{lock.current=false;}
 }
 async function resume(){if(disabled||sessionWaiting||lock.current||flow.phase!=='start_failed'||!canResume)return;lock.current=true;setError('');try{await startSaved(flow.intent,flow.savedId,true);}finally{lock.current=false;}}
 async function readScriptFile(file:File){
  if(disabled)return;
  const sequence=editSequence.current;
  try{if(!/\.(md|txt)$/i.test(file.name))throw Error('请选择 Markdown 或 TXT 脚本。');if(!file.size||file.size>2*1024*1024)throw Error('脚本不能为空或超过 2 MB。');const value=await file.text();if(!active.current||!writable.current)return;if(sequence!==editSequence.current)throw Error('读取文件期间草稿已变化，本次导入未覆盖新内容，请重新导入。');setField('text',value);setField('filename',file.name);}catch(cause){if(active.current)setError(cause instanceof Error?cause.message:'脚本读取失败。');}
 }
 const middleVisible=!!proposal||assistant.opened&&assistant.busy&&!assistant.needsChoice;
 const collapsed=middleCollapsed;
 const continueLabel=flow.phase==='saving'?'正在保存…':flow.phase==='starting'?'正在启动…':flow.phase==='checking'?'正在核对…':canResume?'继续启动':'继续制作';
 const status=uiText(confirmationStatus[flow.phase]||(draft.dirty?'有未确认修改':basisId?'已确认基准':'待确认'));
 const historyContent=<div className="script-studio-history-panel">{scriptRevisionId?<div className="script-studio-history-version"><span>{uiText('已确认版本')}</span><code title={scriptRevisionId}>{scriptRevisionId.slice(0,8)}</code></div>:<p>{uiText('尚无已确认版本')}</p>}{retained.plan&&<ScriptStudioSavedPlan plan={retained.plan}/>} {history}{!readOnly&&basisId&&<><label className="script-studio-note">{uiText('修订备注（选填）')}<input name="reason" aria-label={uiText('修订备注（选填）')} value={reason} maxLength={4000} disabled={disabled} onChange={event=>setField('reason',event.target.value)}/></label>{draft.dirty&&<div className="script-studio-history-actions"><Button type="button" size="sm" color="tertiary" isDisabled={disabled} onPress={()=>{setHistoryOpen(false);setDiscardOpen(true);}}>{uiText('还原已确认脚本')}</Button></div>}</>}</div>;
 return <section className="production-workspace-section workspace-script workspace-script-compact script-studio script-studio-chat-layout" aria-label={uiText('脚本确认')}>
  {draft.storageError&&<p role="alert" className="form-error">{uiText('本机草稿暂无法保存，请保持此页面打开。')}</p>}
  {sourceError?<div className="script-studio-read-error"><p role="alert" className="form-error">{uiText(sourceError)}</p><Button type="button" size="sm" color="secondary" onPress={retrySource}>{uiText('重新读取原文')}</Button></div>:sourceLoading&&<p role="status" className="script-studio-loading">{uiText('正在读取主脚本原文…')}</p>}
  <div className="script-studio-content">
   {readOnly?<><header className="script-studio-pane-heading"><h3>{uiText('主脚本')}</h3><span>{status}{uiText(' · 只读')}</span></header><div className="workspace-script-preview" role="document" aria-label={uiText('主脚本预览')} tabIndex={0}><MarkdownPreview content={retained.sourceText}/></div><details className="script-studio-readonly-history"><summary>{uiText('历史')}</summary>{historyContent}</details><details className="script-studio-readonly-history"><summary>{uiText('使用帮助')}</summary><p>{uiText('普通文本、单镜头和完整分镜都可继续制作。优化拍法默认保留原文内容和总时长。')}</p><p>{uiText('未明确的口播与字幕用途会在制作方案中说明，采用前请核对。总时长支持 0.1–3600 秒。')}</p></details></>:<>
    {draft.restored&&<FeedbackNotice message="已恢复草稿，尚未确认。" onceKey={'script-draft:'+draft.scope} tone="info"/>}
    <div className="script-studio-toolbar" role="toolbar" aria-label={uiText('脚本工具')}>
     <strong>{uiText('脚本确认')}</strong>

     <div className="script-studio-toolbar-duration"><div className="script-studio-duration-control" title={uiText('留空自动估算，预计 {value0} 秒；可输入 0.1–3600 秒。',{value0:String(estimateScriptDuration(text))})}><Clock size={14} aria-hidden="true"/><input ref={durationInput} form={formId} id={durationId} name="duration" aria-label={uiText('目标时长')} inputMode="decimal" value={duration} disabled={disabled} placeholder={uiText('自动时长')} aria-invalid={invalid==='duration'||undefined} aria-describedby={invalid==='duration'?errorId:undefined} onChange={event=>setField('duration',event.target.value)}/><span>{uiText('秒')}</span></div>{error&&showError&&invalid==='duration'&&<p id={errorId} role="alert" className="form-error">{uiText(error)}</p>}</div>
     <ScriptStudioPopup label="脚本历史" open={historyOpen} onOpenChange={setHistoryOpen} nonModal trigger={<ScriptStudioIcon label="历史" icon={History}/>}>{historyContent}</ScriptStudioPopup><ScriptStudioPopup label="使用帮助" trigger={<ScriptStudioIcon label="使用帮助" icon={Info}/>}><p>{uiText('普通文本或完整分镜均可继续制作。上传支持 TXT、Markdown，最大 2 MB。')}</p><p>{uiText('调整拍法生成待采用的新分镜；自由交流可聊任何话题，只回复文字。两者发送时都会调用所选模型。')}</p><p>{uiText('发送时自动携带当前原文、最新拍法和本对话历史。修改原文、时长或脚本版本后切换对应上下文；刷新可恢复已保存对话。')}</p><p>{uiText('原文、历史、已有工程和媒体会保留；生成新版需采用后才进入制作。')}</p></ScriptStudioPopup>
    </div>

    {error&&showError&&!invalid&&<p id={errorId} role="alert" className="form-error">{uiText(error)}</p>}
    <div className={'script-studio-grid'+(collapsed?' is-middle-collapsed':'')+(chatCollapsed?' is-chat-collapsed':'')}>
     <form id={formId} className="script-studio-editor" aria-label={uiText('脚本正文')} noValidate onSubmit={event=>{event.preventDefault();if(proposal)return;if(canResume)void resume();else void confirm();}}>
      <div className="script-studio-pane-heading script-studio-input-heading"><div><label htmlFor={textId}>{uiText('脚本正文')}</label><span role="status" className="script-studio-badge">{status}</span></div><div className="script-studio-actions"><div className="script-studio-upload-slot" onDragOver={event=>{if(!disabled)event.preventDefault();}} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file)void readScriptFile(file);}}><ScriptStudioIcon label="上传脚本" description={filename!=='script.md'?filename:undefined} tip={[uiText('上传 TXT、Markdown，最大 2 MB；也可拖入正文。'),filename!=='script.md'?filename:''].filter(Boolean).join(' ')} icon={Upload} disabled={disabled} onPress={()=>input.current?.click()}/></div><input ref={input} hidden type="file" name="scriptFile" accept=".md,.txt,text/plain,text/markdown" aria-label={uiText('导入主脚本文件')} disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void readScriptFile(file);}}/><ScriptStudioPopup label="使用示例" className="script-studio-examples-popover" open={examplesOpen} onOpenChange={setExamplesOpen} trigger={<ScriptStudioIcon label="使用示例" tip="选择普通文本或完整分镜示例，会替换当前正文。" icon={BookOpen} disabled={disabled}/>}>
       <div className="script-studio-example-options"><Button type="button" size="sm" color="tertiary" isDisabled={disabled} onPress={()=>{setField('text','一个人推门走进咖啡馆，门铃轻响。他走到窗边坐下，望向对面的空座位，等待朋友。');setField('duration','15');setExamplesOpen(false);}}>{uiText('普通文本')}</Button><Button type="button" size="sm" color="tertiary" isDisabled={disabled} onPress={()=>{setField('text',workspaceScriptExample);setExamplesOpen(false);}}>{uiText('完整分镜')}</Button></div>
      </ScriptStudioPopup><ScriptStudioPopup label="草稿信息" trigger={<ScriptStudioIcon label={draft.storageError?'本机草稿暂无法保存':'本机草稿已保存'} tip={draft.restored?'已恢复草稿，尚未确认。':'本机草稿已保存'} icon={CloudCheck}/>}><p>{uiText(draft.storageError?'本机草稿暂无法保存，请保持此页面打开。':draft.restored?'已恢复草稿，尚未确认。':'本机草稿已保存')}</p>{filename!=='script.md'&&<p>{filename}</p>}</ScriptStudioPopup></div></div>
      <div className="script-studio-drop" onDragOver={event=>{if(!disabled)event.preventDefault();}} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file)void readScriptFile(file);}}><textarea ref={textInput} id={textId} name="script" required value={text} disabled={disabled} aria-invalid={invalid==='script'||undefined} aria-describedby={invalid==='script'?errorId:undefined} onChange={event=>setField('text',event.target.value)} placeholder={uiText('粘贴故事、文案或已写好的分镜，也可拖入 TXT / Markdown。')}/></div>{error&&showError&&invalid==='script'&&<p id={errorId} role="alert" className="form-error">{uiText(error)}</p>}
     </form>
     <aside className="script-studio-middle" aria-label={uiText('分镜预览')}>
      {collapsed?<div className="script-studio-middle-rail"><ScriptStudioIcon label="展开分镜" icon={PanelLeftOpen} onPress={()=>setMiddleCollapsed(false)}/></div>:assistant.busy&&assistant.activity==='model'?<div className="script-studio-pending"><header className="script-studio-pane-heading"><h4>{uiText('分镜')}</h4><ScriptStudioIcon label="收起分镜" icon={PanelLeftOpen} onPress={()=>setMiddleCollapsed(true)}/></header><div role="status" aria-label={uiText('拍法生成进度')}><LoaderCircle size={18} className="script-studio-spinner" aria-hidden="true"/><p>{uiText('正在生成拍法，原文和总时长保持不变…')}</p><div className="script-studio-skeleton" aria-hidden="true"><i/><i/><i/></div></div></div>:proposal&&<ScriptStudioProposal key={proposal.requestId} result={proposal} onCollapse={()=>setMiddleCollapsed(true)} busy={assistant.busy} disabled={disabled||sessionWaiting} error={assistant.error} onSave={assistant.saveShot} onDelete={assistant.deleteShot} onEditingChange={setEditingShot}/>}
      {!collapsed&&!middleVisible&&<><header className="script-studio-pane-heading"><h4>{uiText('分镜')}</h4></header><p className="script-studio-middle-empty">{uiText('优化拍法后在此查看分镜。')}</p></>}
     </aside>
     <ScriptStudioChat assistant={assistant} sessions={sessions} materials={materials} importMaterial={async data=>{const material=await command('importMaterial',data) as ScriptStudioAttachmentMaterial;onMaterialImported?.(material);return material;}} episodeId={episodeId} revisionId={basisId} disabled={disabled||editingShot||sessions.loading||sessions.creating||!!sessions.error} collapsed={chatCollapsed} onCollapse={()=>setChatCollapsed(value=>!value)} modelOpen={modelOpen} onModelOpen={setModelOpen} onSend={async(mode,instruction,previous,attachments)=>{if(validate()){if(mode!=='discuss')setMiddleCollapsed(false);const value=await assistant.send(mode,instruction,previous,attachments);if(value&&!sessions.items.some(item=>item.id===sessions.activeId))await sessions.refresh();return value;}}}/>
    </div>
    <div className="script-studio-next" role="group" aria-label={uiText('制作操作')}>{proposal&&<span className="script-studio-next-status">{uiText('当前拍法待采用')}</span>}<div className="script-studio-actions">{proposal?<><Button type="button" size="sm" color="tertiary" isDisabled={disabled||sessionWaiting||assistant.busy||editingShot} onPress={()=>void confirm()}>{uiText('按原方案继续')}</Button><Button type="button" size="sm" color="primary" isDisabled={disabled||sessionWaiting||assistant.busy||editingShot||assistant.unresolved||assistant.conversationLoading||!proposal.plan?.canProceed} onPress={()=>void confirm(true)}>{uiText('采用并继续')}</Button></>:<Button type="submit" form={formId} size="sm" color="primary" isDisabled={disabled||sessionWaiting||assistant.busy}>{uiText(continueLabel)}</Button>}</div></div>
   </>}
  </div>
  <ConfirmationModalPresence>{discardOpen&&<ConfirmationModal title={uiText('还原已确认脚本')} confirmLabel={uiText('还原脚本')} tone="danger" onCancel={()=>{setDiscardOpen(false);setHistoryOpen(true);}} onConfirm={()=>{draft.reset();setError('');setInvalid(null);setFlow({phase:'idle'});setDiscardOpen(false);}}><p>{uiText('本次未确认的原文、时长与备注会被放弃，已确认脚本和媒体保留。')}</p></ConfirmationModal>}</ConfirmationModalPresence>
 </section>;
}
