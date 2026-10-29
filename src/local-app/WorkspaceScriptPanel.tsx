import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';

interface Props {
 episodeId:string;scriptRevisionId:string|null;script:string;stage:string;readOnly:boolean;pending:boolean;
 command:(name:string,data:unknown)=>Promise<unknown>;onConfirmed:()=>void;
}
export function WorkspaceScriptPanel({episodeId,scriptRevisionId,script,stage,readOnly,pending,command,onConfirmed}:Props){
 const [text,setText]=useState(script),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[filename,setFilename]=useState('script.md');
 const baseline=useRef(script),previous=useRef(scriptRevisionId),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(previous.current!==scriptRevisionId||text===baseline.current){setText(script);baseline.current=script;previous.current=scriptRevisionId;}},[script,scriptRevisionId]);
 const changed=text!==script,revision=!!scriptRevisionId&&stage!=='waiting_input',disabled=readOnly||pending||busy;
 async function confirm(){
  setBusy(true);setError('');
  try{
   if(!text.trim())throw Error('请填写主脚本。');
   if(!scriptRevisionId){
    const bytes=new TextEncoder().encode(text);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    await command('importMaterial',{episodeId,materialType:'script',materialPurpose:'main_script',sourceKind:'file',sourcePath:filename,mimeType:'text/markdown',contentBase64:btoa(binary),isMainScript:true});
   }else if(changed){
    if(!reason.trim())throw Error('请填写修订原因。');
    await command('reconfirmScript',{episodeId,expectedScriptRevisionId:scriptRevisionId,text,reason:reason.trim()});
   }
   await command('start',{episodeId});setReason('');onConfirmed();
  }catch(cause){setError(cause instanceof Error?cause.message:'脚本确认未完成。');}finally{setBusy(false);}
 }
 return <section className="production-workspace-section workspace-script" aria-label="脚本确认">
  <header><h3>主脚本</h3><div>{scriptRevisionId&&<span role="status">{stage==='waiting_input'?'待确认':'已确认基准'}</span>}<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>input.current?.click()}>上传脚本</Button></div></header>
  <input ref={input} hidden type="file" accept=".md,.txt,text/plain,text/markdown" aria-label="上传主脚本" disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;void(async()=>{try{if(!file.size||file.size>2*1024*1024)throw Error('脚本不能为空或超过2MB。');setText(await file.text());setFilename(file.name);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'脚本读取失败。');}})();}}/>
  <label className="workspace-script-text">主脚本<textarea aria-label="主脚本" value={text} readOnly={readOnly} disabled={pending||busy} onChange={event=>setText(event.target.value)} placeholder="粘贴脚本，或上传 Markdown / TXT"/></label>
  {scriptRevisionId&&changed&&<label className="workspace-script-reason">修订原因<input aria-label="脚本修订原因" value={reason} disabled={disabled} onChange={event=>setReason(event.target.value)}/></label>}
  {!readOnly&&<div className="workspace-script-actions"><Button size="sm" color="primary" isDisabled={disabled||!text.trim()||!!scriptRevisionId&&!changed&&stage!=='waiting_input'} onPress={()=>void confirm()}>{busy?'正在确认…':revision?'确认脚本修订':'确认脚本'}</Button></div>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
