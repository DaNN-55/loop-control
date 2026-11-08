import type {WorkspaceSearchLocation} from './workspaceSearchTypes';
import {createContext,useContext,useEffect,useRef} from 'react';
import {defaultEpisodePageSize,episodePageSizes,type EpisodePageSize,type CatalogSort,type CatalogStatus,type ProductionStep} from '../episodes/episodeCatalogTypes';
export type CatalogView='operations'|'episodes'|'accounts'|'history';
export type PreparationTab='visual'|'voice'|'sound';
export interface CatalogPanels {
 search:WorkspaceSearchLocation;
 sources:{source:string;q:string;sourcesQ:string;category:string;scope:string;filesPage:number;recordsPage:number};
 rules:{series:string;q:string;page:number};
 connections:{open:boolean;q:string;capability:string;status:string;connection:string};
 history:{tab:string;q:string;scope:string;contentOnly:boolean;episode:string;page:number;filesPage:number;recordsPage:number};
}
export type PanelNavigation<K extends keyof CatalogPanels>={value:CatalogPanels[K];change:(patch:Partial<CatalogPanels[K]>)=>void};
export interface CatalogNavigation {
 panels:CatalogPanels;view:CatalogView;account:string;episode:string;step:ProductionStep|null;tab:PreparationTab;
 filters:{page:number;pageSize:EpisodePageSize;accountId:string;seriesId:string;visibility:string;view:string;pendingPage:number;blockedPage:number;q:string;sort:CatalogSort;status:CatalogStatus;catalogStage:ProductionStep|'all'};
}
const views:CatalogView[]=['operations','episodes','accounts','history'];
export const productionSteps:ProductionStep[]=['script','preparation','editing','delivery'];
const tabs:PreparationTab[]=['visual','voice','sound'];
const panelKeys=['searchQ','searchCategory','searchPage','searchOpen','source','sourceQ','sourcesQ','sourceCategory','sourceScope','sourceFilesPage','sourceRecordsPage','rulesSeries','rulesQ','rulesPage','connectionsOpen','connectionsQ','capability','connectionStatus','connection','historyTab','historyQ','historyScope','historyContent','historyEpisode','historyPage','filesPage','recordsPage'];
const keys=[...panelKeys,'view','account','episode','step','tab','page','pageSize','accountId','seriesId','visibility','pendingPage','blockedPage','q','sort','status','catalogStage'];
export function readCatalogNavigation(search:string):CatalogNavigation {
 const p=new URLSearchParams(search),choice=<T extends string>(key:string,values:readonly T[],fallback:T)=>values.find(value=>value===p.get(key))??fallback;
 const id=(key:string)=>{const value=p.get(key)??'';return /^[\w-]{1,128}$/.test(value)?value:'';};
 const page=(key:string)=>{const value=p.get(key)??'';return /^\d{1,6}$/.test(value)&&Number(value)>0?Number(value):1;};
 const episode=id('episode'),view=choice('view',views,episode?'episodes':'operations');
 return {panels:{search:{q:(p.get('searchQ')??'').trim().slice(0,200),category:choice('searchCategory',['all','episodes','materials','accounts'],'all'),page:page('searchPage'),...(p.get('searchOpen')==='0'?{open:false}:{})},sources:{source:id('source'),q:(p.get('sourceQ')??'').trim().slice(0,200),sourcesQ:(p.get('sourcesQ')??'').trim().slice(0,200),category:choice('sourceCategory',['','business','configuration','diagnostics'],''),scope:choice('sourceScope',['active','archived','all'],'active'),filesPage:page('sourceFilesPage'),recordsPage:page('sourceRecordsPage')},rules:{series:id('rulesSeries')||'__common',q:(p.get('rulesQ')??'').slice(0,200),page:page('rulesPage')},connections:{open:p.get('connectionsOpen')==='1'||p.get('view')==='connections',q:(p.get('connectionsQ')??'').trim().slice(0,200),capability:choice('capability',['all','image','video','speech','music_sound','unsupported'],'all'),status:choice('connectionStatus',['','verified','unverified','invalid','retryable'],''),connection:id('connection')},history:{tab:choice('historyTab',['episodes','sources'],'episodes'),q:(p.get('historyQ')??'').trim().slice(0,200),scope:choice('historyScope',['active','archived','all'],'active'),contentOnly:p.get('historyContent')!=='all',episode:id('historyEpisode'),page:page('historyPage'),filesPage:page('filesPage'),recordsPage:page('recordsPage')}},view,account:id('account'),episode,step:productionSteps.find(value=>value===p.get('step'))??null,tab:choice('tab',tabs,'visual'),filters:{view:['operations','episodes','accounts'].includes(view)?view:'operations',page:page('page'),pageSize:episodePageSizes.find(size=>String(size)===p.get('pageSize'))??defaultEpisodePageSize,pendingPage:page('pendingPage'),blockedPage:page('blockedPage'),accountId:id('accountId'),seriesId:id('seriesId')||'all',visibility:choice('visibility',['active','archived','all'],'active'),q:(p.get('q')??'').trim().slice(0,1000),sort:choice('sort',view==='operations'?['updated','oldest','title']:['updated','oldest','title','cost_desc','cost_asc'],'updated'),catalogStage:view==='operations'?choice('catalogStage',['all',...productionSteps],'all'):'all',status:choice('status',['all','review','running','blocked','done'],'all')}};
}
export function catalogNavigationUrl(value:CatalogNavigation,href=location.href):string {
 const url=new URL(href);for(const key of keys)url.searchParams.delete(key);
 url.searchParams.set('view',value.view);
 if(value.view==='accounts'&&value.account)url.searchParams.set('account',value.account);
 if(value.episode){url.searchParams.set('episode',value.episode);if(value.step)url.searchParams.set('step',value.step);if(value.tab!=='visual')url.searchParams.set('tab',value.tab);}
 const defaults=readCatalogNavigation('').filters;
 for(const [key,entry] of Object.entries(value.filters)){if(key!=='view'&&entry!==defaults[key as keyof typeof defaults])url.searchParams.set(key,String(entry));}
 const panels=value.panels,defaultsPanels=readCatalogNavigation('').panels;
 const values:Record<string,string|number|boolean>={searchQ:panels.search.q,searchCategory:panels.search.category,searchPage:panels.search.page,searchOpen:panels.search.q&&panels.search.open===false?'0':'',source:panels.sources.source,sourceQ:panels.sources.q,sourcesQ:panels.sources.sourcesQ,sourceCategory:panels.sources.category,sourceScope:panels.sources.scope,sourceFilesPage:panels.sources.filesPage,sourceRecordsPage:panels.sources.recordsPage,rulesSeries:panels.rules.series,rulesQ:panels.rules.q,rulesPage:panels.rules.page,connectionsOpen:panels.connections.open?'1':'',connectionsQ:panels.connections.q,capability:panels.connections.capability,connectionStatus:panels.connections.status,connection:panels.connections.connection,historyTab:panels.history.tab,historyQ:panels.history.q,historyScope:panels.history.scope,historyContent:panels.history.contentOnly?'content':'all',historyEpisode:panels.history.episode,historyPage:panels.history.page,filesPage:panels.history.filesPage,recordsPage:panels.history.recordsPage};
 const defaultsValues:Record<string,string|number|boolean>={searchQ:'',searchCategory:'all',searchPage:1,searchOpen:'',source:'',sourceQ:'',sourcesQ:'',sourceCategory:'',sourceScope:'active',sourceFilesPage:1,sourceRecordsPage:1,rulesSeries:defaultsPanels.rules.series,rulesQ:'',rulesPage:1,connectionsOpen:'',connectionsQ:'',capability:'all',connectionStatus:'',connection:'',historyTab:'episodes',historyQ:'',historyScope:'active',historyContent:'content',historyEpisode:'',historyPage:1,filesPage:1,recordsPage:1};
 for(const key of panelKeys){if(values[key]!==defaultsValues[key])url.searchParams.set(key,String(values[key]));}
 return url.pathname+url.search+url.hash;
}
export const CatalogPanelNavigationContext=createContext<{openArchivedProductions?:()=>void;value:CatalogPanels;change:<K extends keyof CatalogPanels>(key:K,patch:Partial<CatalogPanels[K]>)=>void}|null>(null);
export function useCatalogPanelNavigation<K extends keyof CatalogPanels>(key:K):PanelNavigation<K>|undefined{const value=useContext(CatalogPanelNavigationContext);return value?{value:value.value[key],change:patch=>value.change(key,patch)}:undefined;}
type WorkspaceLocation={episode:string;step:ProductionStep|null;tab:PreparationTab;change:(patch:{step?:ProductionStep;tab?:PreparationTab})=>void};
export const WorkspaceNavigationContext=createContext<WorkspaceLocation|null>(null);
export function useWorkspaceNavigation(episode:string){const value=useContext(WorkspaceNavigationContext);return value?.episode===episode?value:null;}

type Entry={index:number;owner:string};
function entry():Entry|null{const value=history.state?.loopCatalogNavigation;return value&&Number.isInteger(value.index)?value:null;}
/** Restores history before asking about drafts, so cancel leaves both the page and address untouched. */
export function useCatalogHistory(value:CatalogNavigation,owner:string,restore:(next:CatalogNavigation)=>void,request:(action:()=>void,target:CatalogNavigation)=>boolean){
 const historyOwner=useRef(entry()?.owner??'');
 const latest=useRef({value,owner,restore,request});latest.current={value,owner,restore,request};
 const current=useRef({index:entry()?.index??0,url:catalogNavigationUrl(value)}),traversing=useRef(false);
 const pending=useRef<{target:CatalogNavigation;url:string;entry:Entry;phase:'return'|'apply'}|null>(null);
 useEffect(()=>{
  const write=(index:number,url:string)=>history.replaceState({...history.state,loopCatalogNavigation:{index,owner:latest.current.owner||historyOwner.current}},'',url);
  write(current.current.index,current.current.url);
  const apply=(target:CatalogNavigation,ownerAtEntry:string)=>{
   const next=ownerAtEntry&&ownerAtEntry!==latest.current.owner?readCatalogNavigation(''):target;
   latest.current.restore(next);
   if(next!==target){current.current.url=catalogNavigationUrl(next);write(current.current.index,current.current.url);}
  };
  const pop=()=>{
   const destination=entry(),url=location.pathname+location.search+location.hash;
   if(pending.current?.phase==='return'){
    const next=pending.current;pending.current=null;traversing.current=false;
    latest.current.request(()=>{pending.current={...next,phase:'apply'};traversing.current=true;history.go(next.entry.index-current.current.index);},next.target);return;
   }
   if(pending.current?.phase==='apply'){
    const next=pending.current;pending.current=null;current.current={index:next.entry.index,url:catalogNavigationUrl(next.target)};apply(next.target,next.entry.owner);history.replaceState({...history.state,loopCatalogNavigation:{index:next.entry.index,owner:latest.current.owner}},'',current.current.url);traversing.current=false;return;
   }
   const target=readCatalogNavigation(location.search);
   if(destination&&destination.index!==current.current.index){
    pending.current={target,url,entry:destination,phase:'return'};traversing.current=true;history.go(current.current.index-destination.index);return;
   }
   // Non-application history entries have no safe traversal offset.
   history.replaceState({...history.state,loopCatalogNavigation:{index:current.current.index,owner:latest.current.owner}},'',current.current.url);
   latest.current.request(()=>{current.current.url=url;write(current.current.index,url);apply(target,destination?.owner??'');},target);
  };
  window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
 },[]);
 const url=catalogNavigationUrl(value);
 useEffect(()=>{
  if(traversing.current)return;
  if(owner&&historyOwner.current&&owner!==historyOwner.current){historyOwner.current=owner;const next=readCatalogNavigation('');current.current.url=catalogNavigationUrl(next);history.replaceState({...history.state,loopCatalogNavigation:{index:current.current.index,owner}},'',current.current.url);restore(next);return;}
  if(owner)historyOwner.current=owner;
  if(current.current.url===url){history.replaceState({...history.state,loopCatalogNavigation:{index:current.current.index,owner:owner||historyOwner.current}},'',url);return;}
  const previousUrl=new URL(current.current.url,location.href),nextUrl=new URL(url,location.href);for(const key of ['searchQ','searchOpen']){previousUrl.searchParams.delete(key);nextUrl.searchParams.delete(key);}
  if(previousUrl.href===nextUrl.href){current.current.url=url;history.replaceState({...history.state,loopCatalogNavigation:{index:current.current.index,owner}},'',url);return;}
  current.current={index:current.current.index+1,url};history.pushState({...history.state,loopCatalogNavigation:{index:current.current.index,owner}},'',url);
 },[url,owner]);
}
