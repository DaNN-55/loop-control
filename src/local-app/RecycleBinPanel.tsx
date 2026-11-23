import {formatStorageSize} from '../fileSize';
import {FeedbackNotice} from '../ui/FeedbackNotice';
import {useState,useEffect,useCallback,useId,useRef,type RefObject} from 'react';
import {Info,RefreshCw,Trash2,X} from 'lucide-react';
import {uiText,getUiLocale} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {ConfirmationModal} from '../ui/ConfirmationModal';
import {useDialogFocus} from '../ui/useDialogFocus';
import {EpisodeDeletionScope} from '../workspace/EpisodeDeletionScope';
import {localCommand,localRequest} from './client';
import {LocalDeletionRecovery} from './LocalDeletionRecovery';
import {BatchPurgeDialog,BatchRestoreDialog} from './BatchRecycleDialog';
import type {RecycleBinItem,RecycleBinSummary,RecyclePurgePlan} from './recycleBatchTypes';
import './recycle-bin.css';

const size=(bytes:number)=>formatStorageSize(bytes,getUiLocale());

interface Props{revision:unknown;targetKey?:string;onResolved?:(key:string)=>void;onChanged?:()=>void;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>;embedded?:boolean;}

export function RecycleBinDialog({revision,targetKey,onResolved,onChanged,onStateChange,onClose,returnFocusRef,embedded=false}:Props){
 const[summary,setSummary]=useState<RecycleBinSummary|null>(null),[draft,setDraft]=useState('5'),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[purge,setPurge]=useState<RecycleBinItem|null>(null),[recoveryBusy,setRecoveryBusy]=useState(false);
 const[policyOpen,setPolicyOpen]=useState(false);
 const [limitError,setLimitError]=useState('');
 const limitHintId=useId(),limitErrorId=useId();
 const [selected,setSelected]=useState<ReadonlySet<string>>(()=>new Set()),[batch,setBatch]=useState<{mode:'restore'|'purge';items:RecycleBinItem[]}|null>(null);
 const selectedItems=summary?.items.filter(item=>selected.has(item.episodeId))??[];
 const dirty=!!summary&&Math.round(Number(draft)*1e9)!==summary.limitBytes;
 const selectionDisabled=busy||loading||recoveryBusy||dirty;
 const allSelected=!!summary?.items.length&&selectedItems.length===summary.items.length;
 function toggleItems(items:RecycleBinItem[],checked:boolean){
  setSelected(previous=>{
   const next=new Set(previous);
   for(const item of items)checked?next.add(item.episodeId):next.delete(item.episodeId);
   return next;
  });
 }
 async function refreshAfterBatch(){await refresh(true);onChanged?.();}

 const mounted=useRef(true),generation=useRef(0),running=useRef(false);
 const recoveryState=useCallback((state:{busy:boolean;dirty:boolean})=>setRecoveryBusy(state.busy),[]);
 const draftDirty=useRef(false);draftDirty.current=dirty;
 const dialog=useDialogFocus<HTMLElement>(!embedded,onClose,returnFocusRef);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>{onStateChange?.({busy:busy||recoveryBusy||!!purge||!!batch,dirty});return()=>onStateChange?.({busy:false,dirty:false});},[busy,recoveryBusy,purge,batch,dirty,onStateChange]);
 const refresh=useCallback(async(saved=false)=>{const g=++generation.current;setLoading(true);setError('');try{const value:RecycleBinSummary=await localRequest('recycle-bin');if(mounted.current&&g===generation.current){setSummary(value);setSelected(previous=>new Set(value.items.filter(item=>previous.has(item.episodeId)).map(item=>item.episodeId)));if(!draftDirty.current)setDraft(String(value.limitBytes/1e9));}}catch(reason){if(mounted.current&&g===generation.current)setError(saved?'操作已保存；回收站刷新失败，请重新读取。':(reason as Error).message);}finally{if(mounted.current&&g===generation.current)setLoading(false);}},[]);
 useEffect(()=>{void refresh();},[revision,refresh]);
 async function run<T>(command:string,data:Record<string,unknown>,message:string,onSaved?:(result:T)=>void){
  if(running.current)return;
  running.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await localCommand<T>(command,data,undefined,'recycle-bin');
   if(!mounted.current)return;
   onSaved?.(result);
   setNotice(message);
   void refresh(true);
   try{onChanged?.();}catch{setError('操作已保存；目录刷新失败，请重新读取。');}
  }catch(reason){if(mounted.current)setError((reason as Error).message);}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 function saveLimit(input:HTMLInputElement){
  if(!summary||!dirty||busy||recoveryBusy)return;
  if(!input.validity.valid){
   setLimitError(input.validity.stepMismatch?'容量上限须以 0.1 GB 为单位。':'回收站上限须为 0.1 至 1000 GB。');
   return;
  }
  setLimitError('');
  void run<Pick<RecycleBinSummary,'limitBytes'|'settingsRevision'>>(
   'saveRecycleLimit',{limitBytes:Math.round(input.valueAsNumber*1e9),expectedRevision:summary.settingsRevision},uiText('容量上限已保存。'),
   saved=>setSummary(current=>current&&{...current,limitBytes:saved.limitBytes,settingsRevision:saved.settingsRevision,overLimit:current.usedBytes>saved.limitBytes}),
  );
 }
 const content=<section ref={embedded?undefined:dialog} className={`modal-card recycle-bin-dialog${embedded?' owner-settings-pane':''}`} role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-label={embedded?undefined:uiText('回收站')}>
  <header><h2>{uiText('回收站')}</h2><div><Tooltip title={uiText('刷新')} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" iconLeading={RefreshCw} aria-label={uiText('刷新')} isDisabled={busy||loading} onPress={()=>void refresh()}/></Tooltip><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭回收站')} isDisabled={busy||recoveryBusy} onPress={onClose}/></div></header>
  <div className="recycle-bin-body">
   {error&&<p role="alert" className="recycle-bin-error">{uiText(error)}</p>}<FeedbackNotice message={notice} onDismiss={()=>setNotice('')}/>
   {summary&&<>
    <section className="recycle-bin-settings" aria-label={uiText('回收站设置')}>
     <div className="recycle-bin-capacity"><span className="recycle-bin-capacity-label">{uiText('已用')}<Tooltip title={uiText('移入或保存上限时检查容量，超限按最早安全项清理。刚移入、单项超限、共享、未登记、离线及变化文件保留。')} isOpen={policyOpen} onOpenChange={setPolicyOpen} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" className="recycle-bin-policy-button" iconLeading={Info} aria-label={uiText('清理规则说明')} onPress={()=>setPolicyOpen(true)} onKeyDown={event=>{if(event.key==='Escape'&&policyOpen){event.preventDefault();setPolicyOpen(false);}}}/></Tooltip></span><strong>{size(summary.usedBytes)} <span>/ {new Intl.NumberFormat(getUiLocale(),{maximumFractionDigits:2}).format(summary.limitBytes/1e9)} GB</span></strong><meter aria-label={uiText('回收站已用容量')} value={summary.usedBytes} min={0} max={Math.max(summary.usedBytes,summary.limitBytes)} high={summary.limitBytes*.85} optimum={0}/></div>
     <div className="recycle-bin-limit">
      <label>{uiText('容量上限')}<span><input name="limitGb" type="number" inputMode="decimal" min="0.1" max="1000" step="0.1" required value={draft}
       readOnly={busy||recoveryBusy} aria-invalid={limitError?true:undefined} aria-describedby={limitError?`${limitHintId} ${limitErrorId}`:limitHintId}
       onChange={event=>{setDraft(event.target.value);setLimitError('');setError('');setNotice('');}}
       onBlur={event=>saveLimit(event.currentTarget)}
       onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();saveLimit(event.currentTarget);}}}/> GB</span></label>
      <small id={limitHintId}>{uiText('离开输入框时自动保存。低于已用容量时，可能永久清理最早的符合条件的生产单。')}</small>
      {limitError&&<small id={limitErrorId} role="alert" className="recycle-bin-error">{uiText(limitError)}</small>}
     </div>
    </section>
    {summary.overLimit&&<p className="recycle-bin-error" role="status">{uiText('已超限，受保护项目保留。可调高上限或手动清理。')}</p>}
    {!!summary.pendingBytes&&<p role="status">{uiText('待释放 {size}，请继续文件清理。',{size:size(summary.pendingBytes)})}</p>}
    {selectedItems.length>0&&<div className="episode-batch-toolbar episode-batch-selection-toolbar" role="group" aria-label={uiText('回收站批量操作')}>
     <Button size="sm" color="secondary" isDisabled={selectionDisabled} onPress={()=>setBatch({mode:'restore',items:selectedItems})}>{uiText('批量恢复')}</Button>
     <Button size="sm" color="secondary-destructive" isDisabled={selectionDisabled} onPress={()=>setBatch({mode:'purge',items:selectedItems})}>{uiText('批量永久删除')}</Button>
     <div className="episode-batch-selection-status"><span className="episode-batch-selection-count" role="status">{uiText('已选 {count} 张',{count:selectedItems.length})}</span><Button size="sm" color="tertiary" isDisabled={selectionDisabled} onPress={()=>setSelected(new Set())}>{uiText('清空选择')}</Button></div>
    </div>}
    {!!summary.items.length&&<table className="recycle-bin-table" aria-label={uiText('回收站生产单')}>
     <thead><tr>
      <th scope="col" className="recycle-bin-selection"><label className="episode-batch-check"><input name="selectAllRecycled" type="checkbox" checked={allSelected} disabled={selectionDisabled} ref={element=>{if(element)element.indeterminate=selectedItems.length>0&&!allSelected;}} onChange={event=>toggleItems(summary.items,event.target.checked)}/><span className="sr-only">{uiText('全选回收站')}</span></label></th>
      <th scope="col">{uiText('生产单 / 状态')}</th><th scope="col" className="recycle-bin-item-capacity">{uiText('占用 / 移入时间')}</th><th scope="col" className="recycle-bin-item-actions">{uiText('操作')}</th>
     </tr></thead>
     <tbody>{summary.items.map(item=><tr key={item.episodeId}>
      <td className="recycle-bin-selection"><label className="episode-batch-check"><input name="selectedRecycled" type="checkbox" checked={selected.has(item.episodeId)} disabled={selectionDisabled} onChange={event=>toggleItems([item],event.target.checked)}/><span className="sr-only">{uiText('选择 {title}',{title:item.title||uiText('未命名生产单')})}</span></label></td>
      <th scope="row"><strong>{item.title||uiText('未命名生产单')}</strong><small>{item.accountName}{item.archivedBefore?uiText(' · 原已归档'):''}</small>{item.protection&&<small className="recycle-bin-protection">{uiText(item.protection)}</small>}</th>
      <td className="recycle-bin-item-capacity"><span>{size(item.sizeBytes)}</span><small>{new Intl.DateTimeFormat(getUiLocale(),{dateStyle:'short',timeStyle:'short'}).format(new Date(item.recycledAt))}</small></td>
      <td className="recycle-bin-item-actions"><div><Button size="sm" color="tertiary" isDisabled={selectionDisabled} onPress={()=>void run('restoreRecycledEpisode',{episodeId:item.episodeId,revision:item.revision},uiText('生产单已恢复到原账号与系列。'))}>{uiText('恢复')}</Button><Button size="sm" color="tertiary" iconLeading={Trash2} aria-label={uiText('永久删除 {title}',{title:item.title})} isDisabled={selectionDisabled} onPress={()=>setPurge(item)}/></div></td>
     </tr>)}</tbody>
    </table>}
    {!summary.items.length&&<p className="recycle-bin-empty">{uiText('回收站为空。')}</p>}
   </>}
   {!summary&&loading&&<p role="status">{uiText('正在读取回收站…')}</p>}
   <details className="recycle-bin-recovery" open={targetKey?true:undefined}><summary>{uiText('文件恢复与清理')}</summary><LocalDeletionRecovery revision={summary??revision} targetKey={targetKey} onResolved={onResolved} onChanged={onChanged} onStateChange={recoveryState}/></details>
  </div><footer><span>{summary?uiText('共 {count} 张生产单',{count:summary.items.length}):''}</span><span>{uiText('删除的生产单可恢复；永久删除后无法恢复。')}</span></footer>
  {batch?.mode==='restore'&&<BatchRestoreDialog selection={batch.items} onClose={()=>setBatch(null)} onChanged={refreshAfterBatch}/>}
  {batch?.mode==='purge'&&<BatchPurgeDialog selection={batch.items} onClose={()=>setBatch(null)} onChanged={refreshAfterBatch}/>}
  {purge&&<PurgeConfirm item={purge} onClose={()=>setPurge(null)} onComplete={()=>{setPurge(null);void refresh();onChanged?.();}}/>}
 </section>;
 return embedded?content:<div className="modal-backdrop recycle-bin-backdrop">{content}</div>;
}
function PurgeConfirm({item,onClose,onComplete}:{item:RecycleBinItem;onClose:()=>void;onComplete:()=>void}){
 const[plan,setPlan]=useState<RecyclePurgePlan|null>(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setError('');setPlan(null);void localCommand<RecyclePurgePlan>('planRecyclePurge',{episodeId:item.episodeId,revision:item.revision},undefined,'recycle-bin').then(p=>{if(active)setPlan(p);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[item,attempt]);
 return <ConfirmationModal tone="danger" title={uiText('永久删除生产单')} confirmLabel={uiText('确认永久删除')} cancelLabel={uiText('取消')} pendingLabel={uiText('删除中…')} confirmDisabled={!plan||confirmation!==plan.confirmation} isPending={busy} onCancel={onClose} onConfirm={async()=>{if(!plan||busy)return;setBusy(true);setError('');try{await localCommand('purgeRecycledEpisode',{episodeId:item.episodeId,revision:item.revision,confirmation,expectedPath:plan.path,expectedPaths:plan.paths,expectedRevision:plan.revision},undefined,'recycle-bin');onComplete();}catch(reason){setError((reason as Error).message);setPlan(null);}finally{setBusy(false);}}}>
  <p>{item.title}{uiText(' 将无法恢复。只清理下方已确认的独占文件。')}</p>
  {plan?<><EpisodeDeletionScope files={plan.files} preserved={plan.preserved}/><details><summary>{uiText('已核查位置')}</summary>{plan.paths.map(path=><code className="recycle-bin-path" key={path}>{path}</code>)}</details><label className="recycle-bin-confirm-label">{uiText('输入“{title}”确认删除',{title:plan.confirmation})}<InputBase size="sm" aria-label={uiText('永久删除确认文本')} value={confirmation} onChange={event=>setConfirmation(event.target.value)} isDisabled={busy}/></label></>:!error?<p role="status">{uiText('正在检查删除范围…')}</p>:null}
  {error&&<><p role="alert" className="recycle-bin-error">{uiText(error)}</p><Button size="sm" color="secondary" onPress={()=>setAttempt(n=>n+1)}>{uiText('重新检查删除范围')}</Button></>}
 </ConfirmationModal>;
}
