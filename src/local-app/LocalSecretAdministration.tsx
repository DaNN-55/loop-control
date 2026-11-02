import {ChevronRight,HelpCircle,RefreshCw,X} from 'lucide-react';
import {PopulatedFilterSelect} from '../ui/PopulatedFilterSelect';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Fragment,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import type {SecretCategory,SecretList,SecretMetadata} from './secretAdministrationTypes';
import './secret-management.css';

const categories:Record<SecretCategory,string>={system:'系统控制',connection:'连接使用',history:'历史还原',unreferenced:'未发现引用'};
export function LocalSecretAdministration({csrf,onClose}:{csrf:string;onClose:()=>void}){
 const id=useId(),dialog=useDialogFocus<HTMLElement>(true,()=>{clearSensitive();onClose();});
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const [expanded,setExpanded]=useState<string|null>(null),[help,setHelp]=useState(false);
 const [list,setList]=useState<SecretList|null>(null),[selected,setSelected]=useState<SecretMetadata|null>(null);
 const [action,setAction]=useState<'view'|'copy'|null>(null),[password,setPassword]=useState(''),[plain,setPlain]=useState(''),[expiresAt,setExpiresAt]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const passwordInput=useRef<HTMLInputElement>(null);
 const [verificationError,setVerificationError]=useState('');
 const generation=useRef(0),sensitiveRequest=useRef<AbortController|null>(null);
 function clearSensitive(){generation.current++;sensitiveRequest.current?.abort();sensitiveRequest.current=null;setPassword('');setVerificationError('');setPlain('');setExpiresAt(0);setAction(null);setBusy(false);}
 useEffect(()=>{
  const clear=()=>clearSensitive();
  document.addEventListener('visibilitychange',clear);window.addEventListener('pagehide',clear);window.addEventListener('loop-local-session-expired',clear);
  return()=>{generation.current++;sensitiveRequest.current?.abort();document.removeEventListener('visibilitychange',clear);window.removeEventListener('pagehide',clear);window.removeEventListener('loop-local-session-expired',clear);};
 },[]);
 useEffect(()=>{if(!plain&&!action)return;const timer=setTimeout(()=>{clearSensitive();setNotice('敏感内容已清除。');},plain?Math.max(0,Math.min(30000,expiresAt-Date.now())):30000);return()=>clearTimeout(timer);},[plain,action,expiresAt]);
 useEffect(()=>{
  const controller=new AbortController();let active=true;setLoading(true);setError('');setSelected(null);setExpanded(null);
  const timer=setTimeout(()=>{void localRequest('secrets?'+new URLSearchParams({q:query,category,page:String(page)}),{signal:controller.signal,cache:'no-store'}).then(value=>{if(active)setList(value);}).catch(()=>{if(active){setList(null);setError('密钥列表读取失败，请检查会话和本机服务。');}}).finally(()=>{if(active)setLoading(false);});},250);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[query,category,page,refresh]);
 async function select(reference:string,nextAction:'view'|'copy'|null=null){
  clearSensitive();setError('');setNotice('');setSelected(null);setExpanded(reference);const current=generation.current,controller=new AbortController();sensitiveRequest.current=controller;
  try{const value=await localRequest('secrets/detail?'+new URLSearchParams({reference}),{signal:controller.signal,cache:'no-store'});if(current===generation.current){setSelected(value.item);if(nextAction&&value.item.revealAllowed)setAction(nextAction);}}
  catch{if(current===generation.current){setExpanded(null);setError('密钥详情读取失败，请重试。');}}
 }
 async function reveal(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!selected||!action||busy)return;
  const reference=selected.reference,requestedAction=action,current=++generation.current,controller=new AbortController();sensitiveRequest.current?.abort();sensitiveRequest.current=controller;
  let verification=password;setPassword('');setPlain('');setError('');setVerificationError('');setNotice('');setBusy(true);
  try{
   const request=localRequest('secrets/reveal',{method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({reference,password:verification,action:requestedAction})});verification='';
   const value=await request;if(current!==generation.current||document.hidden)return;
   if(typeof value.value!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())throw Error('读取已过期，请重新验证。');
   if(requestedAction==='copy'){
    if(!navigator.clipboard?.writeText)throw Error('浏览器剪贴板不可用，请选择查看后手动复制。');
    await navigator.clipboard.writeText(value.value);
    if(current===generation.current){setAction(null);setNotice('已复制所选密钥。');}
   }else{setAction(null);setExpiresAt(Date.parse(value.expiresAt));setPlain(value.value);}
  }catch(e){if(current===generation.current){setVerificationError(e instanceof Error?e.message:'密钥读取失败。');}}
  finally{verification='';if(current===generation.current){setBusy(false);requestAnimationFrame(()=>{if(current===generation.current){passwordInput.current?.focus();passwordInput.current?.closest('form')?.scrollIntoView?.({block:'nearest'});}});}}
 }
 function change(){clearSensitive();setSelected(null);setExpanded(null);setNotice('');setError('');}
 return <div className="modal-backdrop" role="presentation"><section aria-labelledby={id+'-title'} aria-modal="true" className="modal-card secret-table-modal" ref={dialog} role="dialog">
  <header className="secret-table-heading"><h2 id={id+'-title'}>密钥管理</h2><div><Button size="sm" color="tertiary" iconLeading={HelpCircle} aria-label="密钥管理帮助" aria-expanded={help} aria-controls={id+'-help'} onClick={()=>setHelp(!help)}/><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label="刷新密钥列表" isDisabled={loading||busy} onClick={()=>{change();setRefresh(v=>v+1);}}/><Button size="sm" color="tertiary" iconLeading={X} aria-label="关闭密钥管理" onClick={()=>{clearSensitive();onClose();}}/></div></header>
  {help&&<div id={id+'-help'} className="secret-table-help"><p>查看、复制需验证当前登录密码，明文最多显示 30 秒。</p><p>引用编号用于定位 Keychain 条目，不能作为 API Key 使用。系统控制密钥仅展示用途；未发现引用不代表可以删除。</p></div>}
  <div className="secret-table-toolbar"><InputBase size="sm" aria-label="搜索密钥" type="search" maxLength={200} placeholder="搜索名称、用途或引用编号" value={query} onChange={e=>{change();setQuery(e.target.value);setPage(1);}}/><PopulatedFilterSelect size="sm" aria-label="分类" disabled={loading} counts={list?.categoryCounts} allValue="all" value={category} onValueChange={value=>{change();setCategory(value);setPage(1);}} options={[{value:'all',label:'全部分类'},...Object.entries(categories).map(([value,label])=>({value,label}))]}/></div>
  <div className="secret-table-notices">{error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}</div>
  <div className="secret-table-scroll" aria-busy={loading}><table aria-label="密钥列表"><caption className="secret-table-order">同名密钥：当前优先，历史版本倒序。</caption><colgroup><col className="secret-name-column"/><col className="secret-purpose-column"/><col className="secret-category-column"/><col className="secret-action-column"/></colgroup><thead><tr><th scope="col">名称</th><th scope="col">关联用途</th><th scope="col">分类</th><th scope="col">操作</th></tr></thead><tbody>
   {loading&&Array.from({length:list?Math.min(10,Math.max(1,list.items.length)):5},(_,index)=><tr className="secret-table-row secret-skeleton-row" aria-hidden="true" key={index}><td><span className="secret-skeleton secret-skeleton-name"/></td><td><span className="secret-skeleton secret-skeleton-purpose"/></td><td><span className="secret-skeleton secret-skeleton-category"/></td><td><div className="secret-row-actions"><span className="secret-skeleton secret-skeleton-action"/><span className="secret-skeleton secret-skeleton-action"/></div></td></tr>)}
   {!loading&&list?.items.map((item,index)=>{
    const open=expanded===item.reference,currentUses=item.connections.filter(c=>c.current&&!c.revoked),current=currentUses.length>0,purpose=currentUses.length===1&&item.names[0]===currentUses[0].name?currentUses[0].provider:item.purpose.replace(/^当前连接[:：]\s*/,''),versions=[...new Set(item.connections.map(c=>c.version))],detailId=id+'-detail-'+index;
    return <Fragment key={item.reference}><tr className="secret-table-row" data-expanded={open||undefined}><td><button className="secret-name-button" type="button" aria-expanded={open} aria-controls={open?detailId:undefined} onClick={()=>{if(open)change();else void select(item.reference);}}><ChevronRight size={14} aria-hidden="true"/><strong title={item.names[0]}>{item.names[0]}</strong>{versions.length===1&&<small>v{versions[0]}</small>}</button></td><td><div className="secret-purpose-cell">{current&&<span className="secret-current-label">当前</span>}<span title={item.purpose}>{purpose}</span></div></td><td>{categories[item.category]}</td><td>{item.revealAllowed?<div className="secret-row-actions"><Button size="xs" color="tertiary" aria-label={`查看密钥：${item.names[0]}（${item.reference}）`} isDisabled={busy} onClick={()=>void select(item.reference,'view')}>查看</Button><Button size="xs" color="tertiary" aria-label={`复制密钥：${item.names[0]}（${item.reference}）`} isDisabled={busy} onClick={()=>void select(item.reference,'copy')}>复制</Button></div>:<span className="secret-purpose-only">仅查看用途</span>}</td></tr>
    {open&&<tr className="secret-table-detail-row"><td colSpan={4}><section className="secret-inline-detail" id={detailId} aria-label="密钥详情">
     {!selected?<p role="status">正在读取详情…</p>:<><dl className="secret-inline-metadata"><div><dt>引用编号</dt><dd><code>{selected.reference}</code></dd></div>{selected.connections.some(c=>c.current&&!c.revoked)&&<div><dt>当前连接</dt><dd>{selected.connections.filter(c=>c.current&&!c.revoked).map(c=>`${c.name} · ${c.provider} · v${c.version}`).join('；')}</dd></div>}{selected.pendingUses.length>0&&<div><dt>待恢复操作</dt><dd>{selected.pendingUses.join('；')}</dd></div>}</dl>
      <details className="secret-inline-more"><summary>历史与技术信息</summary><dl className="secret-inline-metadata">{selected.names.length>1&&<div><dt>其他名称</dt><dd>{selected.names.slice(1).join('、')}</dd></div>}{selected.runtimeUses.length>0&&<div><dt>运行用途</dt><dd>{selected.runtimeUses.join('；')}</dd></div>}{selected.aliases.length>0&&<div><dt>历史引用别名</dt><dd>{selected.aliases.map(alias=><code key={alias}>{alias}<br/></code>)}</dd></div>}{selected.connections.some(c=>!c.current||c.revoked)&&<div><dt>连接历史</dt><dd>{selected.connections.filter(c=>!c.current||c.revoked).map(c=>`${c.name} · ${c.provider} · v${c.version}${c.revoked?' · 已撤销':''}`).join('；')}</dd></div>}{(selected.history.metadataOccurrences>0||selected.history.fileOccurrences>0||selected.history.files.length>0)&&<div><dt>历史还原</dt><dd>元数据 {selected.history.metadataOccurrences} 处 · 文件 {selected.history.fileOccurrences} 项{selected.history.files.map(path=><small className="secret-file-path" key={path}>{path}</small>)}</dd></div>}<div><dt>状态</dt><dd>{selected.state}</dd></div></dl></details>
      {!selected.revealAllowed&&<p className="secret-inline-note">系统控制密钥仅展示用途与状态，不提供网页读取。</p>}
      {selected.revealAllowed&&action&&<form aria-label="验证管理员身份" className="secret-verification" onSubmit={reveal}><label>{action==='copy'?'复制密钥':'查看密钥'}<span className="secret-password-label">当前登录密码</span><InputBase size="sm" ref={passwordInput} autoFocus autoComplete="current-password" type="password" aria-label="当前登录密码" aria-describedby={[id+'-verify-purpose',verificationError?id+'-verify-error':null].filter(Boolean).join(' ')} aria-invalid={!!verificationError||undefined} isInvalid={!!verificationError} maxLength={1024} isRequired value={password} onChange={e=>{setPassword(e.target.value);setVerificationError('');}} isDisabled={busy}/><span id={id+'-verify-purpose'} className="secret-verification-purpose">使用当前登录密码验证本机身份，仅用于此次查看或复制。</span>{verificationError&&<span id={id+'-verify-error'} role="alert" className="form-error">{verificationError}</span>}</label><div className="secret-verification-actions"><Button size="sm" color="primary" isDisabled={busy||!password} type="submit">{busy?'正在验证…':action==='copy'?'验证并复制':'验证并查看'}</Button><Button size="sm" color="secondary" type="button" onClick={clearSensitive}>取消</Button></div></form>}
      {selected.revealAllowed&&plain&&<div className="secret-plaintext"><div><span>30 秒后自动隐藏</span><Button size="xs" color="secondary" type="button" onClick={clearSensitive}>立即隐藏</Button></div><pre aria-label="密钥明文">{plain}</pre></div>}
     </>}
    </section></td></tr>}
    </Fragment>;
   })}
  </tbody></table>{!loading&&list?.items.length===0&&<p className="secret-table-empty">没有匹配的密钥。</p>}</div>
  {loading&&<span className="sr-only" role="status">正在加载密钥列表</span>}
  <footer className="secret-table-footer"><span>{loading?<span className="secret-skeleton secret-skeleton-count" aria-hidden="true"/>:list?`共 ${list.total} 项`:error?'读取失败':'尚未读取'}</span>{list&&list.total>list.pageSize&&<nav aria-label="密钥分页"><Button size="xs" color="tertiary" type="button" isDisabled={loading||list.page<=1} onClick={()=>{change();setPage(list.page-1);}}>上一页</Button><span>{list.page} / {Math.ceil(list.total/list.pageSize)}</span><Button size="xs" color="tertiary" type="button" isDisabled={loading||list.page*list.pageSize>=list.total} onClick={()=>{change();setPage(list.page+1);}}>下一页</Button></nav>}</footer>
 </section></div>;
}
