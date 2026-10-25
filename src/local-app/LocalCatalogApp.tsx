import{LocalSystemStatus}from'./LocalSystemStatus';
import{LocalDeletionRecovery}from'./LocalDeliveryPanel';
import {EpisodeForm} from '../episodes/EpisodeForm';
import {LocalEpisodeDetail} from './LocalEpisodeDetail';
import {clearLocalArtifactCache} from '../reviews/localArtifactPreview';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {AccountWorkspace} from '../accounts/AccountWorkspace';
import {AccountForm} from '../accounts/AccountForm';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
import {useConnectionActions} from './useConnectionActions';
import type {ExternalConnection,ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import type {Json} from '../lib/database.types';
import type {LocalCatalog} from './catalog';
import {localRequest,localCommand} from './client';
type Blueprint=LocalCatalog['blueprints'][number];
export function LocalCatalogApp(){
 const[filters,setFilters]=useState({page:1,accountId:'',seriesId:'all',visibility:'active',view:'episodes'});
 const queryKey=JSON.stringify(filters),queryRef=useRef(queryKey);queryRef.current=queryKey;
 const requestGeneration=useRef(0),sessionGeneration=useRef(0),authenticated=useRef(false);
 function filter(patch:Partial<typeof filters>){requestGeneration.current++;setFilters(current=>({...current,...patch,page:patch.page??1}));}
 const [catalog,setCatalog]=useState<LocalCatalog|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(''),[csrf,setCsrf]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[selectedId,setSelectedId]=useState(''),[newAccount,setNewAccount]=useState(false),[view,setView]=useState<'accounts'|'episodes'>(()=>new URLSearchParams(location.search).has('episode')?'episodes':'accounts'),[recoveryOpen,setRecoveryOpen]=useState(false);
 const [connections,setConnections]=useState<ExternalConnection[]>([]),[connectionVersions,setConnectionVersions]=useState<ExternalConnectionVersion[]>([]);
 const [externalReady,setExternalReady]=useState(false);
 const [newEpisode,setNewEpisode]=useState(false),[episodeId,setEpisodeId]=useState(()=>new URLSearchParams(location.search).get('episode')??'');
 useEffect(()=>{const url=new URL(location.href);if(view==='episodes'&&episodeId)url.searchParams.set('episode',episodeId);else url.searchParams.delete('episode');history.replaceState(history.state,'',url);},[view,episodeId]);
 async function refresh(){
  if(!authenticated.current)return;
  const request=++requestGeneration.current,session=sessionGeneration.current,key=queryRef.current;
  const params=new URLSearchParams(Object.entries(JSON.parse(key)).map(([k,v])=>[k,String(v)]));
  try{
  const next:LocalCatalog=await localRequest('catalog?'+params);
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  const choices=await localRequest('connections');
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  setConnections(Array.isArray(choices.connections)?choices.connections:[]);setConnectionVersions(Array.isArray(choices.versions)?choices.versions:[]);setExternalReady(choices.capabilities?.externalReady===true);setCatalog(next);setSelectedId(id=>next.accounts.some(a=>a.id===id)?id:next.accounts[0]?.id??'');
  }catch(error){if(request===requestGeneration.current&&session===sessionGeneration.current&&key===queryRef.current)throw error;}
 }
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 useEffect(()=>{if(authenticated.current)void refreshRef.current().catch(e=>setError(String(e)));},[queryKey]);
 useEffect(()=>{const visible=()=>{if(authenticated.current&&!document.hidden)void refreshRef.current().catch(e=>setError(String(e)));};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[]);
 const connectionActions=useConnectionActions(refresh);
 useEffect(()=>{let current=true;const session=sessionGeneration.current;void localRequest('session').then(value=>{if(!current||session!==sessionGeneration.current)return;authenticated.current=true;setCsrf(value.csrfToken);return refreshRef.current();}).catch(()=>{if(current&&session===sessionGeneration.current)setCatalog(null);});return()=>{current=false;requestGeneration.current++;};},[]);
 async function login(event:FormEvent){event.preventDefault();setPending('login');setError('');sessionGeneration.current++;requestGeneration.current++;try{const result=await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});authenticated.current=true;setCsrf(result.csrfToken);setPassword('');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}
 async function logout(){
  const session=++sessionGeneration.current;requestGeneration.current++;authenticated.current=false;
  try{await localRequest('logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});}
  catch{if(session===sessionGeneration.current)setError('未能确认退出，请重新登录。');}
  finally{if(session===sessionGeneration.current){clearLocalArtifactCache();setEpisodeId('');setView('accounts');setCatalog(null);setCsrf('');}}
 }
 async function command<T>(label:string,name:string,data:unknown,revision?:string):Promise<T>{setPending(label);setError('');try{const result=await localCommand<T>(name,data,revision);try{await refresh();}catch{setError('配置已保存；目录刷新失败，请点击刷新重新读取。');}return result;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}}
 const account=catalog?.accounts.find(a=>a.id===selectedId)??null;
 return <main className="local-workspace" style={{maxWidth:1400,margin:'2rem auto',padding:24}}><header><div className="wordmark">Loop Control · 本地</div><h1>内容工作台</h1></header>{(error||connectionActions.error)&&<p role="alert" className="form-error">{error||connectionActions.error}</p>}{!catalog?<form className="access-card" onSubmit={login}><h2>所有者登录</h2><label>邮箱<input aria-label="邮箱" autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>密码<input aria-label="密码" autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button button-primary" disabled={!!pending}>使用密码登录</button></form>:<><nav><button className="button" onClick={()=>setView('accounts')}>账号配置</button><button className="button" onClick={()=>setView('episodes')}>生产单目录</button><button className="button" onClick={()=>setNewAccount(true)}>新建账号</button><button className="button" onClick={()=>void refresh().catch(e=>setError(String(e)))}>刷新</button><button className="button" onClick={()=>void logout()}>退出登录</button></nav><LocalSystemStatus/><LocalDeletionRecovery revision={catalog}/>{view==='accounts'?<><AccountWorkspace externalConnections={connections} connectionVersions={connectionVersions} account={account} accountEpisodeCount={catalog.accountCounts[account?.id??'']??0} accounts={catalog.accounts} blueprints={catalog.blueprints} blueprintPreflightError={externalReady?"连接以逐版本验证为准；本地生产前检查尚未接管。":"本地外部连接尚未就绪；相关选择暂时阻塞。生产能力仍需后续运行前检查。"} isPending={connectionActions.pending?'connection':pending} onSelectAccount={setSelectedId} promptVersions={catalog.promptVersions.filter(p=>p.account_id===account?.id)} series={catalog.series.filter(s=>s.account_id===account?.id)} seriesVersions={catalog.seriesVersions.filter(s=>s.account_id===account?.id)}
 onCreateConnection={async input=>{try{return (await connectionActions.command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await connectionActions.command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onTestConnection={async connectionId=>{try{await connectionActions.command('verify',{connectionId});}catch{/* Visible connection error. */}}}
 onUpdateConnection={async input=>{try{await connectionActions.command('update',input);}catch{/* Visible connection error. */}}}
 onUpdateBlueprint={async(policy:Json)=>{if(!account)return null;try{return await command<Blueprint>('blueprint','updateBlueprint',{accountId:account.id,policy},catalog.blueprintRevisions[account.current_blueprint_version_id??'']);}catch{return null;}}}
 onCreateSeries={async input=>{if(account)await command('series','createSeries',{accountId:account.id,...input});}}
 onCreateSeriesVersion={async input=>{await command(`series-version-${input.seriesId}`,'createSeriesVersion',input);}}
 onCreatePromptVersion={async input=>{if(!account)return null;try{return await command('prompt-version','createPromptVersion',{accountId:account.id,...input});}catch{return null;}}}
 onRenameAccount={async(id,name)=>{try{await command(`rename-account-${id}`,'renameAccount',{accountId:id,name});return true;}catch{return false;}}}
 onSetAccountArchived={async(id,archived)=>{try{await command(`archive-account-${id}`,'archiveAccount',{accountId:id,archived});return true;}catch{return false;}}}
 onDeleteAccount={async(id,confirmation)=>{try{await command(`delete-account-${id}`,'deleteAccount',{accountId:id,confirmation});return true;}catch{return false;}}}
 /><details onToggle={event=>setRecoveryOpen(event.currentTarget.open)}><summary>蓝图连接恢复与版本维护</summary>{recoveryOpen&&<LocalConnectionsPanel/>}</details></>:<section><h2>生产单（{catalog.total}）</h2><label>账号<select aria-label="目录账号" value={filters.accountId} onChange={e=>filter({accountId:e.target.value,seriesId:'all'})}><option value="">全部账号</option>{catalog.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>系列<select aria-label="目录系列" value={filters.seriesId} onChange={e=>filter({seriesId:e.target.value})}><option value="all">全部系列</option><option value="unassigned">无系列</option><option value="unavailable">系列不可用</option>{catalog.series.filter(s=>!filters.accountId||s.account_id===filters.accountId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>归档状态<select aria-label="归档状态" value={filters.visibility} onChange={e=>filter({visibility:e.target.value})}><option value="active">未归档</option><option value="archived">已归档</option><option value="all">全部</option></select></label><label>审核状态<select aria-label="审核状态" value={filters.view} onChange={e=>filter({view:e.target.value})}><option value="episodes">全部阶段</option><option value="reviews">待审核</option></select></label><button className="button button-primary" onClick={()=>setNewEpisode(true)}>新建生产单</button>{episodeId?<LocalEpisodeDetail key={episodeId} episodeId={episodeId} onClose={()=>setEpisodeId('')} onChanged={refresh}/>:<><p>导入来源时间：{catalog.sourceCreatedAt}</p><ul>{catalog.episodes.map(e=><li key={e.id}><button className="button" onClick={()=>setEpisodeId(e.id)}>{e.title} · {e.stage}{e.archived_at?' · 已归档':''}</button></li>)}</ul><nav aria-label="生产单分页"><button className="button" disabled={catalog.page<=1} onClick={()=>filter({page:catalog.page-1})}>上一页</button><span>第 {catalog.page} / {Math.max(1,Math.ceil(catalog.total/catalog.pageSize))} 页 · 共 {catalog.total} 条</span><button className="button" disabled={catalog.page*catalog.pageSize>=catalog.total} onClick={()=>filter({page:catalog.page+1})}>下一页</button></nav></>}</section>}
 {newEpisode&&<EpisodeForm accounts={catalog.accounts.filter(a=>!a.archived_at)} blueprints={catalog.blueprints} connectionVersions={connectionVersions} series={catalog.series} seriesVersions={catalog.seriesVersions} isPending={pending==='episode'} onClose={()=>setNewEpisode(false)} onSubmit={async input=>{setPending('episode');setError('');try{const e=await localCommand<{id:string}>('create',input,undefined,'episode-commands');await refresh();setEpisodeId(e.id);setNewEpisode(false);setView('episodes');}catch(e){setError(e instanceof Error?e.message:String(e));if(e&&typeof e==='object'&&'preflight'in e)return e.preflight as import('../worker/contracts').WorkerPreflightResult;}finally{setPending('');}return null;}}/>}
 {newAccount&&<AccountForm isPending={pending==='account'} onClose={()=>setNewAccount(false)} onSubmit={async input=>{try{const created=await command<LocalCatalog['accounts'][number]>('account','createAccount',input);setSelectedId(created.id);setNewAccount(false);setView('accounts');}catch{/* The visible form error preserves this draft. */}}}/>}</>}</main>;
}
