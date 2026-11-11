import {uiText,getUiLocale} from '../i18n/ui';
import {ArrowLeft,ChevronRight,Copy,Eye,HelpCircle,RefreshCw,X} from 'lucide-react';
import {PopulatedFilterSelect} from '../ui/PopulatedFilterSelect';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {useEffect,useId,useRef,useState} from 'react';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import {SecretDetailPane} from './SecretDetailPane';
import type {SecretCategory,SecretList,SecretMetadata} from './secretAdministrationTypes';
import './secret-management.css';
const categories:Record<SecretCategory,string>={system:'系统控制',connection:'连接使用',history:'历史还原',unreferenced:'未发现引用'};
type SecretGroup={id:string;name:string;category:SecretCategory;connectionId?:string;providers:Set<string>;items:SecretMetadata[]};
/** Group only the server's current page. Identity comes from IDs, never a display name. */
function pageGroups(items:SecretMetadata[]):SecretGroup[]{
 const groups=new Map<string,SecretGroup>();
 for(const item of items){
  const uses=item.category==='system'?[]:[...new Map(item.connections.map(use=>[use.connectionId,use])).values()];
  const memberships=uses.length?uses.map(use=>({id:'connection:'+use.connectionId,name:use.name.replace(/ · 账务$/,''),category:'connection' as SecretCategory,connectionId:use.connectionId,provider:use.provider})):[{id:item.category+':'+item.purpose,name:item.purpose||categories[item.category],category:item.category,connectionId:undefined,provider:''}];
  for(const membership of memberships){
   let group=groups.get(membership.id);
   if(!group){group={...membership,providers:new Set(),items:[]};groups.set(membership.id,group);}
   if(membership.provider)group.providers.add(membership.provider);
   if(!group.items.some(existing=>existing.reference===item.reference))group.items.push(item);
  }
 }
 for(const group of groups.values())group.items.sort((a,b)=>{
  const uses=(item:SecretMetadata)=>item.connections.filter(use=>!group.connectionId||use.connectionId===group.connectionId);
  return Number(uses(b).some(use=>use.current&&!use.revoked))-Number(uses(a).some(use=>use.current&&!use.revoked))||Math.max(0,...uses(b).map(use=>use.version))-Math.max(0,...uses(a).map(use=>use.version))||a.names[0].localeCompare(b.names[0],getUiLocale());
 });
 return [...groups.values()].sort((a,b)=>Number(!a.connectionId)-Number(!b.connectionId)||a.name.localeCompare(b.name,getUiLocale()));
}
export function LocalSecretAdministration({csrf,onClose,embedded=false,onStateChange,onOpenConnection,initialQuery='',initialReference}:{csrf:string;onClose:()=>void;embedded?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;onOpenConnection?:(connectionId:string)=>void;initialQuery?:string;initialReference?:string}){
 const id=useId(),dialog=useDialogFocus<HTMLElement>(!embedded,close);
 const [query,setQuery]=useState(initialQuery||initialReference||''),[category,setCategory]=useState('all'),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[help,setHelp]=useState(false);
 const [list,setList]=useState<SecretList|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[groupId,setGroupId]=useState(''),[opened,setOpened]=useState<{reference:string;action:'view'|'copy'|null}|null>(null),[busy,setBusy]=useState(false);
 const initialSelection=useRef(''),lastReference=useRef(''),stateChange=useRef(onStateChange);stateChange.current=onStateChange;
 const groups=pageGroups(list?.items??[]),group=groups.find(value=>value.id===groupId),paginated=!!list&&list.total>list.pageSize;
 useEffect(()=>{stateChange.current?.({busy,dirty:false});return()=>stateChange.current?.({busy:false,dirty:false});},[busy]);
 function close(){setOpened(null);setBusy(false);onClose();}
 function focusReference(){requestAnimationFrame(()=>{const buttons=dialog.current?.querySelectorAll<HTMLButtonElement>('[data-secret-reference]');Array.from(buttons||[]).find(button=>button.dataset.secretReference===lastReference.current)?.focus();});}
 function back(){setOpened(null);setBusy(false);focusReference();}
 function openDetail(reference:string,action:'view'|'copy'|null=null){lastReference.current=reference;setOpened({reference,action});}
 function openGroup(next:string){setGroupId(next);requestAnimationFrame(()=>dialog.current?.querySelector<HTMLElement>('.secret-group-heading h3')?.focus());}
 function backToGroups(){const previous=groupId;setGroupId('');requestAnimationFrame(()=>Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('[data-secret-group]')??[]).find(button=>button.dataset.secretGroup===previous)?.focus());}
 useEffect(()=>{const controller=new AbortController();let active=true;setLoading(true);setError('');const timer=setTimeout(()=>{void localRequest('secrets?'+new URLSearchParams({q:query,category,page:String(page)}),{signal:controller.signal,cache:'no-store'}).then(value=>{if(active)setList(value);}).catch(()=>{if(active){setList(null);setError(uiText('密钥列表读取失败，请检查会话和本机服务。'));}}).finally(()=>{if(active)setLoading(false);});},250);return()=>{active=false;clearTimeout(timer);controller.abort();};},[query,category,page,refresh]);
 useEffect(()=>{if(initialReference&&!loading&&initialSelection.current!==initialReference){initialSelection.current=initialReference;const parent=groups.find(value=>value.items.some(item=>item.reference===initialReference));if(parent)setGroupId(parent.id);openDetail(initialReference);}},[initialReference,loading]);
 function change(){setOpened(null);setGroupId('');setBusy(false);setError('');}
 const content=<section aria-labelledby={id+'-title'} aria-modal={embedded?undefined:true} className={`modal-card secret-table-modal${embedded?' owner-settings-pane':''}`} ref={dialog} role={embedded?undefined:'dialog'}>
  <header className="secret-table-heading"><h2 id={id+'-title'}>{uiText('密钥管理')}</h2><div><Button size="sm" color="tertiary" iconLeading={HelpCircle} aria-label={uiText('密钥管理帮助')} aria-expanded={help} aria-controls={id+'-help'} onClick={()=>setHelp(!help)}/><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label={uiText('刷新密钥列表')} isDisabled={loading||busy} onClick={()=>{change();setRefresh(value=>value+1);}}/><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭密钥管理')} onClick={close}/></div></header>
  {help&&<div id={id+'-help'} className="secret-table-help"><p>{uiText('查看、复制需验证当前登录密码，明文最多显示 30 秒。')}</p><p>{uiText('引用编号用于定位 Keychain 条目，不能作为 API Key 使用。系统控制密钥仅展示用途；未发现引用不代表可以删除。')}</p></div>}
  {opened?<SecretDetailPane key={opened.reference} reference={opened.reference} csrf={csrf} initialAction={opened.action} onBack={back} onStateChange={setBusy} onOpenConnection={onOpenConnection}/>:<>
   <div className="secret-table-toolbar"><InputBase size="sm" aria-label={uiText('搜索密钥')} type="search" maxLength={200} placeholder={uiText('搜索名称、用途或引用编号')} value={query} onChange={event=>{change();setQuery(event.target.value);setPage(1);}}/><PopulatedFilterSelect size="sm" aria-label={uiText('分类')} disabled={loading} counts={list?.categoryCounts} allValue="all" value={category} onValueChange={value=>{change();setCategory(value);setPage(1);}} options={[{value:'all',label:uiText('全部分类')},...Object.entries(categories).map(([value,label])=>({value,label:uiText(label)}))]}/></div>
   {error&&<div className="secret-table-notices"><p role="alert" className="form-error">{error}</p><Button size="sm" color="secondary" onPress={()=>setRefresh(value=>value+1)}>{uiText('重试')}</Button></div>}
   {group?<div className="secret-group-heading"><Button size="sm" color="tertiary" iconLeading={ArrowLeft} aria-label={uiText('返回密钥分组')} onPress={backToGroups}/><div><h3 tabIndex={-1} title={group.name}>{group.connectionId?group.name:uiText(group.name)}</h3><p>{uiText(paginated?'本页匹配 {count} 项':'{count} 项',{count:group.items.length})}</p></div></div>:paginated?<p className="secret-groups-scope">{uiText('按当前页匹配条目分组')}</p>:null}
   <div className="secret-table-scroll" aria-busy={loading}>
    {loading?<div className="secret-groups-loading" aria-hidden="true">{Array.from({length:5},(_,index)=><div key={index}><span className="secret-skeleton secret-skeleton-name"/><span className="secret-skeleton secret-skeleton-count"/></div>)}</div>:group?<div role="list" aria-label={uiText('组内密钥')} className="secret-entries">
     {group.items.map(item=>{
      const uses=item.connections.filter(use=>!group.connectionId||use.connectionId===group.connectionId),current=uses.some(use=>use.current&&!use.revoked),versions=[...new Set(uses.map(use=>use.version))].sort((a,b)=>b-a),purpose=uses.some(use=>use.name.endsWith(' · 账务'))?uiText('账务密钥'):uses.length?uiText('制作密钥'):uiText(categories[item.category]);
      const name=item.category==='system'?uiText(item.names[0]):item.names[0],version=versions.length===1?' v'+versions[0]:'',label=[name,current?uiText('当前'):versions.length?uiText('历史'):'',versions.map(value=>'v'+value).join(' / '),purpose].filter(Boolean).join(' · ');
      return <div role="listitem" className="secret-entry-row" key={item.reference}><div><button className="secret-entry-name" type="button" data-secret-reference={item.reference} onClick={()=>openDetail(item.reference)} title={name+version}>{name}{version}</button><small>{purpose} · {current?uiText('当前'):versions.length?uiText('历史'):uiText(item.state)}{uses.some(use=>use.revoked)?' · '+uiText('已撤销'):''}</small></div><div className="secret-entry-actions">{item.revealAllowed&&item.category!=='system'?<><Tooltip title={uiText('查看')} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Eye} aria-label={uiText('查看密钥：{value1}',{value1:label})} onPress={()=>openDetail(item.reference,'view')}/></Tooltip><Tooltip title={uiText('复制')} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={Copy} aria-label={uiText('复制密钥：{value1}',{value1:label})} onPress={()=>openDetail(item.reference,'copy')}/></Tooltip></>:<span>{uiText('仅查看用途')}</span>}</div></div>;
     })}
    </div>:<div role="list" aria-label={uiText('密钥分组')} className="secret-groups">{groups.map(value=><div role="listitem" key={value.id}><button type="button" className="secret-group-row" data-secret-group={value.id} aria-label={uiText('打开密钥分组：{name}',{name:value.connectionId?value.name:uiText(value.name)})} onClick={()=>openGroup(value.id)}><span><strong title={value.name}>{value.connectionId?value.name:uiText(value.name)}</strong><small>{value.connectionId?[...value.providers].join(' · '):uiText(categories[value.category])}</small></span><span>{uiText(paginated?'本页 {count} 项':'{count} 项',{count:value.items.length})}</span><ChevronRight size={16} aria-hidden="true"/></button></div>)}</div>}
    {!loading&&list?.items.length===0&&<p className="secret-table-empty">{uiText('没有匹配的密钥。')}</p>}
   </div>
   {loading&&<span className="sr-only" role="status">{uiText('正在加载密钥列表')}</span>}
   <footer className="secret-table-footer"><span>{loading?<span className="secret-skeleton secret-skeleton-count" aria-hidden="true"/>:list?uiText('共 {value1} 项',{value1:list.total}):error?uiText('读取失败'):uiText('尚未读取')}</span>{list&&list.total>list.pageSize&&<nav aria-label={uiText('密钥分页')}><Button size="xs" color="tertiary" type="button" isDisabled={loading||list.page<=1} onClick={()=>{change();setPage(list.page-1);}}>{uiText('上一页')}</Button><span>{list.page} / {Math.ceil(list.total/list.pageSize)}</span><Button size="xs" color="tertiary" type="button" isDisabled={loading||list.page*list.pageSize>=list.total} onClick={()=>{change();setPage(list.page+1);}}>{uiText('下一页')}</Button></nav>}</footer>
  </>}
 </section>;
 return embedded?content:<div className="modal-backdrop" role="presentation">{content}</div>;
}
