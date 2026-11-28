import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {LocalCatalog} from './catalog';
import {localRequest} from './client';
import './episode-batch-import.css';
import './harness-handoff-inbox.css';

interface HandoffItem {
 handoffId:string;revision:number;title:string;productId:string;status:string;message:string;
 aspectRatio?:string|null;durationSeconds?:number|null;episodeId?:string|null;digest?:string|null;
 canAccept:boolean;accountId?:string|null;seriesVersionId?:string|null;
}
interface InboxResult {enabled:boolean;items:HandoffItem[]}
type CatalogChoices=Pick<LocalCatalog,'accounts'|'series'|'seriesVersions'>;
const endpoint='harness-handoff';
const statusLabel:Record<string,string>={received:'已接收',producing:'制作中',needs_attention:'需处理',failed:'失败',delivered:'已交付'};
const itemKey=(item:HandoffItem)=>`${item.handoffId}:${item.revision}`;
const readInbox=(signal:AbortSignal):Promise<InboxResult>=>localRequest(endpoint,{signal,cache:'no-store'});

export function useHarnessHandoffEnabled(ownerId:string){
 const [enabledOwner,setEnabledOwner]=useState('');
 useEffect(()=>{
  setEnabledOwner('');
  if(!ownerId)return;
  const controller=new AbortController();
  // Optional integration: older or unconfigured runtimes leave the entry hidden.
  void readInbox(controller.signal).then(value=>{
   if(!controller.signal.aborted&&value.enabled===true)setEnabledOwner(ownerId);
  }).catch(()=>{});
  return ()=>controller.abort();
 },[ownerId]);
 return Boolean(ownerId&&enabledOwner===ownerId);
}

export function HarnessHandoffInbox({accounts,series,seriesVersions,onClose,onOpenEpisode}:{onClose:()=>void;onOpenEpisode:(id:string,created:boolean)=>void}&CatalogChoices){
 const heading=useId(),dialog=useRef<HTMLDialogElement>(null),mutation=useRef<AbortController|null>(null);
 const [reading,setReading]=useState(true),[readVersion,setReadVersion]=useState(0),[result,setResult]=useState<InboxResult|null>(null);
 const [readError,setReadError]=useState(''),[busy,setBusy]=useState(false),[submitError,setSubmitError]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false);
 useEffect(()=>{
  const element=dialog.current;
  element?.showModal();
  return ()=>{mutation.current?.abort();element?.close();};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  void readInbox(controller.signal).then(value=>{
   if(!controller.signal.aborted){setResult(value);setNeedsRefresh(false);}
  }).catch(error=>{
   if(!controller.signal.aborted)setReadError(error instanceof Error?error.message:uiText('制作包读取失败。'));
  }).finally(()=>{if(!controller.signal.aborted)setReading(false);});
  return ()=>controller.abort();
 },[readVersion]);
 function refresh(){setReading(true);setReadError('');setSubmitError('');setReadVersion(version=>version+1);}
 function close(){if(mutation.current)return;dialog.current?.close();onClose();}
 function openEpisode(id:string,created=false){dialog.current?.close();onOpenEpisode(id,created);}
 async function accept(item:HandoffItem,accountId:string,seriesVersionId:string|null){
  if(mutation.current||reading||readError||needsRefresh||!item.canAccept||!item.digest||!accountId)return;
  const controller=new AbortController();mutation.current=controller;setBusy(true);setSubmitError('');
  try{
   const {episodeId}=await localRequest(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({handoffId:item.handoffId,revision:item.revision,expectedDigest:item.digest,accountId,seriesVersionId})});
   if(controller.signal.aborted)return;
   if(typeof episodeId!=='string'||!episodeId)throw Error(uiText('未能确认生产单。'));
   openEpisode(episodeId,true);
  }catch(error){
   if(!controller.signal.aborted){setSubmitError(error instanceof Error?error.message:uiText('接单失败。'));setNeedsRefresh(true);}
  }finally{
   if(mutation.current===controller)mutation.current=null;
   if(!controller.signal.aborted)setBusy(false);
  }
 }
 return <dialog ref={dialog} className="modal-card episode-batch-import harness-handoff-inbox" aria-labelledby={heading} onCancel={event=>{event.preventDefault();close();}}>
  <div className="episode-batch-form">
   <header>
    <h2 id={heading}>{uiText('Harness 制作包')}</h2>
    <Button color="tertiary" size="sm" type="button" iconLeading={X} aria-label={uiText('关闭制作包收件箱')} isDisabled={busy} onPress={close}/>
   </header>
   <div className="episode-batch-content">
    <p className="harness-handoff-hint">{uiText('接单会导入已审核的 v3 脚本和参考图片，不会启动付费制作。')}</p>
    {reading&&<p role="status">{uiText('正在读取制作包…')}</p>}
    {busy&&<p role="status">{uiText('正在接单…')}</p>}
    {readError&&<p role="alert" className="form-error">{uiText(readError)}</p>}
    {submitError&&<p role="alert" className="form-error">{uiText(submitError)} {uiText('请先刷新收件箱，核对生产单后再操作。')}</p>}
    {result?.enabled===false&&<p role="status">{uiText('此服务未启用 Harness 交接。')}</p>}
    {result?.enabled&&result.items.length===0&&!reading&&!readError&&<p role="status">{uiText('暂无制作包。')}</p>}
    {!!result?.enabled&&result.items.length>0&&<ul className="episode-batch-results harness-handoff-list">
     {result.items.map(item=><HandoffRow key={itemKey(item)} item={item} accounts={accounts} series={series} seriesVersions={seriesVersions}
      disabled={reading||busy||Boolean(readError)||needsRefresh} onAccept={accept} onOpenEpisode={openEpisode}/>)}
    </ul>}
   </div>
   <div className="modal-actions">
    <Button color="secondary" size="sm" type="button" isDisabled={reading||busy} onPress={refresh}>{uiText('刷新')}</Button>
   </div>
  </div>
 </dialog>;
}

function HandoffRow({item,accounts,series,seriesVersions,disabled,onAccept,onOpenEpisode}:{item:HandoffItem;disabled:boolean;onAccept:(item:HandoffItem,accountId:string,seriesVersionId:string|null)=>void;onOpenEpisode:(id:string)=>void}&CatalogChoices){
 const heading=useId(),accountInput=useId(),seriesInput=useId();
 const [chosenAccountId,setAccountId]=useState(''),[chosenSeriesId,setSeriesId]=useState('');
 const choices=accounts.filter(account=>!account.archived_at&&account.current_blueprint_version_id);
 const frozen=Boolean(item.accountId),accountId=item.accountId??(choices.some(account=>account.id===chosenAccountId)?chosenAccountId:'');
 const seriesChoices=series.filter(candidate=>candidate.account_id===accountId).flatMap(candidate=>{
  const current=seriesVersions.filter(version=>version.account_id===accountId&&version.series_id===candidate.id).sort((a,b)=>b.version-a.version)[0];
  return current?[{id:current.id,name:candidate.name,version:current.version}]:[];
 });
 const seriesId=seriesChoices.some(choice=>choice.id===chosenSeriesId)?chosenSeriesId:null;
 const savedVersion=frozen?seriesVersions.find(version=>version.id===item.seriesVersionId):undefined;
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!disabled&&accountId)onAccept(item,accountId,frozen?(item.seriesVersionId??null):seriesId);
 }
 return <li>
  <h3 id={heading}>{item.title}</h3>
  <p className="harness-handoff-hint">{item.handoffId} · v{item.revision} · {item.productId}</p>
  <p><strong>{uiText(Object.hasOwn(statusLabel,item.status)?statusLabel[item.status]:item.status)}</strong>{item.message&&<> · {uiText(item.message)}</>}</p>
  <dl className="harness-handoff-settings">
   <div><dt>{uiText('画幅')}</dt><dd>{item.aspectRatio||uiText('沿用生产默认')}</dd></div>
   <div><dt>{uiText('时长')}</dt><dd>{item.durationSeconds==null?uiText('沿用生产默认'):uiText('{seconds} 秒',{seconds:item.durationSeconds})}</dd></div>
  </dl>
  {item.canAccept&&item.digest&&<form aria-labelledby={heading} action="/api/local/harness-handoff" method="post" onSubmit={submit}>
   {frozen?<p className="harness-handoff-hint">{uiText('沿用上次接单的账号和系列。')} {accounts.find(account=>account.id===accountId)?.name??accountId} · {item.seriesVersionId?(savedVersion?`${series.find(value=>value.id===savedVersion.series_id)?.name??uiText('未知系列')} v${savedVersion.version}`:item.seriesVersionId):uiText('不关联系列')}</p>:choices.length>0&&<>
    <div><label htmlFor={accountInput}>{uiText('账号（必选）')}</label>
     <NativeSelect size="sm" id={accountInput} name="accountId" required disabled={disabled} value={accountId} onChange={event=>{setAccountId(event.target.value);setSeriesId('');}}>
      <option value="">{uiText('请选择账号')}</option>
      {choices.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}
     </NativeSelect>
    </div>
    {seriesChoices.length>0&&<div><label htmlFor={seriesInput}>{uiText('系列版本')}</label>
     <NativeSelect size="sm" id={seriesInput} name="seriesVersionId" disabled={disabled} value={seriesId??''} onChange={event=>setSeriesId(event.target.value)}>
      <option value="">{uiText('不关联系列')}</option>
      {seriesChoices.map(choice=><option key={choice.id} value={choice.id}>{choice.name} · v{choice.version}</option>)}
     </NativeSelect>
    </div>}
   </>}
   {frozen||choices.length>0?<Button size="sm" color="primary" type="submit" isDisabled={disabled}>{frozen?uiText('继续接单'):uiText('确认接单并建单')}</Button>:<p className="harness-handoff-hint">{uiText('没有可接单的账号，请先设置账号蓝图。')}</p>}
  </form>}
  {item.episodeId&&!item.canAccept&&<Button size="sm" color="secondary" type="button" isDisabled={disabled} onPress={()=>onOpenEpisode(item.episodeId!)}>{uiText('打开生产单')}</Button>}
 </li>;
}
