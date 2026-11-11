import {ArrowLeft,Copy,Eye,RefreshCw} from 'lucide-react';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {localRequest} from './client';
import type {SecretMetadata} from './secretAdministrationTypes';
import './SecretDetailPane.css';

export interface SecretDetailPaneProps {
 reference:string;csrf?:string;initialAction?:'view'|'copy'|null;onBack:()=>void;
 onOpenConnection?:(id:string)=>void;onStateChange?:(busy:boolean)=>void;
 expectedConnectionId?:string;expectedVersion?:number;hideHeading?:boolean;
}
export function SecretDetailPane({reference,csrf,initialAction=null,onBack,onOpenConnection,onStateChange,expectedConnectionId,expectedVersion,hideHeading=false}:SecretDetailPaneProps){
 const id=useId(),generation=useRef(0),detailGeneration=useRef(0),request=useRef<AbortController|null>(null),passwordInput=useRef<HTMLInputElement>(null);
 const [selected,setSelected]=useState<SecretMetadata|null>(null),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[error,setError]=useState('');
 const [action,setAction]=useState<'view'|'copy'|null>(null),[password,setPassword]=useState(''),[plain,setPlain]=useState(''),[expiresAt,setExpiresAt]=useState(0),[remaining,setRemaining]=useState(0),[busy,setBusy]=useState(false),[verificationError,setVerificationError]=useState(''),[notice,setNotice]=useState('');
 const busyChange=useRef(onStateChange);busyChange.current=onStateChange;
 function clearSensitive(){generation.current++;request.current?.abort();request.current=null;setAction(null);setPassword('');setPlain('');setExpiresAt(0);setVerificationError('');setBusy(false);}
 useEffect(()=>{busyChange.current?.(busy);},[busy]);
 useEffect(()=>{
  const clear=()=>clearSensitive();document.addEventListener('visibilitychange',clear);window.addEventListener('pagehide',clear);window.addEventListener('loop-local-session-expired',clear);
  return()=>{generation.current++;request.current?.abort();busyChange.current?.(false);document.removeEventListener('visibilitychange',clear);window.removeEventListener('pagehide',clear);window.removeEventListener('loop-local-session-expired',clear);};
 },[]);
 useEffect(()=>{
  clearSensitive();setSelected(null);setLoading(true);setError('');setNotice('');
  const current=++detailGeneration.current,actionGeneration=generation.current,controller=new AbortController();
  void localRequest('secrets/detail?'+new URLSearchParams({reference}),{signal:controller.signal,cache:'no-store'}).then(value=>{
   if(current!==detailGeneration.current)return;
   const item:SecretMetadata=value.item;
   if(item.reference!==reference||((expectedConnectionId!==undefined||expectedVersion!==undefined)&&!item.connections.some(connection=>(expectedConnectionId===undefined||connection.connectionId===expectedConnectionId)&&(expectedVersion===undefined||connection.version===expectedVersion))))throw Error(uiText('密钥引用已变化，请返回连接重新选择。'));
   setSelected(item);if(actionGeneration===generation.current&&!document.hidden&&initialAction&&item.revealAllowed&&item.category!=='system')setAction(initialAction);
  }).catch(e=>{if(current===detailGeneration.current)setError(e instanceof Error&&e.message===uiText('密钥引用已变化，请返回连接重新选择。')?e.message:uiText('密钥详情读取失败，请重试。'));}).finally(()=>{if(current===detailGeneration.current)setLoading(false);});
  return()=>{detailGeneration.current++;controller.abort();};
 },[reference,expectedConnectionId,expectedVersion,initialAction,retry]);
 useEffect(()=>{if(!plain&&!action)return;const timer=setTimeout(()=>{clearSensitive();setNotice(uiText('敏感内容已清除。'));},plain?Math.max(0,Math.min(30000,expiresAt-Date.now())):30000);return()=>clearTimeout(timer);},[plain,action,expiresAt]);
 useEffect(()=>{if(!plain)return;const update=()=>setRemaining(Math.max(0,Math.ceil((expiresAt-Date.now())/1000)));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[plain,expiresAt]);
 function start(next:'view'|'copy'){clearSensitive();setNotice('');setAction(next);}
 async function reveal(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!selected?.revealAllowed||selected.category==='system'||!action||busy||!password)return;
  const requestedAction=action,current=++generation.current,controller=new AbortController();request.current?.abort();request.current=controller;
  let verification=password;setPassword('');setPlain('');setVerificationError('');setNotice('');setBusy(true);
  try{
   const pending=localRequest('secrets/reveal',{method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:JSON.stringify({reference:selected.reference,password:verification,action:requestedAction})});verification='';
   const value=await pending;if(current!==generation.current||document.hidden)return;
   const expiry=Date.parse(value.expiresAt);if(typeof value.value!=='string'||!Number.isFinite(expiry)||expiry<=Date.now())throw Error(uiText('读取已过期，请重新验证。'));
   if(requestedAction==='copy'){
    if(!navigator.clipboard?.writeText)throw Error(uiText('浏览器剪贴板不可用，请选择查看后手动复制。'));
    await navigator.clipboard.writeText(value.value);if(current===generation.current&&!document.hidden){setAction(null);setNotice(uiText('已复制所选密钥。'));}
   }else{setAction(null);setExpiresAt(Math.min(expiry,Date.now()+30000));setPlain(value.value);}
  }catch(e){if(current===generation.current)setVerificationError(e instanceof Error?e.message:uiText('密钥读取失败。'));}
  finally{verification='';if(current===generation.current){setBusy(false);requestAnimationFrame(()=>{if(current===generation.current)passwordInput.current?.focus();});}}
 }
 const revealAllowed=!!selected?.revealAllowed&&selected.category!=='system';
 const currentConnections=selected?.connections.filter(connection=>connection.current&&!connection.revoked)||[];
 const name=selected?.names[0]||uiText('密钥详情');
 return <section className="secret-detail-pane" aria-label={uiText('密钥详情')} aria-busy={loading}>
  {!hideHeading&&<header className="secret-detail-heading"><Button size="sm" color="tertiary" iconLeading={ArrowLeft} aria-label={uiText('返回密钥列表')} onPress={()=>{clearSensitive();onBack();}}/><div><h3 title={name}>{selected?.category==='system'?uiText(name):name}</h3>{selected&&<p>{/^当前连接[:：]/.test(selected.purpose)?uiText('当前连接')+' · '+selected.purpose.replace(/^当前连接[:：]\s*/,''):uiText(selected.purpose)}</p>}</div></header>}
  <div className="secret-detail-body">
   {loading&&<p role="status">{uiText('正在读取详情…')}</p>}
   {error&&<div className="secret-detail-error"><p role="alert" className="form-error">{error}</p><Button size="sm" color="secondary" iconLeading={RefreshCw} onPress={()=>setRetry(value=>value+1)}>{uiText('重试')}</Button></div>}
   {selected&&<><dl className="secret-detail-metadata"><div><dt>{uiText('引用编号')}</dt><dd><code>{selected.reference}</code></dd></div>{currentConnections.length>0&&<div><dt>{uiText('当前连接')}</dt><dd>{currentConnections.map(connection=>`${connection.name} · ${connection.provider} · v${connection.version}`).join('；')}</dd></div>}{selected.pendingUses.length>0&&<div><dt>{uiText('待恢复操作')}</dt><dd>{selected.pendingUses.join('；')}</dd></div>}<div><dt>{uiText('状态')}</dt><dd>{uiText(selected.state)}</dd></div></dl>
    <details className="secret-detail-more"><summary>{uiText('历史与技术信息')}</summary><dl className="secret-detail-metadata">{selected.names.length>1&&<div><dt>{uiText('其他名称')}</dt><dd>{selected.names.slice(1).join('、')}</dd></div>}{selected.runtimeUses.length>0&&<div><dt>{uiText('运行用途')}</dt><dd>{selected.runtimeUses.join('；')}</dd></div>}{selected.aliases.length>0&&<div><dt>{uiText('历史引用别名')}</dt><dd>{selected.aliases.map(alias=><code className="secret-detail-path" key={alias}>{alias}</code>)}</dd></div>}{selected.connections.some(connection=>!connection.current||connection.revoked)&&<div><dt>{uiText('连接历史')}</dt><dd>{selected.connections.filter(connection=>!connection.current||connection.revoked).map(connection=>`${connection.name} · ${connection.provider} · v${connection.version}${connection.revoked?uiText(' · 已撤销'):''}`).join('；')}</dd></div>}{(selected.history.metadataOccurrences>0||selected.history.fileOccurrences>0||selected.history.files.length>0)&&<div><dt>{uiText('历史还原')}</dt><dd>{uiText('元数据')}{selected.history.metadataOccurrences} {uiText('处 · 文件')}{selected.history.fileOccurrences} {uiText('项')}{selected.history.files.map(path=><small className="secret-detail-path" key={path}>{path}</small>)}</dd></div>}</dl></details>
    {!revealAllowed&&<p className="secret-detail-note">{uiText('系统控制密钥仅展示用途与状态，不提供网页读取。')}</p>}
    {revealAllowed&&action&&<form id={id+'-verify'} aria-label={uiText('验证管理员身份')} className="secret-detail-verification" onSubmit={reveal}><label htmlFor={id+'-password'}>{uiText('当前登录密码')}</label><InputBase size="sm" id={id+'-password'} ref={passwordInput} autoFocus autoComplete="current-password" type="password" aria-label={uiText('当前登录密码')} aria-describedby={[id+'-purpose',verificationError?id+'-error':null].filter(Boolean).join(' ')} aria-invalid={!!verificationError||undefined} isInvalid={!!verificationError} maxLength={1024} isRequired value={password} onChange={event=>{setPassword(event.target.value);setVerificationError('');}} isDisabled={busy}/><p id={id+'-purpose'}>{uiText('使用当前登录密码验证本机身份，仅用于此次查看或复制。')}</p>{verificationError&&<p id={id+'-error'} role="alert" className="form-error">{verificationError}</p>}</form>}
    {plain&&<div className="secret-detail-plaintext"><div><span>{remaining} {uiText('秒后自动隐藏')}</span><Button size="xs" color="secondary" onPress={clearSensitive}>{uiText('立即隐藏')}</Button></div><pre aria-label={uiText('密钥明文')}>{plain}</pre></div>}
    {notice&&<p role="status" className="secret-detail-notice">{notice}</p>}
   </>}
  </div>
  <footer className="secret-detail-footer"><div>{selected&&onOpenConnection&&currentConnections.map(connection=><Button key={connection.connectionId} size="sm" color="secondary" onPress={()=>{clearSensitive();onOpenConnection(connection.connectionId);}}>{currentConnections.length>1?uiText('前往「{name}」连接更换密钥',{name:connection.name}):uiText('前往连接更换密钥')}</Button>)}</div><div>{revealAllowed&&(action?<><Button size="sm" color="secondary" onPress={clearSensitive}>{uiText('取消')}</Button><Button size="sm" color="primary" type="submit" form={id+'-verify'} isDisabled={busy||!password}>{busy?uiText('正在验证…'):action==='copy'?uiText('验证并复制'):uiText('验证并查看')}</Button></>:!plain?<><Button size="sm" color="secondary" iconLeading={Copy} aria-label={uiText('复制密钥：{value1}',{value1:name})} onPress={()=>start('copy')}>{uiText('复制')}</Button><Button size="sm" color="primary" iconLeading={Eye} aria-label={uiText('查看密钥：{value1}',{value1:name})} onPress={()=>start('view')}>{uiText('查看')}</Button></>:null)}</div></footer>
 </section>;
}
