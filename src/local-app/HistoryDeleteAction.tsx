import {EpisodeDeletionScope,type DeletionFileScope} from '../workspace/EpisodeDeletionScope';
import {useEffect,useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Input} from '../ui/dan-ui/components/base/input/input';
import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {localCommand} from './client';
import {historySize} from './historyPresentation';
interface DeletionPlan extends DeletionFileScope {
 episodeId:string;title:string;confirmation:string;revision:string;liveEpisode:boolean;
 path:string;paths:string[];recordCount:number;fileLinks:number;historyFiles:number;historyBytes:number;historyPaths:string[];preservedFiles:number;
}
export function HistoryDeleteAction({episodeId,onPendingChange,onDeleted,onPlanChange}:{episodeId:string;onPendingChange:(pending:boolean)=>void;onDeleted:(result:{cleanupPending:boolean})=>void;onPlanChange?:(ready:boolean)=>void}){
 const [plan,setPlan]=useState<DeletionPlan|null>(null),[confirmation,setConfirmation]=useState(''),[acknowledged,setAcknowledged]=useState(false),[pending,setPending]=useState(''),[error,setError]=useState('');
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),trigger=useRef<HTMLButtonElement>(null),hadPlan=useRef(false);
 useEffect(()=>{if(plan){hadPlan.current=true;heading.current?.focus();}else if(hadPlan.current){hadPlan.current=false;trigger.current?.focus();}},[plan]);
 async function inspect(){
  if(lock.current)return;lock.current=true;setPending('plan');onPendingChange(true);setError('');setConfirmation('');setAcknowledged(false);
  try{setPlan(await localCommand<DeletionPlan>('planHistoryDeletion',{episodeId},undefined,'episode-lifecycle'));onPlanChange?.(true);}
  catch(cause){setError(cause instanceof Error?cause.message:'删除范围读取失败，请重试。');}
  finally{lock.current=false;setPending('');onPendingChange(false);}
 }
 async function remove(){
  if(lock.current||!plan||confirmation!==plan.confirmation||!acknowledged)return;
  lock.current=true;setPending('delete');onPendingChange(true);setError('');
  try{const result=await localCommand<{cleanupPending:boolean}>('deleteHistoryEpisode',{episodeId,confirmation,expectedPath:plan.path,expectedPaths:plan.paths,expectedRevision:plan.revision},undefined,'episode-lifecycle');onDeleted(result);}
  catch(cause){setError(cause instanceof Error?cause.message:'删除未确认完成，请重试原操作，或重新检查范围。');}
  finally{lock.current=false;setPending('');onPendingChange(false);}
 }
 return <section className="history-delete-action" aria-label="永久删除生产单与历史资料">
  {error&&<p role="alert" className="history-error">{error}</p>}
  {!plan?<Button ref={trigger} color="secondary-destructive" size="sm" iconLeading={Trash2} isLoading={pending==='plan'} showTextWhileLoading onPress={()=>void inspect()} type="button">{pending?'正在核查删除范围…':'永久删除…'}</Button>:<form onSubmit={event=>{event.preventDefault();void remove();}}>
   <h4 ref={heading} tabIndex={-1}>确认永久删除「{plan.title}」</h4>
   <p>{plan.liveEpisode?'真实生产单、相关历史留存与下列独占文件将一并删除。':'将删除该条历史留存与下列独占文件。'}共用及仍有依赖的文件保留，此操作无法撤销。</p>
   <dl className="history-preview-counts"><div><dt>历史记录</dt><dd>{plan.recordCount.toLocaleString()} 项</dd></div><div><dt>独占历史文件</dt><dd>{plan.historyFiles.toLocaleString()} 个 · {historySize(plan.historyBytes)}</dd></div><div><dt>共用 / 依赖保留</dt><dd>{plan.preservedFiles.toLocaleString()} 份</dd></div></dl>
   {plan.paths.length>0&&<div><strong>已核查的生产单位置</strong><ul className="history-delete-paths">{plan.paths.map(path=><li key={path}><code>{path}</code></li>)}</ul></div>}<EpisodeDeletionScope files={plan.files} preserved={plan.preserved}/>
   {plan.historyPaths.length>0&&<Disclosure label={<>独占历史文件路径（{plan.historyFiles}）</>}><ul className="history-delete-paths">{plan.historyPaths.map(path=><li key={path}><code>{path}</code></li>)}</ul></Disclosure>}
   <Checkbox label="我已核对删除范围，理解永久删除无法恢复" isSelected={acknowledged} isDisabled={Boolean(pending)} onChange={setAcknowledged} size="sm"/>
   <Input label="输入完整名称以确认" placeholder={plan.confirmation} value={confirmation} onChange={setConfirmation} isDisabled={Boolean(pending)} size="sm" autoComplete="off"/>
   <div className="history-delete-buttons"><Button color="tertiary" size="sm" isDisabled={Boolean(pending)} onPress={()=>{setPlan(null);setError('');onPlanChange?.(false);}} type="button">取消删除</Button><Button color="secondary" size="sm" isDisabled={Boolean(pending)} onPress={()=>void inspect()} type="button">重新检查范围</Button><Button color="primary-destructive" size="sm" iconLeading={Trash2} isLoading={pending==='delete'} showTextWhileLoading isDisabled={Boolean(pending)||!acknowledged||confirmation!==plan.confirmation} type="submit">永久删除</Button></div>
  </form>}
 </section>;
}
