import {useEffect,useState} from 'react';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localCommand} from './client';
import type {readEpisodeCollection} from './episodeCollection';
import './episode-collection.css';
type State=Awaited<ReturnType<typeof readEpisodeCollection>>;
export function EpisodeCollectionDialog({episodeId,onClose,onChanged}:{episodeId:string;onClose:()=>void;onChanged:()=>Promise<void>}){
 const [state,setState]=useState<State|null>(null),[target,setTarget]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const dialog=useDialogFocus<HTMLDivElement>(true,()=>{if(!pending)onClose();});
 const refresh=async()=>{const next=await localCommand<State>('readEpisodeCollection',{episodeId},undefined,'account-commands');setState(next);return next;};
 useEffect(()=>{let active=true;void localCommand<State>('readEpisodeCollection',{episodeId},undefined,'account-commands').then(value=>{if(active)setState(value);}).catch(cause=>{if(active)setError((cause as Error).message);});return()=>{active=false;};},[episodeId]);
 const plan=state?.plans.find(item=>!['completed','rolled_back'].includes(item.status)),ready=state?.collection.status==='registered'&&!state.collection.reason;
 async function act(command:string){setPending(true);setError('');setNotice('');try{
  if(command==='planEpisodeCollectionMove')await localCommand(command,{episodeId,seriesId:target==='unassigned'?null:target},undefined,'account-commands');
  else if(plan)await localCommand(command,{accountId:state!.accountId,migrationId:plan.id},undefined,'account-commands');
  const next=await refresh();if(command==='executeAssetDirectoryMigration'&&next.plans[0]?.status==='completed'){setNotice('系列已调整，原文件保留。');setTarget('');await onChanged();}
  if(command==='rollbackAssetDirectoryMigration'){setNotice('调整已放弃，原位置继续使用；目标副本保留。');}
 }catch(cause){setError((cause as Error).message);await refresh().catch(()=>{});}finally{setPending(false);}}
 return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="调整系列"><div ref={dialog} className="modal-card episode-collection-dialog"><header><h2>调整系列</h2><Button size="sm" color="tertiary" aria-label="关闭调整系列" iconLeading={X} isDisabled={pending} onPress={onClose}/></header>
  {state?<><dl className="episode-collection-context"><div><dt>当前系列</dt><dd>{state.collection.name}{state.collection.status==='legacy'?'（旧位置）':''}</dd></div><div><dt>创建时系列基线</dt><dd>{state.creative.name?`${state.creative.name} v${state.creative.version}`:'未关联系列'}</dd></div></dl><p className="muted-copy">将文件移至同账号的目标系列，保留创建时固定的系列规则。</p>
   {!ready?<p role="status">{state.collection.reason??'请先在账号中盘点旧资料纳管。'}</p>:null}
   <div className="episode-collection-target"><label htmlFor="episode-collection-target">目标系列</label><NativeSelect id="episode-collection-target" aria-label="目标系列" disabled={pending||Boolean(plan)||!ready} value={plan?(plan.episodes[0].seriesId??'unassigned'):target} onChange={event=>{setTarget(event.target.value);}}><option value="">选择系列或未分系列</option>{state.targets.map(item=><option key={item.seriesId??'unassigned'} value={item.seriesId??'unassigned'} disabled={item.seriesId===state.collection.seriesId||Boolean(item.seriesId&&!item.containerId)}>{item.name}{item.seriesId&&!item.containerId?'（未纳管）':''}</option>)}</NativeSelect></div>
   {plan?<section aria-label="系列调整计划" className="episode-collection-plan"><p role="status">{plan.status==='planned'?'待调整':plan.status==='copying'?'调整中，可在重启后恢复':'未切换，可恢复或放弃'}</p><dl><div><dt>原位置</dt><dd><code title={plan.episodes[0].sources[0].directory.path}>{plan.episodes[0].sources[0].directory.path}</code></dd></div><div><dt>目标位置</dt><dd><code title={plan.targetRoot+'/'+plan.episodes[0].targetPrefix}>{plan.targetRoot+'/'+plan.episodes[0].targetPrefix}</code></dd></div><div><dt>文件</dt><dd>{plan.files.length} 项 · {plan.totalBytes.toLocaleString()} 字节</dd></div></dl><details><summary>文件与指纹</summary><ul>{plan.files.map((file:{relativePath:string;sha256:string;fileSize:number})=><li key={file.relativePath}><code>{file.relativePath}</code><small>{file.fileSize.toLocaleString()} 字节 · {file.sha256}</small></li>)}</ul></details>{plan.conflicts.length?<ul role="alert">{plan.conflicts.map((conflict:string)=><li key={conflict}>{conflict}</li>)}</ul>:null}{plan.error?<p role="alert">{plan.error}</p>:null}<p className="muted-copy">复制和校验通过后切换，原文件保留。</p></section>:null}
  </>:!error?<p role="status">正在读取系列位置…</p>:null}
  {error?<p role="alert" className="form-error">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <div className="modal-actions">{!state&&error?<Button size="sm" color="secondary" onPress={()=>{setError('');void refresh().catch(cause=>setError(cause.message));}}>重新读取</Button>:plan?<><Button size="sm" color="secondary" isDisabled={pending} onPress={()=>void act('rollbackAssetDirectoryMigration')}>放弃调整</Button><Button size="sm" color="primary" isDisabled={pending||plan.conflicts.length>0} onPress={()=>void act('executeAssetDirectoryMigration')}>{pending?'处理中…':plan.status==='planned'?'复制、校验并切换':'恢复调整'}</Button></>:<Button size="sm" color="primary" isDisabled={pending||!ready||!target} onPress={()=>void act('planEpisodeCollectionMove')}>{pending?'准备预览…':'预览调整'}</Button>}</div>
 </div></div>;
}
