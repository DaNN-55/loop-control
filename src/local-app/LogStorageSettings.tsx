import {uiText} from '../i18n/ui';
import {useEffect,useRef,useState} from 'react';
import {FolderSearch} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {localRequest} from './client';
import {parseLogStorageState,type LogStorageState} from '../observability/logTypes';
import './runtime-logs.css';

export function LogStorageSettings({csrf,onStateChange}:{csrf:string;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void}){
 const [state,setState]=useState<LogStorageState|null>(null),[path,setPath]=useState(''),[reading,setReading]=useState(true),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const mounted=useRef(false),busy=useRef(false),read=useRef<AbortController|null>(null);
 const stateChanged=useRef(onStateChange);stateChanged.current=onStateChange;
 const dirty=!!state&&path.trim()!==state.configuredDirectory;
 useEffect(()=>{stateChanged.current?.({busy:pending,dirty});},[pending,dirty]);
 useEffect(()=>()=>stateChanged.current?.({busy:false,dirty:false}),[]);
 async function reload(){if(read.current)return;const controller=new AbortController();read.current=controller;setReading(true);setError('');try{const value=parseLogStorageState(await localRequest('log-storage',{signal:controller.signal}));if(mounted.current){setState(value);setPath(value.configuredDirectory);}}catch(e){if(mounted.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:uiText("日志位置读取失败。"));}finally{if(read.current===controller){read.current=null;if(mounted.current)setReading(false);}}}
 useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false;read.current?.abort();read.current=null;};},[]);
 async function command(command:'choose'|'save'){
  if(busy.current||reading)return;busy.current=true;setPending(true);setSaved(false);setError('');
  try{const value=await localRequest('log-storage',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({command,...(command==='save'?{path:path.trim()}:{})})});if(!mounted.current)return;if(command==='choose'){if(!value.cancelled&&typeof value.path==='string')setPath(value.path);}else{const next=parseLogStorageState(value);setState(next);setPath(next.configuredDirectory);setSaved(true);}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:uiText("日志位置保存失败，请重试。"));}
  finally{busy.current=false;if(mounted.current)setPending(false);}
 }
 return <section className="log-storage-settings" aria-label={uiText("日志存储位置")}><h3>{uiText("日志存储位置")}</h3>{reading?<p role="status">{uiText("正在读取日志位置…")}</p>:state?<><label>{uiText("保存目录")}<InputBase size="sm" aria-label={uiText("日志保存目录")} value={path} disabled={pending} onChange={e=>{setPath(e.target.value);setSaved(false);setError('');}}/></label><div className="log-storage-actions"><Button size="sm" color="secondary" iconLeading={FolderSearch} type="button" isDisabled={pending} onPress={()=>void command('choose')}>{uiText("选择日志文件夹")}</Button><Button size="sm" color="primary" type="button" isDisabled={pending||!path.trim()||path.trim()===state.configuredDirectory} onPress={()=>void command('save')}>{pending?uiText("处理中…"):uiText("保存日志位置")}</Button></div><p className="rl-note">{uiText("新日志在下次启动本机应用时使用新位置；旧日志保留原处。")}</p>{state.pending&&<p className="rl-note">{uiText('当前写入位置：{path}',{path:state.activeDirectory})}</p>}{state.warning&&<p role="alert" className="form-error">{uiText(state.warning)}</p>}{saved&&<p role="status">{state.pending?uiText("日志位置已保存，下次启动生效。"):uiText("日志位置已保存。")}</p>}</>:null}{error&&<div><p role="alert" className="form-error">{uiText(error)}</p>{!state&&<Button size="sm" color="secondary" type="button" onPress={()=>void reload()}>{uiText("重新读取日志位置")}</Button>}</div>}</section>;
}
