import {WorkspaceTopbar} from "./WorkspaceTopbar";
import type {CatalogStatus,CatalogSort} from '../episodes/episodeCatalogTypes';
import {Video,LayoutDashboard,Clapperboard,Users,Plug,Archive,Layers,Plus,ChevronRight} from 'lucide-react';
import {XClose} from '@untitledui/icons';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {LocalSecretAdministration} from './LocalSecretAdministration';
import type{WorkerBlocker}from'../reviews/reviewSelectors';
import {OwnerMenu,EpisodeWorkspace,PasswordForm,Icon,type NavigationItem,type EpisodeDeletionPlan} from '../workspace/WorkspaceViews';
import {OperationsWorkspace} from '../operations/OperationsWorkspace';
import {EpisodeDetailDrawer} from '../episodes/EpisodeProduction';
import{LocalSystemStatus}from'./LocalSystemStatus';
import {EpisodeForm} from '../episodes/EpisodeForm';
import {LocalEpisodeDetail} from './LocalEpisodeDetail';
import {clearLocalArtifactCache} from '../reviews/localArtifactPreview';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {AccountWorkspace} from '../accounts/AccountWorkspace';
import {AccountForm} from '../accounts/AccountForm';
import {LocalMaintenancePanel} from './LocalMaintenancePanel';
import {useConnectionActions} from './useConnectionActions';
import type {ExternalConnection,ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import type {Json} from '../lib/database.types';
import type {WorkerPreflightResult} from '../worker/contracts';
import type {LocalCatalog} from './catalog';
import {localRequest,localCommand} from './client';
type NativeView=NavigationItem|'connections'|'history';
const nativeNavigation=[{id:'operations',label:'工作台',icon:LayoutDashboard},{id:'episodes',label:'生产单',icon:Clapperboard},{id:'accounts',label:'账号与系列',icon:Users},{id:'connections',label:'连接配置',icon:Plug},{id:'history',label:'历史资料',icon:Archive}] as const;
type Blueprint=LocalCatalog['blueprints'][number];
const identitySender=crypto.randomUUID();
function notifyIdentityChange(){if(typeof window.BroadcastChannel!=='function')return;const channel=new BroadcastChannel('loop-local-identity');channel.postMessage({kind:'changed',sender:identitySender});channel.close();}
export function LocalCatalogApp(){
 const planDeletion=useCallback((episodeId:string)=>localCommand<EpisodeDeletionPlan>('planDeletion',{episodeId},undefined,'episode-lifecycle'),[]);
 const[filters,setFilters]=useState({page:1,accountId:'',seriesId:'all',visibility:'active',view:new URLSearchParams(location.search).has('episode')?'episodes':'operations',pendingPage:1,blockedPage:1,q:'',sort:'updated' as CatalogSort,status:'all' as CatalogStatus});
 const queryKey=JSON.stringify(filters),queryRef=useRef(queryKey);queryRef.current=queryKey;
 const requestGeneration=useRef(0),sessionGeneration=useRef(0),authenticated=useRef(false);
 function filter(patch:Partial<typeof filters>){requestGeneration.current++;const scopeChanged=['view','accountId','seriesId','visibility','q','sort','status'].some(key=>key in patch);setFilters(current=>({...current,...(scopeChanged?{page:1,pendingPage:1,blockedPage:1}:{}),...patch}));}
 const[ownerId,setOwnerId]=useState(''),[ownerEmail,setOwnerEmail]=useState('');
 const [catalogKey,setCatalogKey]=useState('');
 const [catalog,setCatalog]=useState<LocalCatalog|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(''),[csrf,setCsrf]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[selectedId,setSelectedId]=useState(''),[newAccount,setNewAccount]=useState(false),[view,setView]=useState<NativeView>(()=>new URLSearchParams(location.search).has('episode')?'episodes':'operations');
 const [connections,setConnections]=useState<ExternalConnection[]>([]),[connectionVersions,setConnectionVersions]=useState<ExternalConnectionVersion[]>([]);
 const [blueprintPreflight,setBlueprintPreflight]=useState<WorkerPreflightResult|null>(null),[blueprintPreflightError,setBlueprintPreflightError]=useState(''),[preflightLoading,setPreflightLoading]=useState(false);
 const preflightRequest=useRef(0),preflightTarget=useRef('');
 const[theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('loop-control.theme.v1')==='dark'?'dark':'light');
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.interface='impeccable';return()=>{delete document.documentElement.dataset.theme;delete document.documentElement.dataset.interface;};},[theme]);
 const[collapsed,setCollapsed]=useState(()=>localStorage.getItem('loop-control.sidebar.v1')==='collapsed');
 const[accountDirty,setAccountDirty]=useState(false);const[repair,setRepair]=useState<{blocker:WorkerBlocker;blueprintVersionId:string;episodeId:string}|null>(null);
 const[canManageSecrets,setCanManageSecrets]=useState(false),[secrets,setSecrets]=useState(false);
 const[settings,setSettings]=useState(false);const studio=useRef<(()=>void)|null>(null);const[studioReady,setStudioReady]=useState(false),[studioOpening,setStudioOpening]=useState(false);
 const ownerPanelTrigger=useRef<HTMLButtonElement|null>(null);
 function rememberOwnerFocus(trigger:HTMLButtonElement|null){ownerPanelTrigger.current=trigger;}
 function closeOwnerPanels(){setSettings(false);setSecrets(false);ownerPanelTrigger.current?.focus();}
 const studioOpeningRef=useRef(false);
 function navigate(next:NativeView){if(view==='accounts'&&next!=='accounts'&&accountDirty){if(!window.confirm('当前配置有未保存修改，确定放弃吗？'))return false;setAccountDirty(false);}const destination=next==='reviews'?'episodes':next;setSecrets(false);setView(destination);setEpisodeId('');if(['operations','episodes','accounts'].includes(destination))filter({view:destination,...(next==='reviews'?{visibility:'active',status:'review' as const}:destination==='operations'?{visibility:'active',status:'all' as const,q:'',accountId:''}:{}),pendingPage:1,blockedPage:1});return true;}
 const navigateRef=useRef(navigate);navigateRef.current=navigate;
 useEffect(()=>{const openConnections=()=>navigateRef.current('connections');window.addEventListener('open-external-connections',openConnections);return()=>window.removeEventListener('open-external-connections',openConnections);},[]);
 const [newEpisode,setNewEpisode]=useState(false),[episodeId,setEpisodeId]=useState(()=>new URLSearchParams(location.search).get('episode')??'');
 useEffect(()=>{const url=new URL(location.href);if(episodeId)url.searchParams.set('episode',episodeId);else url.searchParams.delete('episode');history.replaceState(history.state,'',url);},[view,episodeId]);
 async function refresh(catalogOnly=false){
  if(!authenticated.current)return;
  const request=++requestGeneration.current,session=sessionGeneration.current,key=queryRef.current;
  const params=new URLSearchParams(Object.entries(JSON.parse(key)).map(([k,v])=>[k,String(v)]));
  try{
  const next:LocalCatalog=await localRequest('catalog?'+params);
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  const choices=catalogOnly?null:await localRequest('connections');
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  if(choices){setConnections(Array.isArray(choices.connections)?choices.connections:[]);setConnectionVersions(Array.isArray(choices.versions)?choices.versions:[]);}setCatalog(next);setCatalogKey(key);setSelectedId(id=>next.accounts.some(a=>a.id===id)?id:next.accounts[0]?.id??'');
  }catch(error){if(request===requestGeneration.current&&session===sessionGeneration.current&&key===queryRef.current)throw error;}
 }
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 useEffect(()=>{if(authenticated.current)void refreshRef.current().catch(e=>setError(String(e)));},[queryKey]);
 useEffect(()=>{const visible=()=>{if(authenticated.current&&!document.hidden)void refreshRef.current().catch(e=>setError(String(e)));};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[]);
 useEffect(()=>{const expired=()=>{if(!authenticated.current)return;sessionGeneration.current++;requestGeneration.current++;authenticated.current=false;clearLocalArtifactCache();setCatalog(null);setOwnerId('');setOwnerEmail('');setCanManageSecrets(false);setSecrets(false);setCsrf('');setEpisodeId('');setError('会话已失效，请重新登录。');};window.addEventListener('loop-local-session-expired',expired);return()=>window.removeEventListener('loop-local-session-expired',expired);},[]);
 // The list updates quietly without a permanent toolbar refresh control.
 useEffect(()=>{
  if(view!=='episodes'||episodeId||pending||!catalog)return;
  let busy=false;
  const timer=window.setInterval(()=>{
   if(busy||document.hidden||!authenticated.current||catalogKey!==queryRef.current||document.querySelector('[role="dialog"],[role="menu"]'))return;
   busy=true;void refreshRef.current(true).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>{busy=false;});
  },15000);
  return()=>window.clearInterval(timer);
 },[view,episodeId,pending,Boolean(catalog),catalogKey]);
 const connectionActions=useConnectionActions(refresh);
 useEffect(()=>{let current=true;const session=sessionGeneration.current;void localRequest('session').then(value=>{if(!current||session!==sessionGeneration.current)return;authenticated.current=true;setOwnerId(value.owner?.id??'');setOwnerEmail(value.owner?.email??'');setCanManageSecrets(value.secretAdministration===true);setCsrf(value.csrfToken);return refreshRef.current();}).catch(()=>{if(current&&session===sessionGeneration.current)setCatalog(null);});return()=>{current=false;requestGeneration.current++;};},[]);
 async function login(event:FormEvent){event.preventDefault();notifyIdentityChange();setPending('login');setError('');sessionGeneration.current++;requestGeneration.current++;try{const result=await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});authenticated.current=true;setOwnerId(result.owner?.id??'');setOwnerEmail(result.owner?.email??'');setCanManageSecrets(result.secretAdministration===true);setCsrf(result.csrfToken);setPassword('');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}
 useEffect(()=>{if(typeof window.BroadcastChannel!=='function')return;const channel=new BroadcastChannel('loop-local-identity');channel.onmessage=event=>{if(event.data?.kind==='changed'&&event.data.sender!==identitySender)window.dispatchEvent(new Event('loop-local-session-expired'));};return()=>channel.close();},[]);
 async function logout(){
  notifyIdentityChange();
  const session=++sessionGeneration.current;requestGeneration.current++;authenticated.current=false;setSecrets(false);setCanManageSecrets(false);
  try{await localRequest('logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});}
  catch{if(session===sessionGeneration.current)setError('未能确认退出，请重新登录。');}
  finally{if(session===sessionGeneration.current){clearLocalArtifactCache();setEpisodeId('');setView('accounts');setCatalog(null);setOwnerId('');setOwnerEmail('');setCanManageSecrets(false);setSecrets(false);setCsrf('');}}
 }
 async function command<T>(label:string,name:string,data:unknown,revision?:string):Promise<T>{setPending(label);setError('');try{const result=await localCommand<T>(name,data,revision);try{await refresh();}catch{setError('配置已保存；目录读取失败，请重试。');}return result;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}}
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
 async function openSidebarStudio(){
  if(studio.current){studio.current();return;}
  if(!authenticated.current||studioOpeningRef.current)return;
  studioOpeningRef.current=true;setStudioOpening(true);setError('');
  const popup=window.open('about:blank','_blank'),session=sessionGeneration.current;
  try{
   const result=await localCommand<{studioUrl:string}>('openStandaloneStudio',{},undefined,'episode-commands');
   if(!authenticated.current||session!==sessionGeneration.current){popup?.close();return;}
   const url=new URL(result.studioUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw Error('Studio 地址无效。');
   if(popup){popup.opener=null;popup.location.replace(url.href);}else window.open(url.href,'_blank','noopener,noreferrer');
  }catch(error){popup?.close();if(session===sessionGeneration.current)setError(error instanceof Error?error.message:'无法打开 OpenChatCut。');}
  finally{studioOpeningRef.current=false;setStudioOpening(false);}
 }
 if(!catalog)return <main className="access-shell dan-ui product-ui impeccable-app"><section className="lc-access-art" aria-label="Loop Control 创作流程"><div className="lc-access-brand"><Layers size={26} aria-hidden="true"/><strong>Loop Control</strong></div><div><p className="lc-access-statement">让想法，<br/>沿着清楚的步骤<br/>成为作品。</p><ol className="lc-access-process" aria-label="创作流程"><li>准备素材</li><li>制作与审核</li><li>交付成片</li></ol></div><p className="lc-access-footnote">从第一份脚本，到可交付的成片。</p></section><section className="lc-access-main"><form className="access-card" onSubmit={login}><h1>登录控制台</h1><label>邮箱<InputBase size="sm" aria-label="邮箱" autoComplete="username" type="email" isRequired value={email} onChange={e=>setEmail(e.target.value)}/></label><label>密码<InputBase size="sm" aria-label="密码" autoComplete="current-password" type="password" isRequired value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<Button size="sm" color="primary" type="submit" className="button button-primary" isDisabled={!!pending}>使用密码登录</Button></form></section></main>;
 const accountsById=new Map(catalog.accounts.map(a=>[a.id,a])),seriesById=new Map(catalog.series.map(a=>[a.id,a])),versionsById=new Map(catalog.seriesVersions.map(a=>[a.id,a])),blueprintsById=new Map(catalog.blueprints.map(a=>[a.id,a]));
 const selectedEpisode=catalog.episodes.find(e=>e.id===episodeId)??null;
 const page={page:catalog.page,total:catalog.total,pageSize:catalog.pageSize,onPageChange:(page:number)=>filter({page})};
 const life=async<T=void,>(command:string,data:unknown)=>{setPending(command);setError('');try{const result=await localCommand<T>(command,data,undefined,'episode-lifecycle');await refresh();return result;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}};
 const errorMessage=error||connectionActions.error;
 const pendingReviewCount=catalog.statusCounts?.review??catalog.pending.total;
 const topbar=<WorkspaceTopbar ownerMenu={<OwnerMenu isActive={settings||secrets} onBeforeOpen={rememberOwnerFocus} onOpenSecrets={canManageSecrets?()=>{setSettings(false);setSecrets(true);}:undefined} onOpenSettings={()=>{setSecrets(false);setSettings(true);}} onSignOut={()=>void logout()}/>} theme={theme} onToggleTheme={()=>{const next=theme==='light'?'dark':'light';setTheme(next);localStorage.setItem('loop-control.theme.v1',next);}} onOpenEpisode={id=>{if(navigate('episodes'))setEpisodeId(id);}} onOpenAccount={id=>{if(view==='accounts'&&id!==selectedId&&accountDirty){if(!window.confirm('当前配置有未保存修改，确定放弃吗？'))return;setAccountDirty(false);}if(navigate('accounts'))setSelectedId(id);}} onOpenCatalog={status=>{if(navigate('episodes'))filter({view:'episodes',visibility:'active',status,q:'',accountId:'',seriesId:'all'});}}/>;
 const workspaceActions=<div className="workspace-actions">{view!=='episodes'&&<Tooltip title="刷新" className="dan-ui dan-ui-tooltip"><Button size="sm" color="secondary" aria-label="刷新" className="button button-secondary refresh-button" onClick={()=>void refresh().catch(e=>setError(String(e)))}  type="button"><Icon name="Refresh"/></Button></Tooltip>}{view==='accounts'&&<Button size="sm" color="primary" className="button button-primary" onClick={()=>setNewAccount(true)} type="button">新建账号</Button>}{(view==='episodes'||view==='operations')&&<Button size="sm" color="primary" iconLeading={Plus} className="button button-primary" onClick={()=>setNewEpisode(true)} type="button">新建生产单</Button>}</div>;
 return <div className="app-shell dan-ui product-ui impeccable-app" data-sidebar={collapsed?'collapsed':'expanded'} data-theme={theme}>
 <a className="skip-link" href="#main-content">跳到主要内容</a><aside className="sidebar" aria-label="主导航">
 <div className="lc-brand"><Layers aria-hidden="true" size={24}/><span>Loop Control<small>创作工作区</small></span></div>
 <nav className="navigation" aria-label="工作区">{[{label:'生产工作',items:nativeNavigation.slice(0,2)},{label:'账号管理',items:nativeNavigation.slice(2,3)},{label:'配置与资料',items:nativeNavigation.slice(3)}].map(group=><div role="group" aria-label={group.label} className="navigation-group" key={group.label}>{group.items.map(item=><Button key={item.id} size="sm" color="tertiary" type="button" aria-label={item.label} aria-current={view===item.id?'page':undefined} className={`navigation-item ${view===item.id?'is-active':''}`} iconLeading={item.icon} onClick={()=>navigate(item.id)}><span className="navigation-label">{item.label}</span>{item.id==='episodes'&&pendingReviewCount>0?<span className="navigation-badge" title="当前范围待审核的生产单">{pendingReviewCount}</span>:null}</Button>)}</div>)}</nav>
 <div className="sidebar-footer"><Tooltip title={studioReady?"打开当前生产单工程":"打开独立剪辑工作区"} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" aria-label={studioReady?"打开当前生产单的 OpenChatCut":"打开 OpenChatCut 独立剪辑"} className="sidebar-studio-shortcut" iconLeading={Video} isDisabled={studioOpening} onClick={()=>void openSidebarStudio()} type="button"><span>{studioOpening?"正在打开…":"OpenChatCut"}</span></Button></Tooltip>
 <div className="sidebar-utilities"><LocalSystemStatus/><Tooltip title={collapsed?'展开侧栏':'收起侧栏'} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" type="button" className="sidebar-collapse-button sidebar-utility" aria-pressed={collapsed} aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={()=>{setCollapsed(!collapsed);localStorage.setItem('loop-control.sidebar.v1',collapsed?'expanded':'collapsed');}}><Icon name="PanelLeft"/></Button></Tooltip></div></div></aside>
 {errorMessage&&<div className="floating-notices" aria-live="polite"><div role="alert" className="error-message">{errorMessage}{view==='episodes'&&error&&<Button size="sm" color="tertiary" onPress={()=>void refresh().then(()=>setError('')).catch(e=>setError(e instanceof Error?e.message:String(e)))}>重新读取</Button>}<Button size="sm" color="tertiary" type="submit" aria-label="关闭错误通知" onClick={()=>{setError('');connectionActions.setError('');}}><XClose aria-hidden="true" width={20} height={20}/></Button></div></div>}
 <section inert={Boolean(episodeId)} className="content-pane" id="main-content" aria-label="平台工作台" tabIndex={-1}><header className="page-header"><nav className="workspace-breadcrumbs" aria-label="当前位置"><span>个人工作区</span><ChevronRight size={14} aria-hidden="true"/><strong aria-current="page">{nativeNavigation.find(n=>n.id===view)?.label}</strong></nav><div className="page-header-actions">{!episodeId&&topbar}</div></header>{view!=='operations'&&<div className="workspace-page-heading"><h1>{nativeNavigation.find(n=>n.id===view)?.label}</h1></div>}

 {(view==='connections'||view==='history')?<LocalMaintenancePanel embedded activeTab={view} onTabChange={navigate} onClose={()=>navigate('operations')} revision={catalog}/>:view==='accounts'?<>
<AccountWorkspace actions={workspaceActions} onDirtyChange={setAccountDirty} blueprintRepairContext={repair} onDismissBlueprintRepair={()=>{if(repair){setEpisodeId(repair.episodeId);setView('episodes');filter({view:'episodes'});}setRepair(null);}} onApplyEpisodeRepair={async input=>{try{await localCommand('repairConfiguration',{episodeId:input.context.episodeId,policy:input.policy,blockerCode:input.context.blocker.code,blockerDetail:input.context.blocker.detail},undefined,'episode-commands');await refresh();setRepair(null);setEpisodeId(input.context.episodeId);setView('episodes');filter({view:'episodes'});return true;}catch(e){setError(e instanceof Error?e.message:String(e));return false;}}} externalConnections={connections} connectionVersions={connectionVersions} account={account} accountEpisodeCount={catalog.accountCounts[account?.id??'']??0} accounts={catalog.accounts} blueprints={catalog.blueprints} blueprintPreflight={blueprintPreflight} blueprintPreflightError={blueprintPreflightError} isBlueprintPreflightLoading={preflightLoading} onRefreshBlueprintPreflight={checkBlueprint} isPending={connectionActions.pending?'connection':pending} onSelectAccount={id=>{setAccountDirty(false);setRepair(null);setSelectedId(id);}} promptVersions={catalog.promptVersions.filter(p=>p.account_id===account?.id)} series={catalog.series.filter(s=>s.account_id===account?.id)} seriesVersions={catalog.seriesVersions.filter(s=>s.account_id===account?.id)}
 onCreateConnection={async input=>{try{return (await connectionActions.command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await connectionActions.command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onTestConnection={connectionId=>connectionActions.command('verify',{connectionId})}
 onUpdateConnection={async input=>{try{await connectionActions.command('update',input);}catch{/* Visible connection error. */}}}
 onUpdateBlueprint={async(policy:Json)=>{if(!account)return null;try{return await command<Blueprint>('blueprint','updateBlueprint',{accountId:account.id,policy},catalog.blueprintRevisions[account.current_blueprint_version_id??'']);}catch{return null;}}}
 onCreateSeries={async input=>{if(account)await command('series','createSeries',{accountId:account.id,...input});}}
 onCreateSeriesVersion={async input=>{await command(`series-version-${input.seriesId}`,'createSeriesVersion',input);}}
 onCreatePromptVersion={async input=>{if(!account)return null;try{return await command('prompt-version','createPromptVersion',{accountId:account.id,...input});}catch{return null;}}}
 onRenameAccount={async(id,name)=>{try{await command(`rename-account-${id}`,'renameAccount',{accountId:id,name});return true;}catch{return false;}}}
 onSetAccountArchived={async(id,archived)=>{try{await command(`archive-account-${id}`,'archiveAccount',{accountId:id,archived});return true;}catch{return false;}}}
 onDeleteAccount={async(id,confirmation)=>{try{await command(`delete-account-${id}`,'deleteAccount',{accountId:id,confirmation});return true;}catch{return false;}}}
 />
 </>:view==='operations'?<OperationsWorkspace onOpenAllEpisodes={()=>{if(navigate('episodes'))filter({status:'all',q:'',accountId:'',seriesId:'all',visibility:'active'});}} catalogControls={{query:filters.q,status:filters.status,sort:filters.sort,accountId:filters.accountId,onSearch:q=>filter({q}),onStatus:status=>filter({status}),onSort:sort=>filter({sort}),onAccount:accountId=>filter({accountId,seriesId:'all'})}} isLoading={catalogKey!==queryKey} accounts={catalog.accounts} blueprints={catalog.blueprints} onOpenReviewQueue={()=>navigate('reviews')} actions={workspaceActions} remote={{catalog,seriesId:filters.seriesId,onSeriesChange:seriesId=>filter({seriesId}),onPageChange:page=>filter({page}),onPendingPageChange:pendingPage=>filter({pendingPage}),onBlockedPageChange:blockedPage=>filter({blockedPage})}} episodes={catalog.episodes} series={catalog.series} seriesVersions={catalog.seriesVersions} tasks={[]} reviewPackages={[]} preRenderReviewMembers={[]} preRenderReviewMemberDecisions={[]} selectedEpisode={selectedEpisode} onSelectEpisode={setEpisodeId} onOpenBlueprint={(id,context)=>{setSelectedId(id);setRepair(context??null);navigate('accounts');}}/>:<EpisodeWorkspace isPageLoading={catalogKey!==queryKey} operationRows={catalog.operationRows} catalogControls={{query:filters.q,status:filters.status,sort:filters.sort,counts:catalog.statusCounts,onSearch:q=>filter({q}),onStatus:status=>filter({status,visibility:status==='all'?filters.visibility:'active'}),onSort:sort=>filter({sort})}} actions={workspaceActions} serverPage={page} accounts={catalog.accounts} accountsById={accountsById} artifacts={[]} artifactCounts={catalog.artifactCounts} blueprintsById={blueprintsById} episodes={catalog.episodes} episodeVisibility={filters.visibility as 'active'|'archived'|'all'} onEpisodeVisibilityChange={visibility=>filter({visibility,status:'all'})} filter={filters.accountId||'全部账号'} onFilter={accountId=>filter({accountId:accountId==='全部账号'?'':accountId,seriesId:'all'})} seriesFilter={filters.seriesId==='all'?'全部系列':filters.seriesId} onSeriesFilter={seriesId=>filter({seriesId:seriesId==='全部系列'?'all':seriesId})} series={catalog.series} seriesById={seriesById} seriesVersionsById={versionsById} selectedEpisode={selectedEpisode} onSelectEpisode={setEpisodeId} onUpdateTitle={(episodeId,title)=>life('renameEpisode',{episodeId,title})} onSetArchived={(episodeId,archived)=>life('archiveEpisode',{episodeId,archived})} onPlanDelete={planDeletion} onDelete={async(episodeId,confirmation,plan)=>{if(!plan)throw new Error('请重新检查删除范围。');const result=await life<{cleanupPending:boolean}>('deleteEpisode',{episodeId,confirmation,expectedPath:plan.path,expectedPaths:plan.paths??[plan.path],expectedRevision:plan.revision});if(result.cleanupPending)setError('生产单记录已删除，文件清理尚未完成。请在连接配置中重试文件清理。');}}/>}</section>

 {episodeId&&<EpisodeDetailDrawer tools={topbar} isOpen onClose={()=>setEpisodeId('')}><LocalEpisodeDetail key={episodeId} ownerId={ownerId} episodeId={episodeId} onClose={()=>setEpisodeId('')} onChanged={refresh} onOpenAccount={(id,context)=>{setSelectedId(id);setRepair(context??null);navigate('accounts');}} onStudioAction={action=>{studio.current=action;setStudioReady(Boolean(action));}}/></EpisodeDetailDrawer>}
 {settings&&<PasswordForm identity={<section aria-label="当前登录身份" className="owner-identity review-section"><h3>当前登录身份</h3><dl><div><dt>登录邮箱</dt><dd>{ownerEmail||'未读取'}</dd></div></dl></section>} isPending={pending==='password'} onClose={closeOwnerPanels} onSubmit={async password=>{setPending('password');try{await localRequest('password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({password})});setSettings(false);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}}/> }
 {canManageSecrets&&secrets&&<LocalSecretAdministration csrf={csrf} onClose={closeOwnerPanels}/> }
 {newEpisode&&<EpisodeForm accounts={catalog.accounts.filter(a=>!a.archived_at)} blueprints={catalog.blueprints} connectionVersions={connectionVersions} series={catalog.series} seriesVersions={catalog.seriesVersions} isPending={pending==='episode'} onClose={()=>setNewEpisode(false)} onSubmit={async input=>{setPending('episode');setError('');try{const e=await localCommand<{id:string}>('create',input,undefined,'episode-commands');await refresh();setEpisodeId(e.id);setNewEpisode(false);setView('episodes');filter({view:'episodes'});}catch(e){setError(e instanceof Error?e.message:String(e));if(e&&typeof e==='object'&&'preflight'in e)return e.preflight as import('../worker/contracts').WorkerPreflightResult;}finally{setPending('');}return null;}}/>}
 {newAccount&&<AccountForm isPending={pending==='account'} onClose={()=>setNewAccount(false)} onSubmit={async input=>{try{const created=await command<LocalCatalog['accounts'][number]>('account','createAccount',input);setSelectedId(created.id);setNewAccount(false);setView('accounts');}catch{/* The visible form error preserves this draft. */}}}/>}</div>;
}
