import {uiText} from '../i18n/ui';
import {useState,useEffect,useRef,useCallback} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localCommand,localRequest} from './client';
import './deletion-cleanup.css';
interface PendingCleanup{cleanupKey:string;title:string;path:string;paths?:string[];stagingPath?:string;stagingPaths?:string[];phase?:string;message?:string;}
interface RecoveryProps{revision:unknown;targetKey?:string;onResolved?:(key:string)=>void;onChanged?:()=>void;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;}
export function LocalDeletionRecovery({revision,targetKey='',onResolved,onChanged,onStateChange}:RecoveryProps){
 const[items,setItems]=useState<PendingCleanup[]|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[messages,setMessages]=useState<Record<string,string>>({}),[pending,setPending]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{onStateChange?.({busy:!!pending,dirty:false});return()=>onStateChange?.({busy:false,dirty:false});},[pending,onStateChange]);
 const mounted=useRef(false),generation=useRef(0),busy=useRef(false),focused=useRef(''),list=useRef<HTMLDivElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 const refresh=useCallback(async()=>{
  const request=++generation.current;setLoading(true);setError('');
  try{const next:PendingCleanup[]=await localRequest('deletion-cleanups');if(mounted.current&&request===generation.current)setItems(next);}
  catch(reason){if(mounted.current&&request===generation.current)setError(reason instanceof Error?reason.message:uiText("无法读取清理任务，请重试。"));}
  finally{if(mounted.current&&request===generation.current)setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[revision,refresh]);
 useEffect(()=>{
  if(!targetKey){focused.current='';return;}
  if(focused.current===targetKey||!items?.some(item=>item.cleanupKey===targetKey))return;
  const target=Array.from(list.current?.querySelectorAll<HTMLElement>('[data-cleanup-key]')??[]).find(element=>element.dataset.cleanupKey===targetKey);
  target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'nearest'});focused.current=targetKey;
 },[items,targetKey]);
 async function retry(item:PendingCleanup){
  if(busy.current)return;busy.current=true;setPending(item.cleanupKey);setNotice('');setMessages(current=>({...current,[item.cleanupKey]:''}));
  try{
   const result=await localCommand<{cleanupPending:boolean;recovered?:boolean;message?:string}>('retryDeletionCleanup',{deletionKey:item.cleanupKey},undefined,'episode-lifecycle');
   if(!result.cleanupPending){onResolved?.(item.cleanupKey);onChanged?.();}
   if(!mounted.current)return;
   if(result.cleanupPending)setMessages(current=>({...current,[item.cleanupKey]:result.message??uiText("文件处理尚未完成，请检查原位置后重试。")}));
   else{setItems(current=>current?.filter(row=>row.cleanupKey!==item.cleanupKey)??[]);setNotice(result.recovered?uiText("文件已恢复，请重新核对后再删除。"):uiText("文件清理已完成。"));}
   await refresh();
  }catch(reason){if(mounted.current)setMessages(current=>({...current,[item.cleanupKey]:reason instanceof Error?reason.message:uiText("处理未确认完成，请重新读取任务后再试。")}));}
  finally{busy.current=false;if(mounted.current)setPending('');}
 }
 return <section className="deletion-cleanup-panel" aria-label={uiText("待处理的文件清理")}>
  {notice&&<p role="status" className="deletion-cleanup-success">{uiText(notice)}</p>}
  {error&&<p role="alert" className="deletion-cleanup-error">{uiText(error)}</p>}
  {items===null&&loading&&<p role="status">{uiText("正在读取清理任务…")}</p>}
  {items?.length===0&&!error&&!notice&&<p className="deletion-cleanup-empty">{uiText("暂无待处理任务。")}</p>}
  {targetKey&&items&&!loading&&!error&&!items.some(item=>item.cleanupKey===targetKey)&&<p role="status">{uiText("该任务当前不在待处理列表中。")}</p>}
  <div ref={list}>{items?.map(item=>{
   const prepared=item.phase==='prepared';
   const message=messages[item.cleanupKey]||(prepared&&item.message==='删除尚未提交，可恢复已暂存的文件。'?'':item.message);
   return <article className="deletion-cleanup-task" data-cleanup-key={item.cleanupKey} data-targeted={item.cleanupKey===targetKey||undefined} tabIndex={-1} key={item.cleanupKey} aria-label={item.title||uiText("未命名生产单")}>
    <header><div><h3>{item.title||uiText("未命名生产单")}</h3><span>{prepared?uiText("删除未生效"):uiText("记录已删除")}</span></div><Button size="sm" color="secondary" isDisabled={!!pending||loading} isLoading={pending===item.cleanupKey} showTextWhileLoading onPress={()=>void retry(item)}>{pending===item.cleanupKey?(prepared?uiText("恢复中…"):uiText("清理中…")):prepared?uiText("恢复文件"):uiText("继续清理")}</Button></header>
    {message&&<p role={messages[item.cleanupKey]?'alert':undefined}>{uiText(message)}</p>}
    <details><summary>{uiText("查看位置")}</summary><dl><dt>{uiText("原位置")}</dt><dd>{(item.paths??[item.path]).map(path=><code key={path}>{path}</code>)}</dd><dt>{uiText("暂存位置")}</dt><dd>{(item.stagingPaths??(item.stagingPath?[item.stagingPath]:[])).map(path=><code key={path}>{path}</code>)}</dd></dl></details>
   </article>;
  })}</div>
  <div className="deletion-cleanup-toolbar"><Button size="sm" color="tertiary" aria-label={uiText("刷新清理任务")} isDisabled={loading||!!pending} onPress={()=>void refresh()}>{uiText("刷新")}</Button></div>
 </section>;
}
