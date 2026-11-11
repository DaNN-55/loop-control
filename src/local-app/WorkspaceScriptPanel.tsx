import {uiText} from '../i18n/ui';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {FileText} from 'lucide-react';
import {MarkdownPreview} from '../ui/MarkdownPreview';
import {mainScriptStatistics} from '../reviews/mainScript';
import {workspaceScriptInput,workspaceScriptExample} from './workspaceScriptInput';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {useWorkspaceDraft} from './WorkspaceDraft';
import {localRequest} from './client';
import type {EpisodeProductionSnapshot} from '../episodes/episodeSnapshot';
import './workspace-compact-panels.css';

interface Props {
 episodeId:string;scriptRevisionId:string|null;script:string;stage:string;readOnly:boolean;pending:boolean;
 command:(name:string,data:unknown)=>Promise<unknown>;onConfirmed:(scriptRevisionId?:string,revisionReason?:string)=>void;history?:ReactNode;errorPresented?:boolean;
}
type ScriptIntent={baseline:{id:string|null;text:string};source:{id:string|null;text:string};text:string;finish:(id:string)=>void};
type ScriptConfirmationState=
 |{phase:'idle'}
 |{phase:'saving'|'save_failed';intent:ScriptIntent}
 |{phase:'starting'|'checking'|'started';intent:ScriptIntent;savedId:string}
 |{phase:'start_failed';intent:ScriptIntent;savedId:string;readError:boolean};
const confirmationStatus:Record<ScriptConfirmationState['phase'],string>={idle:'',get saving(){return uiText("正在保存脚本…");},get save_failed(){return uiText("保存结果未确认，尚未启动制作。");},get starting(){return uiText("脚本已保存，正在启动制作…");},get checking(){return uiText("脚本已保存，正在核对启动状态…");},get start_failed(){return uiText("脚本已保存，制作尚未确认启动。");},get started(){return uiText("制作已启动");}};
export function WorkspaceScriptPanel(props:Props){return <WorkspaceScriptEditor key={props.episodeId} {...props}/>;}
function WorkspaceScriptEditor({episodeId,scriptRevisionId,script,stage,readOnly,pending,command,onConfirmed,history,errorPresented=false}:Props){
 const [flow,setFlow]=useState<ScriptConfirmationState>({phase:'idle'});
 // A successful save refreshes the parent's version before start settles. Keep its draft scope until completion.
 const baseline='intent' in flow?flow.intent.baseline:{id:scriptRevisionId,text:script};
 const savedId='savedId' in flow?flow.savedId:null;
 const draft=useWorkspaceDraft({episodeId,kind:'script',version:baseline.id??'new',initial:{text:baseline.text,reason:'',filename:'script.md'},enabled:!readOnly});
 const {text,reason,filename}=draft.value,setText=(text:string)=>draft.setValue(value=>({...value,text})),setReason=(reason:string)=>draft.setValue(value=>({...value,reason})),setFilename=(filename:string)=>draft.setValue(value=>({...value,filename}));
 const [preview,setPreview]=useState(script),[error,setError]=useState('');
 const [editing,setEditing]=useState(!readOnly&&(!scriptRevisionId||stage==='waiting_input')),[confirmation,setConfirmation]=useState<'save'|'discard'|null>(null),[locallyConfirmed,setLocallyConfirmed]=useState(false);
 const [invalid,setInvalid]=useState<'script'|'reason'|null>(null),errorId=useId(),reasonInput=useRef<HTMLInputElement>(null),textInput=useRef<HTMLTextAreaElement>(null);
 const input=useRef<HTMLInputElement>(null),lock=useRef(false),active=useRef(true),writable=useRef(!readOnly);writable.current=!readOnly;
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{if(flow.phase==='idle')setPreview(script);},[script,scriptRevisionId,flow.phase]);
 useEffect(()=>{if(flow.phase==='started'&&scriptRevisionId===flow.savedId&&script===flow.intent.text)setFlow({phase:'idle'});},[flow,scriptRevisionId,script]);
 const scriptInput=workspaceScriptInput(text),source='intent' in flow?flow.intent.source:baseline,basisId=savedId??source.id;
 const busy=['saving','starting','checking'].includes(flow.phase);
 const changed='savedId' in flow?scriptInput.text!==flow.intent.text:source.id!==baseline.id?scriptInput.text!==source.text:text!==preview,revision=!!basisId&&(stage!=='waiting_input'||!!savedId||basisId!==baseline.id),disabled=readOnly||pending||busy,isEditing=(editing||draft.dirty)&&!readOnly;
 const canResume=flow.phase==='start_failed'&&!changed;
 const showError=!errorPresented||flow.phase==='start_failed'&&flow.readError;
 const baselineStatus=confirmationStatus[flow.phase]||(revision||locallyConfirmed?'已确认基准':'待确认');
 const statistics=mainScriptStatistics(isEditing?text:preview),confirmedCharacters=Array.from(preview).length;
 function requestSave(){
  setError('');setInvalid(null);
  if(!text.trim()){setInvalid('script');textInput.current?.focus();return;}
  if(scriptInput.error){setInvalid('script');setError(scriptInput.error);textInput.current?.focus();return;}
  if(basisId&&changed&&!reason.trim()){setInvalid('reason');reasonInput.current?.focus();return;}
  if(revision||basisId&&changed)setConfirmation('save');else void confirm();
 }
 function discard(){setFlow({phase:'idle'});setInvalid(null);draft.reset();setError('');setEditing(false);setConfirmation(null);}
 async function startSaved(intent:ScriptIntent,id:string,check=false){
  let commandStarted=false;
  try{
   if(check){
    setFlow({phase:'checking',intent,savedId:id});
    const value=await localRequest(`episodes/${encodeURIComponent(episodeId)}`) as {sections:Partial<EpisodeProductionSnapshot>&{historicalReadOnly?:boolean}};
    if(!active.current)return;
    if(!writable.current)throw Error('当前生产单已只读，本次草稿已保留。');
    const episode=value.sections?.episode;
    if(!episode||typeof episode.stage!=='string'||episode.id!==episodeId||episode.main_script_revision_id!==id||episode.archived_at||episode.stage==='production_completed'||value.sections.historicalReadOnly)throw Error('当前脚本版本或生产单状态已变化，请重新打开核对；本次草稿已保留。');
    if(episode.stage!=='waiting_input'){
     setFlow({phase:'started',intent,savedId:id});intent.finish(id);return;
    }
   }
   if(!writable.current)throw Error('当前生产单已只读，本次草稿已保留。');
   setFlow({phase:'starting',intent,savedId:id});
   commandStarted=true;
   const result=await command('start',{episodeId}) as Partial<EpisodeProductionSnapshot['episode']>;
   // A previous start may have committed with a lost response; its receipt belongs to that script only.
   if(result.main_script_revision_id!==undefined&&result.main_script_revision_id!==id||result.stage==='waiting_input')throw Error('启动回执对应的脚本或阶段已变化，请核对后继续启动。');
   if(!active.current||!writable.current)return;
   setFlow({phase:'started',intent,savedId:id});intent.finish(id);
  }catch(cause){if(active.current){setFlow({phase:'start_failed',intent,savedId:id,readError:!commandStarted});setError(cause instanceof Error?cause.message:'制作启动未完成。');}}
 }
 async function confirm(){
  if(disabled||lock.current)return;
  lock.current=true;setError('');setConfirmation(null);
  const submitted={...draft.value};
  const intent:ScriptIntent={baseline,source:{id:basisId,text:'savedId' in flow?flow.intent.text:source.text},text:scriptInput.text,finish:id=>{
   if(draft.acknowledge(submitted,{...submitted,text:scriptInput.text,reason:''})){setPreview(scriptInput.text);setEditing(false);}
   setLocallyConfirmed(true);onConfirmed(id,submitted.reason.trim()||undefined);
  }};
  setFlow({phase:'saving',intent});
  try{
   let id=basisId;
   if(!id){
    const bytes=new TextEncoder().encode(intent.text);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    const registered=await command('importMaterial',{episodeId,materialType:'script',materialPurpose:'main_script',sourceKind:'file',sourcePath:submitted.filename,mimeType:'text/markdown',contentBase64:btoa(binary),isMainScript:true}) as {id:string};id=registered.id;
   }else if(changed){
    const revised=await command('reconfirmScript',{episodeId,expectedScriptRevisionId:id,text:intent.text,reason:submitted.reason.trim()}) as {id:string};id=revised.id;
   }
   if(!active.current)return;
   setPreview(intent.text);await startSaved(intent,id!);
  }catch(cause){if(active.current){setFlow({phase:'save_failed',intent});setError(cause instanceof Error?cause.message:'脚本保存未完成。');}}
  finally{lock.current=false;}
 }
 async function resume(){
  if(disabled||lock.current||flow.phase!=='start_failed'||!canResume)return;
  lock.current=true;setError('');
  try{await startSaved(flow.intent,flow.savedId,true);}finally{lock.current=false;}
 }
 async function readScriptFile(file:File){
  if(disabled||!isEditing)return;
  try{if(!/\.(md|txt)$/i.test(file.name))throw Error('请选择 Markdown 或 TXT 脚本。');if(!file.size||file.size>2*1024*1024)throw Error('脚本不能为空或超过2MB。');setText(await file.text());setInvalid(null);setFilename(file.name);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'脚本读取失败。');}
 }
 return <section className="production-workspace-section workspace-script workspace-script-compact" aria-label={uiText("脚本确认")}>
  <header><div className="workspace-compact-heading"><h3>{uiText("主脚本")}</h3><span role="status" className={revision||locallyConfirmed?'is-confirmed':''}>{baselineStatus}{readOnly?uiText(" · 只读"):''}</span></div></header>

  {draft.storageError&&<p role="alert" className="form-error">{uiText("本机草稿暂无法保存，请保持此页面打开。")}</p>}
  <div className="workspace-script-layout">
   <div className="workspace-script-main">
    {draft.restored&&<p role="status" className="workspace-script-restored">{uiText("已恢复草稿，尚未确认。")}</p>}
    {isEditing?<div className="workspace-script-comparison">
     <div className="workspace-script-editor">
      <div className="workspace-script-editor-heading"><span>{uiText("脚本正文")}</span>{!text.trim()&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{setText(workspaceScriptExample);setError('');setInvalid(null);requestAnimationFrame(()=>textInput.current?.focus());}}>{uiText("使用示例")}</Button>}</div>
      <div className="workspace-script-text"><textarea ref={textInput} aria-label={uiText("主脚本")} aria-required="true" aria-invalid={invalid==='script'||undefined} aria-describedby={invalid==='script'?errorId:undefined} value={text} disabled={pending||busy} onChange={event=>{setText(event.target.value);if(invalid==='script'){setInvalid(null);setError('');}}} placeholder={uiText("直接粘贴正文，空行分隔镜头；也可上传 Markdown / TXT 结构化脚本。")}/>{invalid==='script'&&<span id={errorId} className="form-error" role="alert">{error||uiText("请填写主脚本。")}</span>}</div>
     </div>
     <section className="workspace-script-shot-preview" aria-label={uiText("镜头与字幕预览")}>
      <header><h4>{uiText("镜头与字幕预览")}</h4><span>{scriptInput.shots.length}{uiText(" 个镜头")}</span></header>
      {scriptInput.error?<p className="workspace-script-preview-message">{text.trim()?scriptInput.error:uiText("填写正文后显示镜头预览。")}</p>:scriptInput.shots.map((shot,index)=><article key={shot.id}><strong>{uiText("镜头 ")}{String(index+1).padStart(2,'0')}</strong><dl><div><dt>{uiText("字幕")}</dt><dd>{shot.subtitle}</dd></div>{shot.visual&&<div><dt>{uiText("画面说明")}</dt><dd>{shot.visual}</dd></div>}</dl></article>)}
     </section>
    </div>:<div className="workspace-script-preview" role="document" aria-label={uiText("主脚本预览")} tabIndex={0}>{preview?<MarkdownPreview content={preview}/>: uiText("正在读取主脚本…")}</div>}
    <div className="workspace-script-statistics" role="group" aria-label={uiText("脚本字数")}><span title={uiText("完整脚本的 Unicode 字符数，包含空白、标点与格式。")}>{uiText("脚本字符 ")}{statistics.characters.toLocaleString()}</span><span title={statistics.textKind==='narration'?uiText("仅统计口播字段中的文字和数字，不计空白与标点。"):uiText("仅统计正文中的文字和数字，未区分口播与说明。")}>{statistics.textKind==='narration'?uiText("口播字数"):uiText("正文文字数")} {statistics.textCharacters===null?uiText("暂无法统计"):statistics.textCharacters.toLocaleString()}</span>{isEditing&&changed&&<span>{uiText("有未确认修改")}</span>}</div>

   </div>
   <aside className="workspace-script-basis" aria-label={uiText("脚本基准")}>
    <div className="workspace-script-file" onDragOver={event=>{if(isEditing&&!disabled)event.preventDefault();}} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file)void readScriptFile(file);}}>
     <input ref={input} hidden type="file" accept=".md,.txt,text/plain,text/markdown" aria-label={uiText("上传主脚本")} disabled={disabled||!isEditing} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void readScriptFile(file);}}/>
     {isEditing?<button type="button" className="workspace-script-file-slot" aria-label={uiText("上传脚本")} disabled={disabled} onClick={()=>input.current?.click()}><FileText size={20} aria-hidden="true"/><span><strong>{filename==='script.md'?uiText("拖入或选择脚本"):filename}</strong><small>{uiText("Markdown / TXT · 最大 2 MB")}</small></span></button>:<div className="workspace-script-file-slot is-locked"><FileText size={20} aria-hidden="true"/><span><strong>{filename==='script.md'?uiText("主脚本"):filename}</strong><small>{uiText("已确认脚本")}</small></span></div>}
    </div>
    {(!readOnly||invalid||error&&showError)&&<div className="workspace-script-controls" role="group" aria-label={uiText("脚本操作")}>
     {!isEditing&&!readOnly&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{setText(preview);setError('');setEditing(true);}}>{uiText("修改脚本")}</Button>}
    {isEditing&&basisId&&(changed||!!reason)&&<label className="workspace-script-reason">{uiText("修订原因")}<input ref={reasonInput} aria-label={uiText("脚本修订原因")} aria-required="true" aria-invalid={invalid==='reason'||undefined} aria-describedby={invalid==='reason'?errorId:undefined} placeholder={uiText("简述本次修改原因")} value={reason} disabled={disabled} onChange={event=>{setReason(event.target.value);if(invalid==='reason')setInvalid(null);}}/>{invalid==='reason'&&<span id={errorId} className="form-error" role="alert">{uiText("请填写修订原因。")}</span>}</label>}
    {isEditing&&<div className="workspace-script-actions"><Button size="sm" color="primary" isDisabled={disabled||!canResume&&!!basisId&&!changed&&stage!=='waiting_input'} onPress={canResume?()=>void resume():requestSave}>{flow.phase==='saving'?uiText("正在保存…"):flow.phase==='starting'?uiText("正在启动…"):flow.phase==='checking'?uiText("正在核对…"):canResume?uiText("继续启动"):revision?uiText("确认脚本修订"):uiText("确认脚本")}</Button>{(revision||locallyConfirmed)&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{if(changed||reason.trim())setConfirmation('discard');else discard();}}>{uiText("取消编辑")}</Button>}</div>}
    {error&&invalid!=='script'&&showError&&<p role="alert" className="form-error">{uiText(error||'')}</p>}
    </div>}
    <h4>{uiText("脚本基准")}</h4>
    <dl><div><dt>{uiText("基准版本")}</dt><dd>{scriptRevisionId?.slice(0,8)??uiText("尚无版本")}</dd></div><div><dt>{uiText("基准字数")}</dt><dd>{scriptRevisionId||locallyConfirmed?uiText("{value0} 字符",{value0:String(confirmedCharacters.toLocaleString())}):uiText("尚未确认")}</dd></div></dl>
    {scriptRevisionId&&<p className="workspace-script-revision-id" aria-label={uiText("脚本基准 ID")}>{scriptRevisionId}</p>}
    {isEditing&&revision&&<p>{uiText("修订后需重新核对素材匹配，已有工程与媒体保留。")}</p>}
    {history}
   </aside>
  </div>
  <ConfirmationModalPresence>{confirmation==='save'&&<ConfirmationModal title={uiText("确认脚本修订")} confirmLabel={uiText("确认保存修订")} isPending={busy} pendingLabel={uiText("正在保存…")} onCancel={()=>setConfirmation(null)} onConfirm={confirm}><p>{uiText("保存后将更新素材规划；已有剪辑工程保留为历史版本，原媒体不会删除。")}</p><p>{uiText("修订原因：")}{reason.trim()}</p></ConfirmationModal>}</ConfirmationModalPresence>
  <ConfirmationModalPresence>{confirmation==='discard'&&<ConfirmationModal title={uiText("放弃脚本修改")} confirmLabel={uiText("放弃修改")} tone="danger" onCancel={()=>setConfirmation(null)} onConfirm={discard}><p>{uiText("本次未保存的正文与修订原因将被放弃，已确认脚本保持不变。")}</p></ConfirmationModal>}</ConfirmationModalPresence>
 </section>;
}
