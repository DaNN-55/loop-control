import type{WorkerBlocker}from'../reviews/reviewSelectors';
import {NavigationButtons,OwnerMenu,EpisodeWorkspace,ReviewWorkspace,PasswordForm,Icon,navigation,type NavigationItem} from '../workspace/WorkspaceViews';
import {OperationsWorkspace} from '../operations/OperationsWorkspace';
import {EpisodeDetailDrawer} from '../episodes/EpisodeProduction';
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
import type {WorkerPreflightResult} from '../worker/contracts';
import type {LocalCatalog} from './catalog';
import {localRequest,localCommand} from './client';
type Blueprint=LocalCatalog['blueprints'][number];
export function LocalCatalogApp(){
 const[filters,setFilters]=useState({page:1,accountId:'',seriesId:'all',visibility:'active',view:'episodes',pendingPage:1,blockedPage:1});
 const queryKey=JSON.stringify(filters),queryRef=useRef(queryKey);queryRef.current=queryKey;
 const requestGeneration=useRef(0),sessionGeneration=useRef(0),authenticated=useRef(false);
 function filter(patch:Partial<typeof filters>){requestGeneration.current++;setFilters(current=>({...current,...patch,page:patch.page??1}));}
 const[ownerId,setOwnerId]=useState('');
 const [catalog,setCatalog]=useState<LocalCatalog|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(''),[csrf,setCsrf]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[selectedId,setSelectedId]=useState(''),[newAccount,setNewAccount]=useState(false),[view,setView]=useState<NavigationItem>(()=>new URLSearchParams(location.search).has('episode')?'episodes':'accounts'),[recoveryOpen,setRecoveryOpen]=useState(false);
 const [connections,setConnections]=useState<ExternalConnection[]>([]),[connectionVersions,setConnectionVersions]=useState<ExternalConnectionVersion[]>([]);
 const [blueprintPreflight,setBlueprintPreflight]=useState<WorkerPreflightResult|null>(null),[blueprintPreflightError,setBlueprintPreflightError]=useState(''),[preflightLoading,setPreflightLoading]=useState(false);
 const preflightRequest=useRef(0),preflightTarget=useRef('');
 const[theme,setTheme]=useState(()=>localStorage.getItem('loop-control.theme.v1')==='dark'?'dark':'light');
 const[collapsed,setCollapsed]=useState(()=>localStorage.getItem('loop-control.sidebar.v1')==='collapsed');
 const[accountDirty,setAccountDirty]=useState(false);const[repair,setRepair]=useState<{blocker:WorkerBlocker;blueprintVersionId:string;episodeId:string}|null>(null);
 const[settings,setSettings]=useState(false);const studio=useRef<(()=>void)|null>(null);const[studioReady,setStudioReady]=useState(false);
 function navigate(next:NavigationItem){if(view==='accounts'&&next!=='accounts'&&accountDirty){if(!window.confirm('当前配置有未保存修改，确定放弃吗？'))return;setAccountDirty(false);}setView(next);setEpisodeId('');filter({view:next,pendingPage:1,blockedPage:1});}
 const [newEpisode,setNewEpisode]=useState(false),[episodeId,setEpisodeId]=useState(()=>new URLSearchParams(location.search).get('episode')??'');
 useEffect(()=>{const url=new URL(location.href);if(episodeId)url.searchParams.set('episode',episodeId);else url.searchParams.delete('episode');history.replaceState(history.state,'',url);},[view,episodeId]);
 async function refresh(){
  if(!authenticated.current)return;
  const request=++requestGeneration.current,session=sessionGeneration.current,key=queryRef.current;
  const params=new URLSearchParams(Object.entries(JSON.parse(key)).map(([k,v])=>[k,String(v)]));
  try{
  const next:LocalCatalog=await localRequest('catalog?'+params);
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  const choices=await localRequest('connections');
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  setConnections(Array.isArray(choices.connections)?choices.connections:[]);setConnectionVersions(Array.isArray(choices.versions)?choices.versions:[]);setCatalog(next);setSelectedId(id=>next.accounts.some(a=>a.id===id)?id:next.accounts[0]?.id??'');
  }catch(error){if(request===requestGeneration.current&&session===sessionGeneration.current&&key===queryRef.current)throw error;}
 }
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 useEffect(()=>{if(authenticated.current)void refreshRef.current().catch(e=>setError(String(e)));},[queryKey]);
 useEffect(()=>{const visible=()=>{if(authenticated.current&&!document.hidden)void refreshRef.current().catch(e=>setError(String(e)));};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[]);
 useEffect(()=>{const expired=()=>{if(!authenticated.current)return;sessionGeneration.current++;requestGeneration.current++;authenticated.current=false;clearLocalArtifactCache();setCatalog(null);setOwnerId('');setCsrf('');setEpisodeId('');setError('会话已失效，请重新登录。');};window.addEventListener('loop-local-session-expired',expired);return()=>window.removeEventListener('loop-local-session-expired',expired);},[]);
 const connectionActions=useConnectionActions(refresh);
 useEffect(()=>{let current=true;const session=sessionGeneration.current;void localRequest('session').then(value=>{if(!current||session!==sessionGeneration.current)return;authenticated.current=true;setOwnerId(value.owner?.id??'');setCsrf(value.csrfToken);return refreshRef.current();}).catch(()=>{if(current&&session===sessionGeneration.current)setCatalog(null);});return()=>{current=false;requestGeneration.current++;};},[]);
 async function login(event:FormEvent){event.preventDefault();setPending('login');setError('');sessionGeneration.current++;requestGeneration.current++;try{const result=await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});authenticated.current=true;setOwnerId(result.owner?.id??'');setCsrf(result.csrfToken);setPassword('');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}
 async function logout(){
  const session=++sessionGeneration.current;requestGeneration.current++;authenticated.current=false;
  try{await localRequest('logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});}
  catch{if(session===sessionGeneration.current)setError('未能确认退出，请重新登录。');}
  finally{if(session===sessionGeneration.current){clearLocalArtifactCache();setEpisodeId('');setView('accounts');setCatalog(null);setOwnerId('');setCsrf('');}}
 }
 async function command<T>(label:string,name:string,data:unknown,revision?:string):Promise<T>{setPending(label);setError('');try{const result=await localCommand<T>(name,data,revision);try{await refresh();}catch{setError('配置已保存；目录刷新失败，请点击刷新重新读取。');}return result;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}}
 const account=catalog?.accounts.find(a=>a.id===selectedId)??null;
 const blueprintTarget=account?`${account.id}:${account.current_blueprint_version_id}:${catalog?.blueprintRevisions[account.current_blueprint_version_id??'']??''}`:'';preflightTarget.current=blueprintTarget;
 useEffect(()=>{preflightRequest.current++;setBlueprintPreflight(null);setBlueprintPreflightError('');setPreflightLoading(false);},[blueprintTarget]);
 async function checkBlueprint(){
  if(!authenticated.current||!account?.current_blueprint_version_id||!catalog)return;
  const target=preflightTarget.current,session=sessionGeneration.current,request=++preflightRequest.current;
  const current=()=>authenticated.current&&session===sessionGeneration.current&&target===preflightTarget.current&&request===preflightRequest.current;
  setPreflightLoading(true);setBlueprintPreflight(null);setBlueprintPreflightError('');
  try{const result=await localCommand<WorkerPreflightResult>('checkBlueprint',{accountId:account.id,blueprintVersionId:account.current_blueprint_version_id,expectedRevision:catalog.blueprintRevisions[account.current_blueprint_version_id]},undefined,'account-commands');if(current())setBlueprintPreflight(result);}
  catch(error){if(current())setBlueprintPreflightError(error instanceof Error?error.message:'本机检查暂不可用。');}finally{if(current())setPreflightLoading(false);}
 }
 if(!catalog)return <main className="access-shell"><form className="access-card" onSubmit={login}><div className="wordmark">Loop Control</div><h1>登录控制台</h1><label>邮箱<input aria-label="邮箱" autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>密码<input aria-label="密码" autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<button className="button button-primary" disabled={!!pending}>使用密码登录</button></form></main>;
 const accountsById=new Map(catalog.accounts.map(a=>[a.id,a])),seriesById=new Map(catalog.series.map(a=>[a.id,a])),versionsById=new Map(catalog.seriesVersions.map(a=>[a.id,a])),blueprintsById=new Map(catalog.blueprints.map(a=>[a.id,a]));
 const selectedEpisode=catalog.episodes.find(e=>e.id===episodeId)??null;
 const page={page:catalog.page,total:catalog.total,pageSize:catalog.pageSize,onPageChange:(page:number)=>filter({page})};
 const life=async(command:string,data:unknown)=>{setPending(command);setError('');try{await localCommand(command,data,undefined,'episode-lifecycle');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}};
 const errorMessage=error||connectionActions.error;
 return <div className="app-shell" data-sidebar={collapsed?'collapsed':'expanded'} data-theme={theme}>
 <a className="skip-link" href="#main-content">跳到主要内容</a><aside className="sidebar" aria-label="主导航">
 <div className="wordmark"><span className="wordmark-text"><span><span className="wordmark-letter-cyan">L</span><span className="wordmark-letter-blue">oo</span>p</span><span><span className="wordmark-letter-pink">C</span>ontrol</span></span><img alt="Loop Control" className="wordmark-mark" src="/brand/loop-mark.svg"/></div>
 <nav className="navigation"><NavigationButtons activeNavigation={view} badges={{reviews:catalog.reviewCount}} onSelect={navigate}/></nav>
 <button className="sidebar-studio-shortcut" disabled={!studioReady} onClick={()=>studio.current?.()} title="从生产单打开工程" type="button"><Icon name="Video"/><span>OpenChatCut</span></button>
 <div className="sidebar-footer"><div className="sidebar-utilities"><LocalSystemStatus/><button className="sidebar-utility" aria-label={theme==='light'?'切换至深色模式':'切换至浅色模式'} onClick={()=>{const next=theme==='light'?'dark':'light';setTheme(next);localStorage.setItem('loop-control.theme.v1',next);}}><Icon name={theme==='light'?'Moon':'Sun'}/></button><button className="sidebar-collapse-button sidebar-utility" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={()=>{setCollapsed(!collapsed);localStorage.setItem('loop-control.sidebar.v1',collapsed?'expanded':'collapsed');}}><Icon name="PanelLeft"/></button><OwnerMenu onOpenSettings={()=>setSettings(true)} onSignOut={()=>void logout()}/></div></div></aside>
 <section className="content-pane" id="main-content" aria-label="平台工作台" tabIndex={-1}><header className="page-header"><h1>{navigation.find(n=>n.id===view)?.label}</h1>{view==='accounts'&&<button className="button button-primary" onClick={()=>setNewAccount(true)}>新建账号</button>}{view==='episodes'&&<button className="button button-primary" onClick={()=>setNewEpisode(true)}>新建生产单</button>}<button className="button button-secondary" onClick={()=>void refresh().catch(e=>setError(String(e)))}>刷新</button><div className="mobile-header-actions"><LocalSystemStatus/><OwnerMenu onOpenSettings={()=>setSettings(true)} onSignOut={()=>void logout()}/></div></header>
 {errorMessage&&<div className="floating-notices" aria-live="polite"><div role="alert" className="error-message">{errorMessage}<button aria-label="关闭错误通知" onClick={()=>{setError('');connectionActions.setError('');}}>×</button></div></div>}
 {view==='accounts'?<>
<AccountWorkspace onDirtyChange={setAccountDirty} blueprintRepairContext={repair} onDismissBlueprintRepair={()=>{if(repair){setEpisodeId(repair.episodeId);setView('episodes');filter({view:'episodes'});}setRepair(null);}} onApplyEpisodeRepair={async input=>{try{await localCommand('repairConfiguration',{episodeId:input.context.episodeId,policy:input.policy,blockerCode:input.context.blocker.code,blockerDetail:input.context.blocker.detail},undefined,'episode-commands');await refresh();setRepair(null);setEpisodeId(input.context.episodeId);setView('episodes');filter({view:'episodes'});return true;}catch(e){setError(e instanceof Error?e.message:String(e));return false;}}} externalConnections={connections} connectionVersions={connectionVersions} account={account} accountEpisodeCount={catalog.accountCounts[account?.id??'']??0} accounts={catalog.accounts} blueprints={catalog.blueprints} blueprintPreflight={blueprintPreflight} blueprintPreflightError={blueprintPreflightError} isBlueprintPreflightLoading={preflightLoading} onRefreshBlueprintPreflight={checkBlueprint} isPending={connectionActions.pending?'connection':pending} onSelectAccount={id=>{setAccountDirty(false);setRepair(null);setSelectedId(id);}} promptVersions={catalog.promptVersions.filter(p=>p.account_id===account?.id)} series={catalog.series.filter(s=>s.account_id===account?.id)} seriesVersions={catalog.seriesVersions.filter(s=>s.account_id===account?.id)}
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
 />
 </>:view==='reviews'?<ReviewWorkspace serverPage={page} accountsById={accountsById} episodes={catalog.episodes} onSelectEpisode={setEpisodeId} selectedEpisode={selectedEpisode}/>:view==='operations'?<OperationsWorkspace remote={{catalog,seriesId:filters.seriesId,onSeriesChange:seriesId=>filter({seriesId}),onPageChange:page=>filter({page}),onPendingPageChange:pendingPage=>filter({pendingPage}),onBlockedPageChange:blockedPage=>filter({blockedPage})}} episodes={catalog.episodes} series={catalog.series} seriesVersions={catalog.seriesVersions} tasks={[]} reviewPackages={[]} preRenderReviewMembers={[]} preRenderReviewMemberDecisions={[]} selectedEpisode={selectedEpisode} onSelectEpisode={setEpisodeId} onOpenBlueprint={(id,context)=>{setSelectedId(id);setRepair(context??null);navigate('accounts');}}/>:<EpisodeWorkspace serverPage={page} accounts={catalog.accounts} accountsById={accountsById} artifacts={[]} artifactCounts={catalog.artifactCounts} blueprintsById={blueprintsById} episodes={catalog.episodes} episodeVisibility={filters.visibility as 'active'|'archived'|'all'} onEpisodeVisibilityChange={visibility=>filter({visibility})} filter={filters.accountId||'全部账号'} onFilter={accountId=>filter({accountId:accountId==='全部账号'?'':accountId,seriesId:'all'})} seriesFilter={filters.seriesId==='all'?'全部系列':filters.seriesId} onSeriesFilter={seriesId=>filter({seriesId:seriesId==='全部系列'?'all':seriesId})} series={catalog.series} seriesById={seriesById} seriesVersionsById={versionsById} selectedEpisode={selectedEpisode} onSelectEpisode={setEpisodeId} onUpdateTitle={(episodeId,title)=>life('renameEpisode',{episodeId,title})} onSetArchived={(episodeId,archived)=>life('archiveEpisode',{episodeId,archived})} onDelete={async(episodeId,confirmation)=>{const plan=await localCommand<{path:string;revision:string}>('planDeletion',{episodeId},undefined,'episode-lifecycle');await life('deleteEpisode',{episodeId,confirmation,expectedPath:plan.path,expectedRevision:plan.revision});}}/>}</section>
 <nav aria-label="移动端主导航" className="mobile-navigation"><NavigationButtons activeNavigation={view} badges={{reviews:catalog.reviewCount}} onSelect={navigate}/></nav>
 {episodeId&&<EpisodeDetailDrawer isOpen onClose={()=>setEpisodeId('')}><LocalEpisodeDetail key={episodeId} ownerId={ownerId} episodeId={episodeId} onClose={()=>setEpisodeId('')} onChanged={refresh} onOpenAccount={(id,context)=>{setSelectedId(id);setRepair(context??null);navigate('accounts');}} onStudioAction={action=>{studio.current=action;setStudioReady(Boolean(action));}}/></EpisodeDetailDrawer>}
 {settings&&<PasswordForm isPending={pending==='password'} onClose={()=>setSettings(false)} onSubmit={async password=>{setPending('password');try{await localRequest('password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({password})});setSettings(false);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}}><details onToggle={event=>setRecoveryOpen(event.currentTarget.open)}><summary>外部连接与恢复</summary>{recoveryOpen&&<LocalConnectionsPanel/>}</details><LocalDeletionRecovery revision={catalog}/></PasswordForm>}
 {newEpisode&&<EpisodeForm accounts={catalog.accounts.filter(a=>!a.archived_at)} blueprints={catalog.blueprints} connectionVersions={connectionVersions} series={catalog.series} seriesVersions={catalog.seriesVersions} isPending={pending==='episode'} onClose={()=>setNewEpisode(false)} onSubmit={async input=>{setPending('episode');setError('');try{const e=await localCommand<{id:string}>('create',input,undefined,'episode-commands');await refresh();setEpisodeId(e.id);setNewEpisode(false);setView('episodes');filter({view:'episodes'});}catch(e){setError(e instanceof Error?e.message:String(e));if(e&&typeof e==='object'&&'preflight'in e)return e.preflight as import('../worker/contracts').WorkerPreflightResult;}finally{setPending('');}return null;}}/>}
 {newAccount&&<AccountForm isPending={pending==='account'} onClose={()=>setNewAccount(false)} onSubmit={async input=>{try{const created=await command<LocalCatalog['accounts'][number]>('account','createAccount',input);setSelectedId(created.id);setNewAccount(false);setView('accounts');}catch{/* The visible form error preserves this draft. */}}}/>}</div>;
}
