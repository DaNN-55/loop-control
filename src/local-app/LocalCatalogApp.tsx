import {I18nProvider} from 'react-aria-components';
import {uiText,useUiLocale,setUiLocale} from '../i18n/ui';
import type {AccountDeletionStatus} from '../accounts/accountDeletionStatus';
import {readCatalogNavigation,catalogNavigationUrl,useCatalogHistory,WorkspaceNavigationContext,CatalogPanelNavigationContext,type CatalogNavigation} from './catalogNavigation';
import {WorkspaceDraftProvider,useWorkspaceDraftLeave} from './WorkspaceDraft';
import {EpisodeCollectionDialog} from './EpisodeCollectionDialog';
import {OwnerSettingsDialog,type OwnerSettingsPage,type OwnerSettingsPaneState} from './OwnerSettingsDialog';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {OwnerPreferencesDialog,type PreferencesPage} from './OwnerPreferencesDialog';
import {defaultOwnerPreferences,parseOwnerPreferences,type OwnerPreferences} from '../preferences/preferences';
import {WorkspaceTopbar} from "./WorkspaceTopbar";
import {Video,LayoutDashboard,Clapperboard,Users,Plus,ChevronRight,CircleAlert} from 'lucide-react';
import {LoopControlMark} from './LoopControlMark';
import './brand-mark.css';
import {XClose} from '@untitledui/icons';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {LocalSecretAdministration} from './LocalSecretAdministration';
import type{WorkerBlocker}from'../reviews/reviewSelectors';
import {OwnerMenu,EpisodeWorkspace,PasswordForm,Icon,type NavigationItem,type EpisodeDeletionPlan} from '../workspace/WorkspaceViews';
import {OperationsWorkspace} from '../operations/OperationsWorkspace';
import {EpisodeDetailDrawer} from '../episodes/EpisodeDetailDrawer';
import{LocalSystemStatus}from'./LocalSystemStatus';
import {EpisodeForm} from '../episodes/EpisodeForm';
import {LocalEpisodeDetail} from './LocalEpisodeDetail';
import {clearLocalArtifactCache} from '../reviews/localArtifactPreview';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {AccountWorkspace} from '../accounts/AccountWorkspace';
import {AccountSidebar} from '../accounts/AccountSidebar';
import {AccountForm} from '../accounts/AccountForm';
import {ConnectionsSettingsDialog} from './ConnectionsSettingsDialog';
import {RecycleBinDialog} from './RecycleBinPanel';
import {RuntimeLogsDialog} from './RuntimeLogsDialog';
import {useConnectionActions} from './useConnectionActions';
import type {ExternalConnection,ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import type {Json} from '../lib/database.types';
import type {LocalCatalog} from './catalog';
import type {RuntimeStatus} from '../observability/runtimeStatus';
import {localRequest,localCommand} from './client';
type NativeView=NavigationItem;
const nativeNavigation=[{id:'operations',get label(){return uiText("工作台");},icon:LayoutDashboard},{id:'episodes',get label(){return uiText("生产单");},icon:Clapperboard},{id:'accounts',get label(){return uiText("账号");},icon:Users}] as const;
type Blueprint=LocalCatalog['blueprints'][number];
const identitySender=crypto.randomUUID();
function notifyIdentityChange(){if(typeof window.BroadcastChannel!=='function')return;const channel=new BroadcastChannel('loop-local-identity');channel.postMessage({kind:'changed',sender:identitySender});channel.close();}
export function LocalCatalogApp(){const locale=useUiLocale();return <I18nProvider locale={locale}><WorkspaceDraftProvider><LocalCatalogContent/></WorkspaceDraftProvider></I18nProvider>;}
function LocalCatalogContent(){
 const uiLocale=useUiLocale();
 const requestDraftLeave=useWorkspaceDraftLeave(),requestSettingsDraftLeave=useWorkspaceDraftLeave('connections');
 const readDeletionStatus=useCallback((accountId:string):Promise<AccountDeletionStatus>=>localRequest('account-deletion-status?accountId='+encodeURIComponent(accountId)),[]);
 const planDeletion=useCallback((episodeId:string)=>localCommand<EpisodeDeletionPlan>('planDeletion',{episodeId},undefined,'episode-lifecycle'),[]);
 const[collectionEpisode,setCollectionEpisode]=useState<string|null>(null);
 const [initialNavigation]=useState(()=>readCatalogNavigation(location.search));
 const[filters,setFilters]=useState(initialNavigation.filters);
 const[panels,setPanels]=useState(initialNavigation.panels);
 const[workspaceStep,setWorkspaceStep]=useState(initialNavigation.step),[workspaceTab,setWorkspaceTab]=useState(initialNavigation.tab);
 const queryKey=JSON.stringify(filters),queryRef=useRef(queryKey);queryRef.current=queryKey;
 const requestGeneration=useRef(0),sessionGeneration=useRef(0),authenticated=useRef(false),savedWrite=useRef<{session:number;message:string}|null>(null);
 function filter(patch:Partial<typeof filters>){requestGeneration.current++;const scopeChanged=['view','accountId','seriesId','visibility','q','sort','status','catalogStage','pageSize'].some(key=>key in patch);setFilters(current=>({...current,...(scopeChanged?{page:1,pendingPage:1,blockedPage:1}:{}),...patch,...(patch.view&&patch.view!=='operations'?{catalogStage:'all' as const}:{}),...(patch.view==='operations'&&current.sort.startsWith('cost_')?{sort:'updated' as const}:{})}));}
 const[ownerId,setOwnerId]=useState(''),[ownerEmail,setOwnerEmail]=useState('');
 const [catalogKey,setCatalogKey]=useState('');
 const [access,setAccess]=useState<'checking'|'loading'|'ready'|'anonymous'|'error'>('checking');
 const [catalog,setCatalog]=useState<LocalCatalog|null>(null),[error,setError]=useState(''),[savedRefreshNotice,setSavedRefreshNotice]=useState(''),[pending,setPending]=useState(''),[csrf,setCsrf]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[selectedId,setSelectedId]=useState(initialNavigation.account),[newAccount,setNewAccount]=useState(false),[view,setView]=useState<NativeView>(initialNavigation.view);
 const [connections,setConnections]=useState<ExternalConnection[]>([]),[connectionVersions,setConnectionVersions]=useState<ExternalConnectionVersion[]>([]);
 const[theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('loop-control.theme.v1')==='dark'?'dark':'light');
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.interface='impeccable';return()=>{delete document.documentElement.dataset.theme;delete document.documentElement.dataset.interface;};},[theme]);
 const[collapsed,setCollapsed]=useState(()=>localStorage.getItem('loop-control.sidebar.v1')==='collapsed');
 const[accountDirty,setAccountDirty]=useState(false);const[repair,setRepair]=useState<{blocker:WorkerBlocker;blueprintVersionId:string;episodeId:string}|null>(null);
 const[canManageSecrets,setCanManageSecrets]=useState(false),[secrets,setSecrets]=useState(false);
 const[ownerPreferences,setOwnerPreferences]=useState<OwnerPreferences>(defaultOwnerPreferences),[preferencesPage,setPreferencesPage]=useState<PreferencesPage|null>(null),[preferencesLoaded,setPreferencesLoaded]=useState(false),[preferencesLoading,setPreferencesLoading]=useState(false),[preferencesSaving,setPreferencesSaving]=useState(false),[preferencesError,setPreferencesError]=useState(''),[preferencesRevision,setPreferencesRevision]=useState(0);
 const[cleanupNotice,setCleanupNotice]=useState<{key:string}|null>(null);
 useEffect(()=>{setCleanupNotice(null);},[ownerId]);
 const cleanupOpen=Boolean(panels.cleanup?.open);
 function openCleanup(task=''){if(task)ownerPanelTrigger.current=document.querySelector<HTMLElement>('.owner-menu-trigger');openOwnerPage('cleanup',{cleanupTask:task});}
 const [preparationReturn,setPreparationReturn]=useState<{episodeId:string;shotId?:string;targetItemId?:string}|null>(null);
 const[logsOpen,setLogsOpen]=useState(false);
 const[settings,setSettings]=useState(false);const studio=useRef<(()=>void)|null>(null);const[studioReady,setStudioReady]=useState(false),[studioOpening,setStudioOpening]=useState(false);
 useEffect(()=>{let current=true;setPreferencesLoaded(false);setPreferencesSaving(false);setPreferencesError('');setOwnerPreferences(defaultOwnerPreferences);if(!ownerId){setPreferencesPage(null);return;}setPreferencesLoading(true);void localRequest('preferences').then(value=>{if(current){setOwnerPreferences(parseOwnerPreferences(value));setPreferencesLoaded(true);}}).catch(error=>{if(current)setPreferencesError(error instanceof Error?error.message:'偏好读取失败。');}).finally(()=>{if(current)setPreferencesLoading(false);});return()=>{current=false;};},[ownerId,preferencesRevision]);
 useEffect(()=>{if(!preferencesLoaded)return;const appearance=ownerPreferences.appearance;const media=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;const apply=()=>setTheme(appearance==='system'?(media?.matches?'dark':'light'):appearance);apply();if(appearance==='system'){media?.addEventListener('change',apply);return()=>media?.removeEventListener('change',apply);}},[ownerPreferences.appearance,preferencesLoaded]);
 useEffect(()=>{document.documentElement.dataset.rowDensity=ownerPreferences.compactRows?'compact':'comfortable';document.documentElement.lang=ownerPreferences.language;setUiLocale(ownerPreferences.language);return()=>{delete document.documentElement.dataset.rowDensity;};},[ownerPreferences.compactRows,ownerPreferences.language,uiLocale]);
 async function savePreferences(next:OwnerPreferences, onFailure?:(message:string)=>void){if(preferencesSaving||!preferencesLoaded)return false;const session=sessionGeneration.current;setPreferencesSaving(true);setPreferencesError('');try{const saved=parseOwnerPreferences(await localCommand('update',next,undefined,'preferences'));if(session!==sessionGeneration.current||!authenticated.current)return false;setOwnerPreferences(saved);if(saved.appearance!=='system')localStorage.setItem('loop-control.theme.v1',saved.appearance);return true;}catch(error){if(session===sessionGeneration.current){const message=error instanceof Error?error.message:'请重试。';setPreferencesError(message);onFailure?.(message);}return false;}finally{if(session===sessionGeneration.current)setPreferencesSaving(false);}}
 function openPreferences(page:PreferencesPage){openOwnerPage(page);}
 const ownerPanelTrigger=useRef<HTMLElement|null>(null);
 function rememberOwnerFocus(trigger:HTMLButtonElement|null){ownerPanelTrigger.current=trigger;}
 const ownerPaneState=useRef<OwnerSettingsPaneState>({busy:false,dirty:false}),pendingOwnerLeave=useRef<(()=>void)|null>(null);
 const [ownerSettingsBusy,setOwnerSettingsBusy]=useState(false),[ownerLeavePrompt,setOwnerLeavePrompt]=useState(false),[secretTarget,setSecretTarget]=useState<{id:string;name:string}|null>(null);
 const openOwnerPageRef=useRef<(page:OwnerSettingsPage)=>void>(()=>{});
 const ownerSettingsPage:OwnerSettingsPage|null=preferencesPage??(settings?'security':logsOpen?'logs':cleanupOpen?'cleanup':panels.connections.open?'connections':canManageSecrets&&secrets?'secrets':null);
 const onOwnerStateChange=useCallback((value:OwnerSettingsPaneState)=>{ownerPaneState.current=value;setOwnerSettingsBusy(previous=>previous===value.busy?previous:value.busy);},[]);
 useEffect(()=>{ownerPaneState.current={busy:false,dirty:false};setOwnerSettingsBusy(false);setOwnerLeavePrompt(false);pendingOwnerLeave.current=null;setSecretTarget(null);},[ownerId]);
 function requestOwnerLeave(action:()=>void,wholeWorkspace=false){
  if(ownerPaneState.current.busy)return false;
  const leave=()=>(wholeWorkspace?requestDraftLeave:requestSettingsDraftLeave)(action);
  if(ownerPaneState.current.dirty){pendingOwnerLeave.current=leave;setOwnerLeavePrompt(true);return false;}
  return leave();
 }
 function closeOwnerPanels(){requestOwnerLeave(()=>{setLogsOpen(false);setSettings(false);setSecrets(false);setPreferencesPage(null);setSecretTarget(null);setPanels(current=>({...current,connections:{...current.connections,open:false},cleanup:{open:false,task:''}}));onOwnerStateChange({busy:false,dirty:false});ownerPanelTrigger.current?.focus();});}
 function openOwnerPage(page:OwnerSettingsPage,options:{cleanupTask?:string;connectionId?:string;secret?:{id:string;name:string}}={}){
  if(page==='secrets'&&!canManageSecrets)return;
  if(page===ownerSettingsPage&&!options.cleanupTask&&!options.connectionId&&!options.secret)return;
  requestOwnerLeave(()=>{
   onOwnerStateChange({busy:false,dirty:false});setPreferencesPage(page==='personal'||page==='notifications'?page:null);setSettings(page==='security');setLogsOpen(page==='logs');setSecrets(page==='secrets');setSecretTarget(page==='secrets'?options.secret??null:null);
   setPanels(current=>({...current,connections:{...current.connections,open:page==='connections',...(options.connectionId?{connection:options.connectionId}: {})},cleanup:{open:page==='cleanup',task:page==='cleanup'?options.cleanupTask??'':''}}));
   if(page==='cleanup')setCleanupNotice(null);
  });
 }
 openOwnerPageRef.current=openOwnerPage;
 const studioOpeningRef=useRef(false);
 function navigate(next:NativeView,after?:()=>void){if(view==='accounts'&&next!=='accounts'&&accountDirty){if(!window.confirm('当前配置有未保存修改，确定放弃吗？'))return false;setAccountDirty(false);}return requestDraftLeave(()=>{const destination=next==='reviews'?'episodes':next;setPreparationReturn(null);setSecrets(false);setView(destination);setEpisodeId('');if(['operations','episodes','accounts'].includes(destination))filter({view:destination,...(next==='reviews'?{visibility:'active',status:'review' as const}:destination==='operations'?{visibility:'active',status:'all' as const,q:'',accountId:''}:{}),pendingPage:1,blockedPage:1});after?.();});}
 const openConnectionsFromShortcut=useCallback(()=>{
  ownerPanelTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  openOwnerPageRef.current('connections');
 },[]);
 useEffect(()=>{
  window.addEventListener('open-external-connections',openConnectionsFromShortcut);
  return()=>window.removeEventListener('open-external-connections',openConnectionsFromShortcut);
 },[openConnectionsFromShortcut]);
 const [taskQueue,setTaskQueue]=useState<RuntimeStatus['queue']>(null),[queueRequest,setQueueRequest]=useState(0);
 const openTaskQueue=()=>setQueueRequest(value=>value+1);
 const detailOrigin=useRef<{episodeId:string;trigger:HTMLElement|null}|null>(null);
 const closingDetail=useRef(false);
 const [newEpisode,setNewEpisode]=useState(false),[episodeId,applyEpisodeId]=useState(initialNavigation.episode);
 function setEpisodeId(id:string){applyEpisodeId(id);setWorkspaceStep(null);setWorkspaceTab('visual');}
 function openCatalogEpisode(id:string){
  if(id===episodeId)return;
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  requestDraftLeave(()=>{detailOrigin.current={episodeId:id,trigger};setEpisodeId(id);});
 }
 function closeEpisode(){return requestDraftLeave(()=>{closingDetail.current=true;setEpisodeId('');});}
 useLayoutEffect(()=>{
  if(episodeId||!closingDetail.current)return;
  closingDetail.current=false;
  const origin=detailOrigin.current;detailOrigin.current=null;
  const main=document.getElementById('main-content');
  const trigger=origin?.trigger;
  const row=origin&&Array.from(main?.querySelectorAll<HTMLElement>('[data-episode-open]')??[]).find(element=>element.dataset.episodeOpen===origin.episodeId);
  const target=trigger?.isConnected&&main?.contains(trigger)&&trigger!==main&&!trigger.matches(':disabled')?trigger:row??main;
  target?.focus();
 },[episodeId]);
 function restoreNavigation(next:CatalogNavigation){requestGeneration.current++;setPreparationReturn(null);setPreferencesPage(null);setSettings(false);setLogsOpen(false);setSecretTarget(null);setSecrets(false);setRepair(null);setView(next.view);setFilters(next.filters);setSelectedId(next.account);applyEpisodeId(next.episode);setWorkspaceStep(next.step);setWorkspaceTab(next.tab);setPanels(next.panels);}
 useCatalogHistory({panels,view:view==='reviews'?'episodes':view,account:selectedId,episode:episodeId,step:workspaceStep,tab:workspaceTab,filters},ownerId,restoreNavigation,(action,target)=>{
  const withoutCleanup={open:false,task:''};
  const cleanupOnly=(panels.cleanup?.open||target.panels.cleanup?.open)&&catalogNavigationUrl({panels:{...panels,cleanup:withoutCleanup},view:view==='reviews'?'episodes':view,account:selectedId,episode:episodeId,step:workspaceStep,tab:workspaceTab,filters})===catalogNavigationUrl({...target,panels:{...target.panels,cleanup:withoutCleanup}});
  if(cleanupOnly)return requestOwnerLeave(action);
  const sameAccountRules=(panels.connections.open||target.panels.connections.open||panels.cleanup?.open||target.panels.cleanup?.open)&&target.view===view&&target.account===selectedId&&target.panels.rules.series===panels.rules.series;
  if(accountDirty&&!sameAccountRules&&!window.confirm('当前配置有未保存修改，确定放弃吗？'))return false;
  return requestOwnerLeave(()=>{if(!sameAccountRules)setAccountDirty(false);action();},true);
 });
 async function refresh(catalogOnly=false,clearReadError=false){
  if(!authenticated.current)return;
  const request=++requestGeneration.current,session=sessionGeneration.current,key=queryRef.current;
  const params=new URLSearchParams(Object.entries(JSON.parse(key)).map(([k,v])=>[k,String(v)]));
  if(params.get('catalogStage')==='all')params.delete('catalogStage');
  try{
  const next:LocalCatalog=await localRequest('catalog?'+params);
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  const choices=catalogOnly?null:await localRequest('connections');
  if(request!==requestGeneration.current||session!==sessionGeneration.current||key!==queryRef.current)return;
  const requested=JSON.parse(key) as typeof filters;const missingAccount=Boolean(requested.accountId&&!next.accounts.some(a=>a.id===requested.accountId)),missingSeries=!['all','unassigned','unavailable'].includes(requested.seriesId)&&!next.series.some(s=>s.id===requested.seriesId&&(!requested.accountId||s.account_id===requested.accountId));if(missingAccount||missingSeries){setError('原账号或系列已不可用，已清除对应筛选。');filter({...(missingAccount?{accountId:''}:{}),seriesId:'all'});}
  if(choices){setConnections(Array.isArray(choices.connections)?choices.connections:[]);setConnectionVersions(Array.isArray(choices.versions)?choices.versions:[]);}setCatalog(next);setCatalogKey(key);setSavedRefreshNotice('');savedWrite.current=null;if(clearReadError)setError('');setSelectedId(id=>{if(next.accounts.some(a=>a.id===id))return id;if(id)setError('原账号已不可用，请从当前账号中重新选择。');return id?'':next.accounts[0]?.id??'';});
  }catch(error){if(request===requestGeneration.current&&session===sessionGeneration.current&&key===queryRef.current){if(savedWrite.current?.session===session)setSavedRefreshNotice(savedWrite.current.message+'；目录刷新失败，请重新读取。');throw error;}}
 }
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 useEffect(()=>{if(authenticated.current)void refreshRef.current().catch(e=>setError(e instanceof Error?e.message:String(e)));},[queryKey]);
 useEffect(()=>{const visible=()=>{if(authenticated.current&&!document.hidden)void refreshRef.current().catch(e=>setError(e instanceof Error?e.message:String(e)));};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[]);
 useEffect(()=>{const expired=()=>{if(!authenticated.current)return;sessionGeneration.current++;requestGeneration.current++;authenticated.current=false;setAccess('anonymous');clearLocalArtifactCache();setCatalog(null);setOwnerId('');setOwnerEmail('');setCanManageSecrets(false);setSecrets(false);setCsrf('');setEpisodeId('');setError('会话已失效，请重新登录。');};window.addEventListener('loop-local-session-expired',expired);return()=>window.removeEventListener('loop-local-session-expired',expired);},[]);
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
 async function restoreAccess(){const session=sessionGeneration.current;setError('');setAccess(authenticated.current?'loading':'checking');try{if(!authenticated.current){const value=await localRequest('session');if(session!==sessionGeneration.current)return;authenticated.current=true;setOwnerId(value.owner?.id??'');setOwnerEmail(value.owner?.email??'');setCanManageSecrets(value.secretAdministration===true);setCsrf(value.csrfToken);}setAccess('loading');await refreshRef.current();if(session===sessionGeneration.current)setAccess('ready');}catch(cause){if(session!==sessionGeneration.current)return;setCatalog(null);if((cause as {status?:number}).status===401){authenticated.current=false;setAccess('anonymous');}else{setAccess('error');setError(cause instanceof Error?cause.message:'无法读取工作区，请重试。');}}}
 useEffect(()=>{void restoreAccess();return()=>{sessionGeneration.current++;requestGeneration.current++;};},[]);
 async function login(event:FormEvent){event.preventDefault();notifyIdentityChange();setPending('login');setAccess('loading');setError('');sessionGeneration.current++;requestGeneration.current++;try{const result=await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});authenticated.current=true;setOwnerId(result.owner?.id??'');setOwnerEmail(result.owner?.email??'');setCanManageSecrets(result.secretAdministration===true);setCsrf(result.csrfToken);setPassword('');await refresh();setAccess('ready');}catch(e){setAccess(authenticated.current?'error':'anonymous');setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}
 useEffect(()=>{if(typeof window.BroadcastChannel!=='function')return;const channel=new BroadcastChannel('loop-local-identity');channel.onmessage=event=>{if(event.data?.kind==='changed'&&event.data.sender!==identitySender)window.dispatchEvent(new Event('loop-local-session-expired'));};return()=>channel.close();},[]);
 async function logout(){
  notifyIdentityChange();
  const session=++sessionGeneration.current;requestGeneration.current++;authenticated.current=false;setAccess('anonymous');setSecrets(false);setCanManageSecrets(false);
  try{await localRequest('logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});}
  catch{if(session===sessionGeneration.current)setError('未能确认退出，请重新登录。');}
  finally{if(session===sessionGeneration.current){clearLocalArtifactCache();setEpisodeId('');setView('accounts');setCatalog(null);setOwnerId('');setOwnerEmail('');setCanManageSecrets(false);setSecrets(false);setCsrf('');}}
 }
 function refreshAfterWrite(message:string){
  if(!authenticated.current)return;
  savedWrite.current={session:sessionGeneration.current,message};
  void refresh().catch(()=>{});
 }
 useEffect(()=>{savedWrite.current=null;setSavedRefreshNotice('');},[ownerId]);
 async function command<T>(label:string,name:string,data:unknown,revision?:string):Promise<T>{setPending(label);setError('');setSavedRefreshNotice('');savedWrite.current=null;try{const result=await localCommand<T>(name,data,revision);try{await refresh();}catch{setSavedRefreshNotice('配置已保存；目录刷新失败，请重新读取。');}return result;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}}
 const account=catalog?.accounts.find(a=>a.id===selectedId)??null;
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
 if(!catalog&&access!=='anonymous')return <main className="access-shell dan-ui product-ui impeccable-app"><section className="lc-access-main" style={{gridColumn:'1 / -1'}}><div>{access==='error'?<><p role="alert">{error||uiText("无法读取工作区，请重试。")}</p><Button size="sm" color="primary" onPress={()=>void restoreAccess()}>{uiText("重新读取工作区")}</Button></>:<p role="status">{access==='checking'?uiText("正在确认登录状态…"):uiText("正在读取工作区…")}</p>}</div></section></main>;
 if(!catalog)return <main className="access-shell dan-ui product-ui impeccable-app"><section className="lc-access-art" aria-label={uiText("Loop Control 创作流程")}><div className="lc-access-brand"><LoopControlMark size={30}/><strong>Loop Control</strong></div><div><p className="lc-access-statement">{uiText("让想法，")}<br/>{uiText("沿着清楚的步骤")}<br/>{uiText("成为作品。")}</p><ol className="lc-access-process" aria-label={uiText("创作流程")}><li>{uiText("准备素材")}</li><li>{uiText("制作与审核")}</li><li>{uiText("交付成片")}</li></ol></div><p className="lc-access-footnote">{uiText("从第一份脚本，到可交付的成片。")}</p></section><section className="lc-access-main"><form className="access-card" onSubmit={login}><h1>{uiText("登录控制台")}</h1><label>{uiText("邮箱")}<InputBase size="sm" aria-label={uiText("邮箱")} autoComplete="username" type="email" isRequired value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{uiText("密码")}<InputBase size="sm" aria-label={uiText("密码")} autoComplete="current-password" type="password" isRequired value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{uiText(error||'')}</p>}<Button size="sm" color="primary" type="submit" className="button button-primary" isDisabled={!!pending}>{uiText("使用密码登录")}</Button></form></section></main>;
 const accountsById=new Map(catalog.accounts.map(a=>[a.id,a])),seriesById=new Map(catalog.series.map(a=>[a.id,a])),versionsById=new Map(catalog.seriesVersions.map(a=>[a.id,a])),blueprintsById=new Map(catalog.blueprints.map(a=>[a.id,a]));
 const selectedEpisode=catalog.episodes.find(e=>e.id===episodeId)??null;
 const page={page:catalog.page,total:catalog.total,pageSize:filters.pageSize,onPageChange:(page:number)=>filter({page}),onPageSizeChange:(pageSize:typeof filters.pageSize)=>filter({pageSize})};
 const life=async<T=void,>(command:string,data:unknown,notifyError=true,endpoint='episode-lifecycle')=>{setPending(command);setError('');setSavedRefreshNotice('');savedWrite.current=null;try{const result=await localCommand<T>(command,data,undefined,endpoint);refreshAfterWrite('操作已保存');return result;}catch(e){if(notifyError)setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}};
 const errorMessage=[savedRefreshNotice,error||connectionActions.error].filter(Boolean).join(' ');
 const pendingReviewCount=catalog.statusCounts?.review??catalog.pending.total;
 function selectAccount(id:string, search?:CatalogNavigation['panels']['search']){
  if(view==='accounts'&&id!==selectedId){
   if(pending==='blueprint'||(accountDirty&&!window.confirm('当前配置有未保存修改，确定放弃吗？')))return;
  }
  navigate('accounts',()=>{
   if(id!==selectedId){setAccountDirty(false);setRepair(null);}
   setSelectedId(id);
   setPanels(current=>({...current,...(search?{search}:{}),...(id!==selectedId?{rules:{series:'__common',q:'',page:1}}:{})}));
  });
 }
 function setSidebarCollapsed(next:boolean){setCollapsed(next);localStorage.setItem('loop-control.sidebar.v1',next?'collapsed':'expanded');}
 function openNewAccount(){
  if(view==='accounts'&&(pending==='blueprint'||(accountDirty&&!window.confirm('当前配置有未保存修改，确定放弃吗？'))))return;
  requestDraftLeave(()=>setNewAccount(true));
 }
 const pageLabel=nativeNavigation.find(item=>item.id===view)?.label;
 const creationAccountId=view==='accounts'?selectedId:filters.accountId||selectedEpisode?.account_id||selectedId;
 const creationSeriesId=view==='accounts'?panels.rules.series:filters.seriesId;
 const creationSeriesVersion=catalog.seriesVersions.filter(version=>version.account_id===creationAccountId&&version.series_id===creationSeriesId).sort((left,right)=>right.version-left.version)[0];
 const topbar=<WorkspaceTopbar searchScope={JSON.stringify([view,episodeId,workspaceStep,workspaceTab,view==='accounts'?selectedId:null])} ownerId={ownerId} ownerMenu={<OwnerMenu isActive={logsOpen||panels.connections.open||cleanupOpen||settings||secrets||preferencesPage!==null} displayName={ownerPreferences.displayName} avatar={ownerPreferences.avatar} email={ownerEmail} onOpenPreferences={()=>openPreferences('personal')} onOpenNotifications={()=>openPreferences('notifications')} onBeforeOpen={rememberOwnerFocus} onOpenLogs={()=>openOwnerPage('logs')} onOpenConnections={()=>openOwnerPage('connections')} onOpenCleanup={()=>openCleanup()} onOpenSecrets={canManageSecrets?()=>openOwnerPage('secrets'):undefined} onOpenSettings={()=>openOwnerPage('security')} onSignOut={()=>requestOwnerLeave(()=>void logout(),true)}/>} theme={theme} notificationPreferences={ownerPreferences.notifications} notificationEventsEnabled={preferencesLoaded} episodeTitles={new Map(catalog.episodes.map(episode=>[episode.id,episode.title||'未命名生产单']))} taskQueue={taskQueue} onOpenTaskQueue={openTaskQueue} onOpenConnections={openConnectionsFromShortcut} themeSaving={preferencesSaving} onToggleTheme={()=>{const next=theme==='light'?'dark':'light';if(preferencesLoaded){void savePreferences({...ownerPreferences,appearance:next},message=>setError(`外观偏好未保存。${message}`));}else{setTheme(next);localStorage.setItem('loop-control.theme.v1',next);}}} onOpenEpisode={(id,search)=>{navigate('episodes',()=>{if(search)setPanels(current=>({...current,search}));setEpisodeId(id);});}} onOpenAccount={selectAccount} onOpenCatalog={status=>{navigate('episodes',()=>filter({view:'episodes',visibility:'active',status,q:'',accountId:'',seriesId:'all'}));}}/>;
 const workspaceActions=<div className="workspace-actions">{view!=='episodes'&&view!=='accounts'&&view!=='operations'&&<Tooltip title={uiText("刷新")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="secondary" aria-label={uiText("刷新")} className="button button-secondary refresh-button" onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:String(e)))}  type="button"><Icon name="Refresh"/></Button></Tooltip>}{(view==='episodes'||view==='operations')&&<Button size="sm" color="primary" iconLeading={Plus} className="button button-primary" onClick={()=>setNewEpisode(true)} type="button">{uiText("新建生产单")}</Button>}</div>;
 return <CatalogPanelNavigationContext.Provider value={{openArchivedProductions:()=>{navigate('episodes',()=>filter({view:'episodes',visibility:'archived',status:'all',q:'',accountId:'',seriesId:'all',page:1}));},value:panels,change:(key,patch)=>setPanels(current=>({...current,[key]:{...current[key],...patch}}))}}><WorkspaceNavigationContext.Provider value={{episode:episodeId,step:workspaceStep,tab:workspaceTab,change:patch=>{if(patch.step)setWorkspaceStep(patch.step);if(patch.tab)setWorkspaceTab(patch.tab);}}}><div className="app-shell dan-ui product-ui impeccable-app" data-sidebar={collapsed?'collapsed':'expanded'} data-theme={theme}>
 <a className="skip-link" href="#main-content">{uiText("跳到主要内容")}</a><aside className="sidebar" aria-label={uiText("主导航")} inert={ownerSettingsPage!==null}>
 <div className="lc-brand" role="img" aria-label="Loop Control"><LoopControlMark/><span>Loop Control</span></div>
 <nav className="navigation" aria-label={uiText("工作区")}>
  <div role="group" aria-label={uiText("生产工作")} className="navigation-group">
    {nativeNavigation.slice(0,2).map(item=><Button key={item.id} size="sm" color="tertiary" type="button" aria-label={item.label} aria-current={view===item.id?'page':undefined} className={`navigation-item ${view===item.id?'is-active':''}`} iconLeading={item.icon} onClick={()=>navigate(item.id)}><span className="navigation-label">{item.label}</span>{item.id==='episodes'&&pendingReviewCount>0?<span className="navigation-badge" title={uiText("当前范围待审核的生产单")}>{pendingReviewCount}</span>:null}</Button>)}
  </div>
  <AccountSidebar accounts={catalog.accounts} activeId={view==='accounts'?selectedId:null} collapsed={collapsed}
    onExpandSidebar={()=>setSidebarCollapsed(false)} onSelect={selectAccount} onCreate={openNewAccount}/>
 </nav>
 <div className="sidebar-footer"><Tooltip title={studioReady?uiText("打开当前生产单工程"):uiText("打开独立剪辑工作区")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" aria-label={studioReady?uiText("打开当前生产单的 OpenChatCut"):uiText("打开 OpenChatCut 独立剪辑")} className="sidebar-studio-shortcut" iconLeading={Video} isDisabled={studioOpening} onClick={()=>requestDraftLeave(()=>void openSidebarStudio())} type="button"><span>{studioOpening?uiText("正在打开…"):"OpenChatCut"}</span></Button></Tooltip>
 <div className="sidebar-utilities"><LocalSystemStatus triggerLabel={uiText("系统状态")} queueRequest={queueRequest} onQueueChange={setTaskQueue} onOpenEpisode={id=>{return navigate('episodes',()=>setEpisodeId(id));}}/><Tooltip title={collapsed?uiText("展开侧栏"):uiText("收起侧栏")} className="dan-ui dan-ui-tooltip"><Button size="sm" color="tertiary" type="button" className="sidebar-collapse-button sidebar-utility" aria-pressed={collapsed} aria-label={collapsed?uiText("展开侧栏"):uiText("收起侧栏")} onClick={()=>setSidebarCollapsed(!collapsed)}><Icon name="PanelLeft"/><span className="sidebar-tool-label">{collapsed?uiText("展开侧栏"):uiText("收起侧栏")}</span></Button></Tooltip></div></div></aside>
 {(errorMessage||cleanupNotice)&&<div className="floating-notices" aria-live="polite">{errorMessage&&<div role="alert" className="error-message"><CircleAlert className="notice-icon" size={18} aria-hidden="true"/><span className="notice-copy">{uiText(errorMessage||'')}</span><div className="notice-actions">{(savedRefreshNotice||view==='episodes'&&error)&&<Button size="sm" color="tertiary" onPress={()=>void refresh(false,true).catch(e=>setError(e instanceof Error?e.message:String(e)))}>{uiText("重新读取")}</Button>}<Button size="sm" color="tertiary" type="button" aria-label={uiText("关闭错误通知")} onClick={()=>{setError('');setSavedRefreshNotice('');savedWrite.current=null;connectionActions.setError('');}}><XClose aria-hidden="true" width={16} height={16}/></Button></div></div>}{cleanupNotice&&<div role="status" className="error-message deletion-cleanup-notice"><CircleAlert className="notice-icon" size={18} aria-hidden="true"/><span className="notice-copy">{uiText("生产单记录已删除，文件清理尚未完成。")}</span><div className="notice-actions"><Button size="sm" color="tertiary" onPress={()=>openCleanup(cleanupNotice.key)}>{uiText("查看清理任务")}</Button><Button size="sm" color="tertiary" aria-label={uiText("关闭清理通知")} onPress={()=>setCleanupNotice(null)}><XClose aria-hidden="true" width={16} height={16}/></Button></div></div>}</div>}
 <section inert={Boolean(episodeId)||panels.connections.open||cleanupOpen||logsOpen} className={`content-pane${view === 'accounts' ? ' account-workspace-page' : ''}`} id="main-content" aria-label={uiText("平台工作台")} tabIndex={-1}><header className="page-header"><nav className="workspace-breadcrumbs" aria-label={uiText("当前位置")}><span>{uiText("个人工作区")}</span><ChevronRight size={14} aria-hidden="true"/><strong aria-current="page">{pageLabel}</strong></nav><div className="page-header-actions">{!episodeId&&topbar}</div></header>{view!=='operations'&&view!=='accounts'&&<div className="workspace-page-heading"><h1>{pageLabel}</h1>{view==='episodes'&&workspaceActions}</div>}

 {view==='accounts'?<>
<AccountWorkspace readDeletionStatus={readDeletionStatus} onViewDeletionCleanup={openCleanup} onViewAccountEpisodes={id=>navigate('episodes',()=>{setRepair(null);filter({accountId:id,seriesId:'all',visibility:'all',q:'',status:'all',sort:'updated',page:1});})} onCreateEpisode={()=>setNewEpisode(true)} navigation={{value:panels.rules,change:patch=>setPanels(current=>({...current,rules:{...current.rules,...patch}}))}} onRefresh={()=>refresh().catch(e=>setError(e instanceof Error?e.message:String(e)))} onDirtyChange={setAccountDirty} blueprintRepairContext={repair} onDismissBlueprintRepair={()=>{if(repair){setEpisodeId(repair.episodeId);setView('episodes');filter({view:'episodes'});}setRepair(null);}} onApplyEpisodeRepair={async input=>{try{await localCommand('repairConfiguration',{episodeId:input.context.episodeId,policy:input.policy,blockerCode:input.context.blocker.code,blockerDetail:input.context.blocker.detail},undefined,'episode-commands');await refresh();setRepair(null);setEpisodeId(input.context.episodeId);setView('episodes');filter({view:'episodes'});return true;}catch(e){setError(e instanceof Error?e.message:String(e));return false;}}} externalConnections={connections} connectionVersions={connectionVersions} account={account} accountEpisodeCount={catalog.accountCounts[account?.id??'']??0} blueprints={catalog.blueprints} isPending={connectionActions.pending?'connection':pending} promptVersions={catalog.promptVersions.filter(p=>p.account_id===account?.id)} series={catalog.series.filter(s=>s.account_id===account?.id)} seriesVersions={catalog.seriesVersions.filter(s=>s.account_id===account?.id)}
 onCreateConnection={async input=>{try{return (await connectionActions.command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await connectionActions.command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onTestConnection={connectionId=>connectionActions.command('verify',{connectionId})}
 onUpdateConnection={async input=>{try{await connectionActions.command('update',input);}catch{/* Visible connection error. */}}}
 onUpdateBlueprint={async(policy:Json)=>{if(!account)return null;try{return await command<Blueprint>('blueprint','updateBlueprint',{accountId:account.id,policy},catalog.blueprintRevisions[account.current_blueprint_version_id??'']);}catch{return null;}}}
 onCreateSeries={async input=>{if(account)await command('series','createSeries',{accountId:account.id,...input});}}
 onRenameSeries={async(id,name)=>{try{await command(`rename-series-${id}`,'renameSeries',{seriesId:id,name});return true;}catch{return false;}}}
 onCreateSeriesVersion={async input=>{await command(`series-version-${input.seriesId}`,'createSeriesVersion',input);}}
 onCreatePromptVersion={async input=>{if(!account)return null;try{return await command('prompt-version','createPromptVersion',{accountId:account.id,...input});}catch{return null;}}}
 onRenameAccount={async(id,name)=>{try{await command(`rename-account-${id}`,'renameAccount',{accountId:id,name});return true;}catch{return false;}}}
 onSetAccountArchived={async(id,archived)=>{try{await command(`archive-account-${id}`,'archiveAccount',{accountId:id,archived});return true;}catch{return false;}}}
 onDeleteAccount={async(id,confirmation)=>{try{await command(`delete-account-${id}`,'deleteAccount',{accountId:id,confirmation});return true;}catch{return false;}}}
 />
 </>:view==='operations'?<OperationsWorkspace onOpenTaskQueue={openTaskQueue} taskQueue={taskQueue} onOpenAllEpisodes={()=>{navigate('episodes',()=>filter({status:'all',q:'',accountId:'',seriesId:'all',visibility:'active'}));}} catalogControls={{query:filters.q,status:filters.status,sort:filters.sort,accountId:filters.accountId,stage:filters.catalogStage,onStage:catalogStage=>filter({catalogStage}),onSearch:q=>filter({q}),onReset:()=>filter({q:'',accountId:'',seriesId:'all',visibility:'active',status:'all',sort:'updated',catalogStage:'all'}),onStatus:status=>filter({status}),onSort:sort=>filter({sort}),onAccount:accountId=>filter({accountId,seriesId:'all'})}} isLoading={catalogKey!==queryKey} accounts={catalog.accounts} blueprints={catalog.blueprints} onOpenReviewQueue={()=>navigate('reviews')} actions={workspaceActions} remote={{catalog,seriesId:filters.seriesId,onSeriesChange:seriesId=>filter({seriesId}),onPageChange:page=>filter({page}),onPendingPageChange:pendingPage=>filter({pendingPage}),onBlockedPageChange:blockedPage=>filter({blockedPage})}} episodes={catalog.episodes} series={catalog.series} seriesVersions={catalog.seriesVersions} tasks={[]} reviewPackages={[]} preRenderReviewMembers={[]} preRenderReviewMemberDecisions={[]} selectedEpisode={selectedEpisode} onSelectEpisode={openCatalogEpisode} onOpenBlueprint={(id,context)=>{navigate('accounts',()=>{setSelectedId(id);setRepair(context??null);});}}/>:<EpisodeWorkspace metrics={catalog.metrics} filterAccountCounts={catalog.filterAccountCounts} visibilityCounts={catalog.visibilityCounts} seriesEpisodeCounts={catalog.seriesEpisodeCounts} collections={catalog.collections} onMoveCollection={setCollectionEpisode} onOpenDirectory={async episodeId=>{try{await localCommand('openDirectory',{episodeId},undefined,'episode-commands');}catch(e){setError(e instanceof Error?e.message:String(e));}}} isPageLoading={catalogKey!==queryKey} operationRows={catalog.operationRows} catalogControls={{query:filters.q,status:filters.status,sort:filters.sort,counts:catalog.statusCounts,onSearch:q=>filter({q}),onClearAccount:()=>filter({accountId:''}),onReset:()=>filter({q:'',accountId:'',seriesId:'all',visibility:'active',status:'all',sort:'updated'}),onStatus:status=>filter({status}),onSort:sort=>filter({sort})}} serverPage={page} accounts={catalog.accounts} accountsById={accountsById} artifacts={[]} artifactCounts={catalog.artifactCounts} blueprintsById={blueprintsById} episodes={catalog.episodes} episodeVisibility={filters.visibility as 'active'|'archived'|'all'} onEpisodeVisibilityChange={visibility=>filter({visibility})} filter={filters.accountId||'全部账号'} onFilter={accountId=>filter({accountId:accountId==='全部账号'?'':accountId,seriesId:'all'})} seriesFilter={filters.seriesId==='all'?'全部系列':filters.seriesId} onSeriesFilter={seriesId=>filter({seriesId:seriesId==='全部系列'?'all':seriesId})} series={catalog.series} seriesById={seriesById} seriesVersionsById={versionsById} selectedEpisode={selectedEpisode} onSelectEpisode={openCatalogEpisode} onUpdateTitle={(episodeId,title)=>life('renameEpisode',{episodeId,title})} onSetArchived={(episodeId,archived)=>life('archiveEpisode',{episodeId,archived},false)} onRecycle={episodeId=>life('recycleEpisode',{episodeId},false,'recycle-bin')} onPlanDelete={planDeletion} onDelete={async(episodeId,confirmation,plan)=>{if(!plan)throw new Error('请重新检查删除范围。');const result=await life<{cleanupPending:boolean;cleanupKey:string}>('deleteEpisode',{episodeId,confirmation,expectedPath:plan.path,expectedPaths:plan.paths??[plan.path],expectedRevision:plan.revision});if(result.cleanupPending)setCleanupNotice({key:result.cleanupKey});}}/>}</section>

 {collectionEpisode?<EpisodeCollectionDialog episodeId={collectionEpisode} onClose={()=>setCollectionEpisode(null)} onChanged={refresh}/>:null}
 {episodeId&&<EpisodeDetailDrawer tools={topbar} inert={ownerSettingsPage!==null} isOpen onClose={closeEpisode}><LocalEpisodeDetail preparationEntry={preparationReturn?.episodeId===episodeId?preparationReturn:undefined} key={episodeId} ownerId={ownerId} episodeId={episodeId} onClose={closeEpisode} onChanged={refresh} onOpenAccount={(id,context)=>{navigate('accounts',()=>{setSelectedId(id);setRepair(context??null);});}} onStudioAction={action=>{studio.current=action;setStudioReady(Boolean(action));}}/></EpisodeDetailDrawer>}
 {ownerSettingsPage&&<OwnerSettingsDialog key={ownerId} page={ownerSettingsPage} onNavigate={openOwnerPage} onClose={closeOwnerPanels} returnFocusRef={ownerPanelTrigger} canManageSecrets={canManageSecrets} busy={ownerSettingsBusy} displayName={ownerPreferences.displayName} email={ownerEmail}>
  {ownerSettingsPage==='logs'&&<RuntimeLogsDialog embedded returnFocusRef={ownerPanelTrigger} onClose={closeOwnerPanels}/>}
  {ownerSettingsPage==='cleanup'&&<RecycleBinDialog embedded revision={catalog} targetKey={panels.cleanup?.task} onStateChange={onOwnerStateChange} returnFocusRef={ownerPanelTrigger} onClose={closeOwnerPanels} onResolved={key=>setPanels(current=>current.cleanup?.task===key?{...current,cleanup:{...current.cleanup,task:''}}:current)} onChanged={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:String(e)))}/>}
  {ownerSettingsPage==='connections'&&<ConnectionsSettingsDialog embedded returnFocusRef={ownerPanelTrigger} onClose={closeOwnerPanels} onStateChange={onOwnerStateChange} initialConnectionId={panels.connections.connection||undefined} onOpenSecrets={canManageSecrets?(id,name)=>openOwnerPage('secrets',{secret:{id,name:name??''}}):undefined}/>}
  {(ownerSettingsPage==='personal'||ownerSettingsPage==='notifications')&&<OwnerPreferencesDialog embedded onStateChange={onOwnerStateChange} csrf={csrf} key={`${ownerId}:${preferencesLoaded}:${ownerSettingsPage}`} preferences={ownerPreferences} page={ownerSettingsPage} loading={preferencesLoading} saving={preferencesSaving} unavailable={!preferencesLoaded} error={preferencesError} onReload={()=>setPreferencesRevision(value=>value+1)} onSave={savePreferences} onClose={closeOwnerPanels}/>}
  {ownerSettingsPage==='security'&&<PasswordForm embedded onStateChange={onOwnerStateChange} identity={<section aria-label={uiText("当前登录身份")} className="owner-identity review-section"><h3>{uiText("当前登录身份")}</h3><dl><div><dt>{uiText("登录邮箱")}</dt><dd>{ownerEmail||uiText("未读取")}</dd></div></dl></section>} isPending={pending==='password'} onClose={closeOwnerPanels} onSubmit={async password=>{setPending('password');try{await localRequest('password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({password})});setSettings(false);}finally{setPending('');}}}/>}
  {ownerSettingsPage==='secrets'&&canManageSecrets&&<LocalSecretAdministration embedded onStateChange={onOwnerStateChange} csrf={csrf} onClose={closeOwnerPanels} initialQuery={secretTarget?.name} onOpenConnection={id=>openOwnerPage('connections',{connectionId:id})}/>}
 </OwnerSettingsDialog>}
 <ConfirmationModalPresence>{ownerLeavePrompt&&<ConfirmationModal title={uiText("离开当前设置？")} confirmLabel={uiText("放弃修改并离开")} cancelLabel={uiText("继续编辑")} tone="danger" onCancel={()=>{setOwnerLeavePrompt(false);pendingOwnerLeave.current=null;}} onConfirm={()=>{const leave=pendingOwnerLeave.current;pendingOwnerLeave.current=null;setOwnerLeavePrompt(false);ownerPaneState.current={busy:false,dirty:false};leave?.();}}><p>{uiText("当前设置有未保存修改，离开后会丢失。")}</p></ConfirmationModal>}</ConfirmationModalPresence>
 {newEpisode&&<EpisodeForm initialAccountId={creationAccountId} initialSeriesVersionId={creationSeriesVersion?.id} accounts={catalog.accounts.filter(a=>!a.archived_at)} series={catalog.series} seriesVersions={catalog.seriesVersions} isPending={pending==='episode'} onClose={()=>setNewEpisode(false)} onSubmit={async input=>{setPending('episode');setError('');setSavedRefreshNotice('');savedWrite.current=null;try{const e=await localCommand<{id:string}>('create',input,undefined,'episode-commands');setEpisodeId(e.id);setNewEpisode(false);setView('episodes');filter({view:'episodes'});refreshAfterWrite('生产单已创建');}catch(e){setError(e instanceof Error?e.message:String(e));if(e&&typeof e==='object'&&'preflight'in e)return e.preflight as import('../worker/contracts').WorkerPreflightResult;throw e;}finally{setPending('');}return null;}}/>}
 {newAccount&&<AccountForm isPending={pending==='account'} onClose={()=>setNewAccount(false)} onSubmit={async input=>{const created=await command<LocalCatalog['accounts'][number]>('account','createAccount',input);navigate('accounts',()=>{
   setAccountDirty(false);setRepair(null);setSelectedId(created.id);setNewAccount(false);
   setPanels(current=>({...current,rules:{series:'__common',q:'',page:1}}));
  });}}/>}</div></WorkspaceNavigationContext.Provider></CatalogPanelNavigationContext.Provider>;
}
