import {FeedbackNotice} from '../ui/FeedbackNotice';
import {uiText} from '../i18n/ui';
import {useEffect,useId,useRef,useState} from 'react';
import {FolderOpen,FolderSearch,SlidersHorizontal} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {localRequest} from './client';
import {parseLogStorageState,type LogStorageState} from '../observability/logTypes';
import './runtime-logs.css';

export function LogStorageSettings({csrf,onStateChange,compact=false}:{csrf:string;compact?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void}){
 const [state,setState]=useState<LogStorageState|null>(null),[path,setPath]=useState(''),[reading,setReading]=useState(true),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const editId=useId(),input=useRef<HTMLInputElement>(null),editButton=useRef<HTMLButtonElement>(null);
 const [editing,setEditing]=useState(!compact),[opened,setOpened]=useState(false);
 useEffect(()=>{if(editing&&compact)input.current?.focus();},[editing,compact]);
 const mounted=useRef(false),busy=useRef(false),read=useRef<AbortController|null>(null);
 const stateChanged=useRef(onStateChange);stateChanged.current=onStateChange;
 const dirty=!!state&&path.trim()!==state.configuredDirectory;
 useEffect(()=>{stateChanged.current?.({busy:pending,dirty});},[pending,dirty]);
 useEffect(()=>()=>stateChanged.current?.({busy:false,dirty:false}),[]);
 async function reload(){if(read.current)return;const controller=new AbortController();read.current=controller;setReading(true);setError('');try{const value=parseLogStorageState(await localRequest('log-storage',{signal:controller.signal}));if(mounted.current){setState(value);setPath(value.configuredDirectory);}}catch(e){if(mounted.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:uiText("日志位置读取失败。"));}finally{if(read.current===controller){read.current=null;if(mounted.current)setReading(false);}}}
 useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false;read.current?.abort();read.current=null;};},[]);
 async function command(command:'choose'|'save'|'open'){
  if(busy.current||reading)return;busy.current=true;setPending(true);setSaved(false);setOpened(false);setError('');
  try{const value=await localRequest('log-storage',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,...(command==='save'?{path:path.trim()}:{})})});if(!mounted.current)return;if(command==='open'){setOpened(true);}else if(command==='choose'){if(!value.cancelled&&typeof value.path==='string')setPath(value.path);}else{const next=parseLogStorageState(value);setState(next);setPath(next.configuredDirectory);setSaved(true);if(compact){setEditing(false);requestAnimationFrame(()=>editButton.current?.focus());}}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:uiText("日志位置保存失败，请重试。"));}
  finally{busy.current=false;if(mounted.current)setPending(false);}
 }
 function cancel(){if(pending||!state)return;setPath(state.configuredDirectory);setEditing(false);setError('');requestAnimationFrame(()=>editButton.current?.focus());}
 const editor=state&&<div id={editId} className="log-storage-editor"><label>{uiText("保存目录")}<InputBase ref={input} size="sm" aria-label={uiText("日志保存目录")} value={path} disabled={pending} onChange={e=>{setPath(e.target.value);setSaved(false);setError('');}}/></label><p className="rl-note">{uiText("新日志在下次启动本机应用时使用新位置；旧日志保留原处。")}</p><div className="log-storage-actions">{compact&&<Button size="sm" color="secondary" type="button" isDisabled={pending} onPress={cancel}>{uiText('取消')}</Button>}<Button size="sm" color="secondary" iconLeading={FolderSearch} type="button" isDisabled={pending} onPress={()=>void command('choose')}>{uiText("选择日志文件夹")}</Button><Button size="sm" color="primary" type="button" isDisabled={pending||!path.trim()||path.trim()===state.configuredDirectory} onPress={()=>void command('save')}>{pending?uiText("处理中…"):uiText("保存日志位置")}</Button></div></div>;
 return <section className="log-storage-settings" aria-label={uiText("日志存储位置")}><h3>{uiText("日志存储位置")}</h3>{reading?<p role="status">{uiText("正在读取日志位置…")}</p>:state?<>
  {compact&&<div className="log-storage-location"><span className="log-storage-path">{state.configuredDirectory}</span><div><Button size="sm" color="secondary" iconLeading={FolderOpen} isDisabled={pending} onPress={()=>void command('open')}>{uiText('打开日志文件夹')}</Button><Button ref={editButton} size="sm" color="secondary" iconLeading={SlidersHorizontal} aria-label={uiText('修改日志位置')} aria-expanded={editing} aria-controls={editing?editId:undefined} isDisabled={pending} onPress={()=>editing?cancel():setEditing(true)}>{uiText('修改')}</Button></div></div>}
  {editing&&editor}
  {state.pending&&<p className="rl-note">{uiText('当前写入位置：{path}',{path:state.activeDirectory})}</p>}{state.warning&&<p role="alert" className="form-error">{uiText(state.warning)}</p>}{saved&&<FeedbackNotice message={state.pending?"日志位置已保存，下次启动生效。":"日志位置已保存。"} onDismiss={()=>setSaved(false)}/>} {opened&&<FeedbackNotice message="已打开日志文件夹。" onDismiss={()=>setOpened(false)}/>}</>:null}{error&&<div><p role="alert" className="form-error">{uiText(error)}</p>{!state&&<Button size="sm" color="secondary" type="button" onPress={()=>void reload()}>{uiText("重新读取日志位置")}</Button>}</div>}</section>;
}
