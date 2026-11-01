import {EpisodeCollectionDialog} from './EpisodeCollectionDialog';
import {Copy,FolderOpen} from 'lucide-react';
import './episode-directory.css';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {WorkerBlocker} from '../reviews/reviewSelectors';
import {episodeCatalogChanged} from '../episodes/episodeCatalogChanged';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArtifactPreview} from '../episodes/EpisodeProduction';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
import {createEpisodeReader} from '../episodes/episodeReadService';
import {localCommand,localRequest} from './client';
import type {WorkerPreflightResult} from '../worker/contracts';
type LocalEpisodeSnapshot=EpisodeProductionSnapshot&{localAssetRoot?:string;localDirectoryPath?:string;historicalReadOnly?:boolean};
export function LocalEpisodeDetail({episodeId,onChanged,onStudioAction,onOpenAccount,preparationEntry}:{preparationEntry?:{shotId?:string;targetItemId?:string};episodeId:string;ownerId?:string;onClose:()=>void;onChanged:()=>Promise<void>;onStudioAction?:(action:(()=>void)|null)=>void;onOpenAccount?:(accountId:string,context?:{blocker:WorkerBlocker;blueprintVersionId:string;episodeId:string})=>void}){
 const [snapshot,setSnapshot]=useState<LocalEpisodeSnapshot|null>(null),[error,setError]=useState('');
 const [collectionOpen,setCollectionOpen]=useState(false);
 const [directoryPending,setDirectoryPending]=useState(false),[directoryNotice,setDirectoryNotice]=useState('');
 useEffect(()=>{if(!directoryNotice)return;const timer=setTimeout(()=>setDirectoryNotice(''),5000);return()=>clearTimeout(timer);},[directoryNotice]);
 const [workspaceStudioAction,setWorkspaceStudioAction]=useState<(()=>void)|null>(null);
 const changeWorkspaceAction=useCallback((action:(()=>void)|null)=>setWorkspaceStudioAction(()=>action),[]);
 const [preflight,setPreflight]=useState<WorkerPreflightResult|null>(null);
 const previous=useRef<LocalEpisodeSnapshot|null>(null),changed=useRef(onChanged);changed.current=onChanged;
 const reader=useMemo(()=>createEpisodeReader<LocalEpisodeSnapshot>(async(id,known)=>localRequest(`episodes/${id}?known=${encodeURIComponent(JSON.stringify(known))}`)),[episodeId]);
 async function refresh(){const next=await reader(episodeId);setSnapshot(next);}
 useEffect(()=>{let current=true,busy=false;async function poll(){if(busy||document.hidden)return;busy=true;try{const s=await reader(episodeId);if(current){const changedCatalog=episodeCatalogChanged(previous.current,s);previous.current=s;setSnapshot(s);if(changedCatalog)void changed.current().catch(()=>{});}}catch(e){if(current)setError(e instanceof Error?e.message:String(e));}finally{busy=false;}}void poll();const timer=setInterval(()=>void poll(),2000);document.addEventListener('visibilitychange',poll);return()=>{current=false;clearInterval(timer);document.removeEventListener('visibilitychange',poll);};},[episodeId,reader]);
 async function command(name:string,data:unknown){setError('');setPreflight(null);try{const result=await localCommand(name,data,undefined,'episode-commands');await refresh();await onChanged();return result;}catch(e){if(e&&typeof e==='object'&&'preflight'in e)setPreflight(e.preflight as WorkerPreflightResult);throw e;}}
 const studioListener=useRef(onStudioAction);studioListener.current=onStudioAction;
 useEffect(()=>{studioListener.current?.(workspaceStudioAction);return()=>studioListener.current?.(null);},[episodeId,workspaceStudioAction]);
 if(!snapshot)return <section className="local-episode-detail">{error?<p role="alert">{error}</p>:<p role="status">正在加载生产单…</p>}</section>;
 const evidence=<><Disclosure label={<h3>任务与审核记录</h3>} className="review-section detail-card-collapsible"><div className="detail-card-body"><pre style={{maxHeight:400,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({tasks:snapshot.tasks,reviewPackages:snapshot.reviewPackages,transitions:snapshot.transitions},null,2)}</pre></div></Disclosure><ArtifactPreview artifacts={snapshot.artifacts}/></>;

 const board=snapshot.reviewPackages.filter(p=>p.stage==='storyboard_review'&&!p.invalidated_at).sort((a,b)=>b.revision_number-a.revision_number)[0];
 return <section className="local-episode-detail">
  {collectionOpen?<EpisodeCollectionDialog episodeId={episodeId} onClose={()=>setCollectionOpen(false)} onChanged={async()=>{await refresh();await onChanged();}}/>:null}
  {error&&<p role="alert" className="form-error">{error}</p>}
  <div className="production-directory" aria-label="本地文件夹"><code title={snapshot.localDirectoryPath} aria-label="本地文件夹路径">{snapshot.localDirectoryPath||'目录位置不可用'}</code><Button size="sm" color="secondary" iconLeading={FolderOpen} isDisabled={directoryPending||!snapshot.localDirectoryPath} onPress={()=>{setDirectoryPending(true);setError('');void localCommand('openDirectory',{episodeId},undefined,'episode-commands').then(()=>setDirectoryNotice('已打开本地文件夹。')).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setDirectoryPending(false));}}>打开本地文件夹</Button><Button size="sm" color="tertiary" aria-label="复制本地文件夹路径" title="复制路径" iconLeading={Copy} isDisabled={!snapshot.localDirectoryPath} onPress={()=>{void navigator.clipboard.writeText(snapshot.localDirectoryPath!).then(()=>setDirectoryNotice('已复制路径。')).catch(()=>setError('路径复制失败，请选中路径后复制。'));}}/><Button size="sm" color="tertiary" onPress={()=>setCollectionOpen(true)}>调整收纳</Button></div>
  {directoryNotice&&<p role="status">{directoryNotice}</p>}
  <ProductionWorkspacePanel preparationEntry={preparationEntry} notice={preflight&&<section className="workspace-preflight-notice" aria-label="制作前置检查" role="alert"><div><strong>在线制作暂不可用</strong><ul>{preflight.checks.filter(check=>check.status!=='passed').map((check,index)=><li key={index}>{check.check==='provider_network_policy'?'本机在线制作授权或请求预算不可用，不会发出在线请求。手动连接测试使用独立授权。':check.reason==='连接版本不可见。'?'当前配置引用的连接不属于本地执行所有者，或连接已不可用。请在账号配置中重新选择可用连接。':check.reason}</li>)}</ul></div>{onOpenAccount&&<Button size="sm" color="secondary" onPress={()=>onOpenAccount(snapshot.episode.account_id)}>打开账号配置</Button>}</section>} key={episodeId} legacySnapshot={snapshot} historicalReadOnly={snapshot.historicalReadOnly} episodeId={episodeId} title={snapshot.episode.title} stage={snapshot.episode.stage} archivedAt={snapshot.episode.archived_at} scriptRevisionId={snapshot.episode.main_script_revision_id??null} boardId={board?.id} materials={snapshot.materialRevisions} audioTracks={snapshot.audioTracks} command={command} onLegacy={()=>{}} onStudioActionChange={changeWorkspaceAction}>{evidence}</ProductionWorkspacePanel>
 </section>;
}
