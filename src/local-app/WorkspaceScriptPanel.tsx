import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {FileText} from 'lucide-react';
import {MarkdownPreview} from '../ui/MarkdownPreview';
import {mainScriptStatistics} from '../reviews/mainScript';
import {workspaceScriptInput,workspaceScriptExample} from './workspaceScriptInput';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {useWorkspaceDraft} from './WorkspaceDraft';
import './workspace-compact-panels.css';

interface Props {
 episodeId:string;scriptRevisionId:string|null;script:string;stage:string;readOnly:boolean;pending:boolean;
 command:(name:string,data:unknown)=>Promise<unknown>;onConfirmed:(scriptRevisionId?:string,revisionReason?:string)=>void;history?:ReactNode;errorPresented?:boolean;
}
export function WorkspaceScriptPanel({episodeId,scriptRevisionId,script,stage,readOnly,pending,command,onConfirmed,history,errorPresented=false}:Props){
 const draft=useWorkspaceDraft({episodeId,kind:'script',version:scriptRevisionId??'new',initial:{text:script,reason:'',filename:'script.md'},enabled:!readOnly});
 const {text,reason,filename}=draft.value,setText=(text:string)=>draft.setValue(value=>({...value,text})),setReason=(reason:string)=>draft.setValue(value=>({...value,reason})),setFilename=(filename:string)=>draft.setValue(value=>({...value,filename}));
 const [preview,setPreview]=useState(script),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState(!readOnly&&(!scriptRevisionId||stage==='waiting_input')),[confirmation,setConfirmation]=useState<'save'|'discard'|null>(null),[locallyConfirmed,setLocallyConfirmed]=useState(false);
 const [invalid,setInvalid]=useState<'script'|'reason'|null>(null),errorId=useId(),reasonInput=useRef<HTMLInputElement>(null),textInput=useRef<HTMLTextAreaElement>(null);
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{setPreview(script);},[script,scriptRevisionId]);
 const changed=text!==preview,revision=!!scriptRevisionId&&stage!=='waiting_input',disabled=readOnly||pending||busy,isEditing=(editing||draft.dirty)&&!readOnly;
 const scriptInput=workspaceScriptInput(text);
 const baselineStatus=revision||locallyConfirmed?'已确认基准':'待确认';
 const statistics=mainScriptStatistics(isEditing?text:preview),confirmedCharacters=Array.from(preview).length;
 function requestSave(){
  setError('');setInvalid(null);
  if(!text.trim()){setInvalid('script');textInput.current?.focus();return;}
  if(scriptInput.error){setInvalid('script');setError(scriptInput.error);textInput.current?.focus();return;}
  if(scriptRevisionId&&changed&&!reason.trim()){setInvalid('reason');reasonInput.current?.focus();return;}
  if(revision||scriptRevisionId&&changed)setConfirmation('save');else void confirm();
 }
 function discard(){setInvalid(null);draft.reset();setError('');setEditing(false);setConfirmation(null);}
 async function confirm(){
  if(disabled)return;
  const submitted={...draft.value};
  setBusy(true);setError('');
  try{
   let confirmedScriptId=scriptRevisionId??undefined;
   if(!text.trim())throw Error('请填写主脚本。');
   if(!scriptRevisionId){
    const bytes=new TextEncoder().encode(scriptInput.text);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    const registered=await command('importMaterial',{episodeId,materialType:'script',materialPurpose:'main_script',sourceKind:'file',sourcePath:filename,mimeType:'text/markdown',contentBase64:btoa(binary),isMainScript:true}) as {id:string};confirmedScriptId=registered.id;
   }else if(changed){
    if(!reason.trim())throw Error('请填写修订原因。');
    const revised=await command('reconfirmScript',{episodeId,expectedScriptRevisionId:scriptRevisionId,text:scriptInput.text,reason:reason.trim()}) as {id:string};confirmedScriptId=revised.id;
   }
   await command('start',{episodeId});if(draft.acknowledge(submitted,{...submitted,text:scriptInput.text,reason:''})){setPreview(scriptInput.text);setEditing(false);}setLocallyConfirmed(true);setConfirmation(null);onConfirmed(confirmedScriptId,submitted.reason.trim()||undefined);
  }catch(cause){setConfirmation(null);setError(cause instanceof Error?cause.message:'脚本确认未完成。');}finally{setBusy(false);}
 }
 async function readScriptFile(file:File){
  if(disabled||!isEditing)return;
  try{if(!/\.(md|txt)$/i.test(file.name))throw Error('请选择 Markdown 或 TXT 脚本。');if(!file.size||file.size>2*1024*1024)throw Error('脚本不能为空或超过2MB。');setText(await file.text());setInvalid(null);setFilename(file.name);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'脚本读取失败。');}
 }
 return <section className="production-workspace-section workspace-script workspace-script-compact" aria-label="脚本确认">
  <header><div className="workspace-compact-heading"><h3>主脚本</h3><span role="status" className={revision||locallyConfirmed?'is-confirmed':''}>{baselineStatus}{readOnly?' · 只读':''}</span></div></header>

  {draft.storageError&&<p role="alert" className="form-error">本机草稿暂无法保存，请保持此页面打开。</p>}
  <div className="workspace-script-layout">
   <div className="workspace-script-main">
    {draft.restored&&<p role="status" className="workspace-script-restored">已恢复草稿，尚未确认。</p>}
    {isEditing?<div className="workspace-script-comparison">
     <div className="workspace-script-editor">
      <div className="workspace-script-editor-heading"><span>脚本正文</span>{!text.trim()&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{setText(workspaceScriptExample);setError('');setInvalid(null);requestAnimationFrame(()=>textInput.current?.focus());}}>使用示例</Button>}</div>
      <div className="workspace-script-text"><textarea ref={textInput} aria-label="主脚本" aria-required="true" aria-invalid={invalid==='script'||undefined} aria-describedby={invalid==='script'?errorId:undefined} value={text} disabled={pending||busy} onChange={event=>{setText(event.target.value);if(invalid==='script'){setInvalid(null);setError('');}}} placeholder="直接粘贴正文，空行分隔镜头；也可上传 Markdown / TXT 结构化脚本。"/>{invalid==='script'&&<span id={errorId} className="form-error" role="alert">{error||'请填写主脚本。'}</span>}</div>
     </div>
     <section className="workspace-script-shot-preview" aria-label="镜头与字幕预览">
      <header><h4>镜头与字幕预览</h4><span>{scriptInput.shots.length} 个镜头</span></header>
      {scriptInput.error?<p className="workspace-script-preview-message">{text.trim()?scriptInput.error:'填写正文后显示镜头预览。'}</p>:scriptInput.shots.map((shot,index)=><article key={shot.id}><strong>镜头 {String(index+1).padStart(2,'0')}</strong><dl><div><dt>字幕</dt><dd>{shot.subtitle}</dd></div>{shot.visual&&<div><dt>画面说明</dt><dd>{shot.visual}</dd></div>}</dl></article>)}
     </section>
    </div>:<div className="workspace-script-preview" role="document" aria-label="主脚本预览" tabIndex={0}>{preview?<MarkdownPreview content={preview}/>: '正在读取主脚本…'}</div>}
    <div className="workspace-script-statistics" role="group" aria-label="脚本字数"><span title="完整脚本的 Unicode 字符数，包含空白、标点与格式。">脚本字符 {statistics.characters.toLocaleString()}</span><span title={statistics.textKind==='narration'?'仅统计口播字段中的文字和数字，不计空白与标点。':'仅统计正文中的文字和数字，未区分口播与说明。'}>{statistics.textKind==='narration'?'口播字数':'正文文字数'} {statistics.textCharacters===null?'暂无法统计':statistics.textCharacters.toLocaleString()}</span>{isEditing&&changed&&<span>有未确认修改</span>}</div>

   </div>
   <aside className="workspace-script-basis" aria-label="脚本基准">
    <div className="workspace-script-file" onDragOver={event=>{if(isEditing&&!disabled)event.preventDefault();}} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file)void readScriptFile(file);}}>
     <input ref={input} hidden type="file" accept=".md,.txt,text/plain,text/markdown" aria-label="上传主脚本" disabled={disabled||!isEditing} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void readScriptFile(file);}}/>
     {isEditing?<button type="button" className="workspace-script-file-slot" aria-label="上传脚本" disabled={disabled} onClick={()=>input.current?.click()}><FileText size={20} aria-hidden="true"/><span><strong>{filename==='script.md'?'拖入或选择脚本':filename}</strong><small>Markdown / TXT · 最大 2 MB</small></span></button>:<div className="workspace-script-file-slot is-locked"><FileText size={20} aria-hidden="true"/><span><strong>{filename==='script.md'?'主脚本':filename}</strong><small>已确认脚本</small></span></div>}
    </div>
    {(!readOnly||invalid||error&&!errorPresented)&&<div className="workspace-script-controls" role="group" aria-label="脚本操作">
     {!isEditing&&!readOnly&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{setText(preview);setError('');setEditing(true);}}>修改脚本</Button>}
    {isEditing&&scriptRevisionId&&changed&&<label className="workspace-script-reason">修订原因<input ref={reasonInput} aria-label="脚本修订原因" aria-required="true" aria-invalid={invalid==='reason'||undefined} aria-describedby={invalid==='reason'?errorId:undefined} placeholder="简述本次修改原因" value={reason} disabled={disabled} onChange={event=>{setReason(event.target.value);if(invalid==='reason')setInvalid(null);}}/>{invalid==='reason'&&<span id={errorId} className="form-error" role="alert">请填写修订原因。</span>}</label>}
    {isEditing&&<div className="workspace-script-actions"><Button size="sm" color="primary" isDisabled={disabled||!!scriptRevisionId&&!changed&&stage!=='waiting_input'} onPress={requestSave}>{busy?'正在确认…':revision?'确认脚本修订':'确认脚本'}</Button>{(revision||locallyConfirmed)&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>{if(changed||reason.trim())setConfirmation('discard');else discard();}}>取消编辑</Button>}</div>}
    {error&&invalid!=='script'&&!errorPresented&&<p role="alert" className="form-error">{error}</p>}
    </div>}
    <h4>脚本基准</h4>
    <dl><div><dt>基准版本</dt><dd>{scriptRevisionId?.slice(0,8)??'尚无版本'}</dd></div><div><dt>基准字数</dt><dd>{scriptRevisionId||locallyConfirmed?`${confirmedCharacters.toLocaleString()} 字符`:'尚未确认'}</dd></div></dl>
    {scriptRevisionId&&<p className="workspace-script-revision-id" aria-label="脚本基准 ID">{scriptRevisionId}</p>}
    {isEditing&&revision&&<p>修订后需重新核对素材匹配，已有工程与媒体保留。</p>}
    {history}
   </aside>
  </div>
  <ConfirmationModalPresence>{confirmation==='save'&&<ConfirmationModal title="确认脚本修订" confirmLabel="确认保存修订" isPending={busy} pendingLabel="正在保存…" onCancel={()=>setConfirmation(null)} onConfirm={confirm}><p>保存后将更新素材规划；已有剪辑工程保留为历史版本，原媒体不会删除。</p><p>修订原因：{reason.trim()}</p></ConfirmationModal>}</ConfirmationModalPresence>
  <ConfirmationModalPresence>{confirmation==='discard'&&<ConfirmationModal title="放弃脚本修改" confirmLabel="放弃修改" tone="danger" onCancel={()=>setConfirmation(null)} onConfirm={discard}><p>本次未保存的正文与修订原因将被放弃，已确认脚本保持不变。</p></ConfirmationModal>}</ConfirmationModalPresence>
 </section>;
}
